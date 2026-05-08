'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSimContext } from '../sim-config/SimContext';
import { specDisplayName } from '../../lib/types';
import {
  getCharacters,
  upsertCharacter,
  deleteCharacter,
  type SavedCharacter,
} from '../../lib/saved-characters';
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

export default function SidebarCharacter() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [characters, setCharacters] = useState<SavedCharacter[]>([]);
  const { simcInput, setSimcInput } = useSimContext();

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

  return (
    <div className="shrink-0 px-3 py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left font-headline text-xs font-bold uppercase transition-all duration-150 ${
          open
            ? 'bg-primary-container/10 text-primary'
            : 'text-on-surface-variant hover:bg-surface hover:text-white'
        }`}
      >
        <svg
          className={`h-4 w-4 shrink-0 transition-colors ${
            open ? 'text-gold' : 'text-on-surface-variant/40 group-hover:text-on-surface-variant'
          }`}
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
        <div className="min-w-0 flex-1">
          {characterInfo ? (
            <>
              <div className="truncate text-[14px] leading-tight">{characterInfo.name}</div>
              <div className="truncate text-[11px] font-normal text-on-surface-variant/60">
                {specDisplayName(characterInfo.spec)} {characterInfo.className}
              </div>
            </>
          ) : (
            t('layout.character')
          )}
        </div>
        <svg
          className={`h-3 w-3 shrink-0 text-on-surface-variant/40 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5 px-1 pb-1">
          {characters.length > 0 && (
            <div className="space-y-0.5">
              {characters.map((char) => {
                const isActive =
                  characterInfo?.name === char.name && simcInput.includes(`server=${char.realm}`);
                return (
                  <div
                    key={char.id}
                    className={`flex items-center justify-between rounded-md px-2.5 py-1.5 ${
                      isActive ? 'bg-gold/[0.08]' : 'hover:bg-surface-container'
                    }`}
                  >
                    <button
                      onClick={() => setSimcInput(char.simc_input)}
                      className={`min-w-0 flex-1 text-left transition-colors ${
                        isActive ? 'text-gold' : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      <div className="truncate text-[13px] font-medium">{char.name}</div>
                      <div className="truncate text-[11px] text-on-surface-variant/50">
                        {specDisplayName(char.spec)} {char.class}
                      </div>
                    </button>
                    <button
                      onClick={() => deleteCharacter(char.id).then(refreshCharacters)}
                      className="ml-2 shrink-0 text-[13px] text-on-surface-variant/30 transition-colors hover:text-red-400"
                    >
                      &times;
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <textarea
            value={simcInput}
            onChange={(e) => setSimcInput(e.target.value)}
            placeholder={t('layout.pasteSimcExport')}
            className="h-28 w-full resize-y rounded-lg bg-surface-container-high px-2.5 py-2 font-mono text-[11px] leading-relaxed text-on-surface placeholder-on-surface-variant/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      )}
    </div>
  );
}
