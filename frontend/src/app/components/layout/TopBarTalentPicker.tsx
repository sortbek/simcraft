'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSimContext } from '../sim-config/SimContext';
import { parseTalentLoadouts, specDisplayName } from '../../lib/types';
import type { TalentLoadoutParsed } from '../../lib/types';
import { getCharacters, getTalentBuilds } from '../../lib/saved-characters';

export default function TopBarTalentPicker() {
  const { simcInput, selectedTalent, setSelectedTalent } = useSimContext();
  const [open, setOpen] = useState(false);
  const [savedBuilds, setSavedBuilds] = useState<TalentLoadoutParsed[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const addonLoadouts = useMemo(() => parseTalentLoadouts(simcInput), [simcInput]);

  // Fetch saved builds
  useEffect(() => {
    if (!simcInput) { setSavedBuilds([]); return; }
    const nameMatch = simcInput.match(/^\w+="(.+)"$/m);
    const realmMatch = simcInput.match(/^server=(.+)$/m);
    if (!nameMatch || !realmMatch) { setSavedBuilds([]); return; }
    getCharacters().then((chars) => {
      const char = chars.find((c) => c.name === nameMatch[1] && c.realm === realmMatch[1]);
      if (!char) { setSavedBuilds([]); return; }
      getTalentBuilds(char.id).then((builds) => {
        const addonStrings = new Set(parseTalentLoadouts(simcInput).map((l) => l.talentString));
        setSavedBuilds(
          builds
            .filter((b) => !addonStrings.has(b.talent_string))
            .map((b) => ({
              name: `[${specDisplayName(b.spec)}] ${b.name}`,
              talentString: b.talent_string,
              isActive: false,
            }))
        );
      });
    });
  }, [simcInput]);

  const allLoadouts = useMemo(
    () => [...addonLoadouts, ...savedBuilds],
    [addonLoadouts, savedBuilds]
  );

  // Auto-select active loadout on first load
  useEffect(() => {
    if (allLoadouts.length === 0) return;
    if (selectedTalent && allLoadouts.some((l) => l.talentString === selectedTalent)) return;
    const active = allLoadouts.find((l) => l.isActive);
    if (active) setSelectedTalent(active.talentString);
    else setSelectedTalent(allLoadouts[0].talentString);
  }, [allLoadouts, selectedTalent, setSelectedTalent]);

  const currentLoadout = allLoadouts.find((l) => l.talentString === selectedTalent);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (allLoadouts.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-surface-container-high"
      >
        <svg
          className="h-4 w-4 text-on-surface-variant/50 transition-colors group-hover:text-on-surface-variant"
          viewBox="0 0 16 16" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M2 2h12v12H2zM5 6h6M5 10h4" />
        </svg>
        <span className="text-sm font-headline font-bold text-on-surface">
          {currentLoadout?.name ?? 'Talents'}
        </span>
        <svg
          className={`h-3 w-3 text-on-surface-variant/30 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-outline-variant/20 bg-surface-container-high shadow-2xl shadow-black/40">
          <div className="p-1.5">
            <div className="px-2.5 py-1.5 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">
                Talent Build
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-0.5">
              {allLoadouts.map((loadout, i) => {
                const isActive = loadout.talentString === selectedTalent;
                return (
                  <button
                    key={`${loadout.name}-${i}`}
                    onClick={() => {
                      setSelectedTalent(loadout.talentString);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      isActive
                        ? 'bg-primary/[0.08]'
                        : 'hover:bg-surface-container-highest'
                    }`}
                  >
                    <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                      isActive ? 'bg-primary/20' : 'bg-surface-container-highest'
                    }`}>
                      {isActive ? (
                        <svg className="h-3 w-3 text-primary" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2.5 6l2.5 2.5 4.5-5" />
                        </svg>
                      ) : (
                        <svg className="h-3 w-3 text-on-surface-variant/40" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 2h12v12H2zM5 6h6M5 10h4" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] font-medium ${
                        isActive ? 'text-primary' : 'text-on-surface'
                      }`}>
                        {loadout.name}
                      </span>
                    </div>
                    {loadout.isActive && (
                      <span className="shrink-0 text-[10px] font-bold uppercase text-on-surface-variant/40">
                        Equipped
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
