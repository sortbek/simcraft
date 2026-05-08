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
import { isValidSimcExport, validateChecksum } from '../../lib/simcDetect';

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
  const [editValue, setEditValue] = useState('');
  const [showChars, setShowChars] = useState(false);
  const [characters, setCharacters] = useState<SavedCharacter[]>([]);
  const { simcInput, setSimcInput } = useSimContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const characterInfo = useMemo(() => parseCharacterInfo(simcInput), [simcInput]);
  const checksumWarning = useMemo(
    () => simcInput.trim().length > 50 && validateChecksum(simcInput) === 'invalid',
    [simcInput]
  );

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

  // Clipboard sync on focus (desktop only, opt-in via Settings)
  const [clipboardSync, setClipboardSync] = useState(() => {
    try {
      return localStorage.getItem('simhammer_clipboard_sync') === 'true';
    } catch {
      return false;
    }
  });
  const [clipboardNotice, setClipboardNotice] = useState('');
  const simcInputRef = useRef(simcInput);
  simcInputRef.current = simcInput;

  // Re-read setting when Settings popover toggles it (same-tab)
  useEffect(() => {
    function onStorage() {
      try {
        setClipboardSync(localStorage.getItem('simhammer_clipboard_sync') === 'true');
      } catch {}
    }
    window.addEventListener('storage', onStorage);
    // Also poll on focus (storage event doesn't fire same-tab)
    function onFocusCheck() {
      try {
        setClipboardSync(localStorage.getItem('simhammer_clipboard_sync') === 'true');
      } catch {}
    }
    window.addEventListener('focus', onFocusCheck);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocusCheck);
    };
  }, []);

  const lastImportedClipboard = useRef('');

  useEffect(() => {
    if (!isDesktop || !clipboardSync) return;

    async function handleFocus() {
      try {
        const text = await window.electronAPI!.readClipboard();
        if (!text || !isValidSimcExport(text)) return;
        // Skip if we already imported this exact clipboard content
        if (text === lastImportedClipboard.current) return;
        lastImportedClipboard.current = text;
        const nameMatch = text.match(/^\w+="(.+)"$/m);
        const charName = nameMatch?.[1] ?? 'Unknown';
        setSimcInput(text);
        setClipboardNotice(`Imported SimC data for ${charName}`);
        setTimeout(() => setClipboardNotice(''), 4000);
      } catch {
        /* clipboard read failed, ignore */
      }
    }

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [isDesktop, clipboardSync, setSimcInput]);

  return (
    <div
      ref={containerRef}
      className="desktop-drag sticky top-0 z-50 flex h-14 items-center justify-between bg-[#131313]/80 px-6 shadow-2xl shadow-black/40 backdrop-blur-xl"
    >
      <div className="desktop-no-drag relative flex items-center gap-1.5">
        {/* Character info + saved chars dropdown */}
        <button
          onClick={() => {
            if (characters.length > 0) {
              setShowChars((v) => !v);
              setEditing(false);
            } else {
              setEditing(true);
              setEditValue(simcInput);
            }
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
            <span className="font-headline text-sm font-bold text-on-surface">
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
          onClick={() => {
            setEditing((v) => {
              if (!v) setEditValue(simcInput);
              return !v;
            });
            setShowChars(false);
          }}
          className="flex h-8 items-center rounded-lg border border-outline-variant/10 bg-surface-container-high/50 px-3 transition-colors hover:bg-surface-container-highest"
        >
          <span className="max-w-48 truncate font-mono text-[11px] text-on-surface-variant/40">
            {simcInput
              ? simcInput.split('\n')[0].slice(0, 40) + (simcInput.length > 40 ? '...' : '')
              : t('layout.pasteSimcExport')}
          </span>
        </button>

        {/* Checksum warning */}
        {checksumWarning && (
          <span
            className="flex items-center gap-1 rounded bg-amber-400/10 px-2 py-1 text-[11px] font-medium text-amber-400"
            title={t('validation.checksumInvalid')}
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 2L1.5 13h13L8 2z" />
              <path d="M8 6v3M8 11v.5" />
            </svg>
            {t('validation.checksumWarning')}
          </span>
        )}

        {/* Saved characters dropdown */}
        {showChars && characters.length > 0 && (
          <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-xl border border-outline-variant/20 bg-surface-container-high shadow-2xl shadow-black/40">
            <div className="max-h-72 space-y-0.5 overflow-y-auto p-2">
              {characters.map((char) => {
                const isActive =
                  characterInfo?.name === char.name && simcInput.includes(`server=${char.realm}`);
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
                      className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-on-surface-variant/30 transition-colors hover:bg-red-400/10 hover:text-red-400"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      >
                        <path d="M4 4l8 8M12 4l-8 8" />
                      </svg>
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

      {/* Clipboard sync notification */}
      {clipboardNotice && (
        <div className="absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 rounded-lg border border-primary/20 bg-[#0e0e0e]/95 px-4 py-2 shadow-xl backdrop-blur-xl">
          <p className="whitespace-nowrap text-xs font-medium text-primary">{clipboardNotice}</p>
        </div>
      )}

      {/* Expanded SimC editor — drops below the top bar */}
      {editing && (
        <div className="desktop-no-drag absolute left-0 right-0 top-full z-50 border-b border-outline-variant/10 bg-[#0e0e0e]/95 px-6 py-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <div className="mx-auto max-w-3xl space-y-3">
            <textarea
              ref={textareaRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false);
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (editValue.trim()) {
                    setSimcInput(editValue);
                    setEditing(false);
                  }
                }
              }}
              placeholder={t('layout.pasteSimcExportFull')}
              className="h-48 w-full resize-y rounded-lg bg-surface-container px-4 py-3 font-mono text-[12px] leading-relaxed text-on-surface placeholder-on-surface-variant/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setSimcInput(editValue);
                  setEditing(false);
                }}
                disabled={!editValue.trim()}
                className="rounded-lg bg-gold/10 px-4 py-2 text-[13px] font-bold text-gold transition-colors hover:bg-gold/20 disabled:opacity-40"
              >
                {t('common.apply')}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg px-4 py-2 text-[13px] text-on-surface-variant/60 transition-colors hover:text-on-surface"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
