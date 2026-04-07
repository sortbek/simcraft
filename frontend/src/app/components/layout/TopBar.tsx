'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSimContext } from '../sim-config/SimContext';
import { specDisplayName } from '../../lib/types';
import {
  getCharacters,
  upsertCharacter,
  deleteCharacter,
  type SavedCharacter,
} from '../../lib/saved-characters';
import WindowControls from './WindowTitlebar';
import DesktopAppLink from './DesktopAppLink';
import { useIsDesktop } from '../../lib/useIsDesktop';
import { useLanguage } from '../../lib/i18n';

function parseCharacterInfo(input: string) {
  if (!input) return null;
  const nameMatch = input.match(/^(\w+)="(.+)"$/m);
  const specMatch = input.match(/^spec=(\w+)/m);
  if (!nameMatch) return null;
  const realmMatch = input.match(/^server=(.+)$/m);
  if (nameMatch[2] && realmMatch?.[1]) {
    try {
      localStorage.setItem(
        'simhammer_last_character',
        JSON.stringify({ name: nameMatch[2], realm: realmMatch[1] })
      );
    } catch {}
  }
  return {
    className: nameMatch[1],
    name: nameMatch[2],
    spec: specMatch?.[1] || 'unknown',
  };
}

export default function TopBar() {
  const isDesktop = useIsDesktop();
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [showChars, setShowChars] = useState(false);
  const [characters, setCharacters] = useState<SavedCharacter[]>([]);
  const { simcInput, setSimcInput } = useSimContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const characterInfo = useMemo(() => parseCharacterInfo(simcInput), [simcInput]);

  const refreshCharacters = useCallback(() => {
    getCharacters().then(setCharacters);
  }, []);

  useEffect(() => {
    refreshCharacters();
  }, [refreshCharacters]);

  // Auto-save character when SimC input changes (debounced)
  useEffect(() => {
    if (!simcInput.trim()) return;
    const timeout = setTimeout(() => {
      upsertCharacter(simcInput).then((result) => {
        if (result) refreshCharacters();
      });
    }, 1000);
    return () => clearTimeout(timeout);
  }, [simcInput, refreshCharacters]);

  // Close on outside click
  useEffect(() => {
    if (!editing && !showChars) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setEditing(false);
        setShowChars(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [editing, showChars]);

  // Focus textarea when opening editor
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing && !wasEditing.current && textareaRef.current) {
      textareaRef.current.focus();
    }
    wasEditing.current = editing;
  }, [editing]);

  return (
    <div ref={containerRef} className="desktop-drag sticky top-0 z-50 flex h-14 items-center justify-between bg-[#131313]/80 backdrop-blur-xl px-6 shadow-2xl shadow-black/40">
      <div className="desktop-no-drag relative flex items-center gap-1.5">
        {/* Character info + saved chars dropdown */}
        <button
          onClick={() => {
            if (characters.length > 0) setShowChars((v) => !v);
            else setEditing(true);
          }}
          className="group flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-surface-container-high"
        >
          <svg
            className="h-4 w-4 text-on-surface-variant/50 transition-colors group-hover:text-on-surface-variant"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="8" cy="5" r="3" />
            <path d="M2 14c0-3.3 2.7-5 6-5s6 1.7 6 5" />
          </svg>
          {characterInfo ? (
            <span className="text-sm font-headline font-bold text-on-surface">
              {characterInfo.name}
              <span className="ml-1.5 font-normal text-on-surface-variant/50">
                {specDisplayName(characterInfo.spec)}
              </span>
            </span>
          ) : (
            <span className="text-sm text-on-surface-variant/50">{t('layout.noCharacter')}</span>
          )}
          {characters.length > 0 && (
            <svg
              className={`h-3 w-3 text-on-surface-variant/30 transition-transform duration-200 ${showChars ? 'rotate-180' : ''}`}
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M3 4.5l3 3 3-3" />
            </svg>
          )}
        </button>

        {/* Inline SimC preview — click to open full editor below */}
        <button
          onClick={() => setEditing((v) => !v)}
          className="flex h-8 items-center rounded-lg bg-surface-container-high/50 border border-outline-variant/10 px-3 transition-colors hover:bg-surface-container-highest"
        >
          <span className="max-w-48 truncate font-mono text-[11px] text-on-surface-variant/40">
            {simcInput
              ? simcInput.split('\n')[0].slice(0, 40) + (simcInput.length > 40 ? '...' : '')
              : t('layout.pasteSimcExport')}
          </span>
        </button>

        {/* Saved characters dropdown */}
        {showChars && characters.length > 0 && (
          <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-xl border border-outline-variant/20 bg-surface-container-high shadow-2xl shadow-black/40">
            <div className="space-y-0.5 p-2">
              {characters.map((char) => {
                const isActive =
                  characterInfo?.name === char.name &&
                  simcInput.includes(`server=${char.realm}`);
                return (
                  <div
                    key={char.id}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                      isActive ? 'bg-primary/[0.08]' : 'hover:bg-surface-container-highest'
                    }`}
                  >
                    <button
                      onClick={() => {
                        setSimcInput(char.simc_input);
                        setShowChars(false);
                      }}
                      className={`min-w-0 flex-1 text-left transition-colors ${
                        isActive ? 'text-primary' : 'text-on-surface'
                      }`}
                    >
                      <div className="text-sm font-medium">{char.name}</div>
                      <div className="text-[12px] text-on-surface-variant/50">
                        {specDisplayName(char.spec)} {char.class} &middot; {char.realm}
                      </div>
                    </button>
                    <button
                      onClick={() => deleteCharacter(char.id).then(refreshCharacters)}
                      className="ml-2 shrink-0 text-sm text-on-surface-variant/30 hover:text-error transition-colors"
                    >
                      &times;
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="desktop-no-drag flex items-center gap-3">
        {!isDesktop && <DesktopAppLink />}
        <WindowControls />
      </div>

      {/* Expanded SimC editor — drops below the top bar */}
      {editing && (
        <div className="desktop-no-drag absolute left-0 right-0 top-full z-50 border-b border-outline-variant/10 bg-[#0e0e0e]/95 px-6 py-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <div className="mx-auto max-w-3xl">
            <textarea
              ref={textareaRef}
              value={simcInput}
              onChange={(e) => setSimcInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false);
              }}
              placeholder={t('layout.pasteSimcExportFull')}
              className="h-48 w-full resize-y rounded-lg bg-surface-container px-4 py-3 font-mono text-[12px] leading-relaxed text-on-surface placeholder-on-surface-variant/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
        </div>
      )}
    </div>
  );
}
