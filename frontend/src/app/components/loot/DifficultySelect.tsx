'use client';

import { useEffect, useRef, useState } from 'react';
import type { DifficultyDef, DifficultyGroup } from '../../lib/types';
import type { UpgradeTracks } from './types';

const TRACK_SHORT: Record<string, string> = {
  Adventurer: 'Adv',
  Veteran: 'Vet',
  Champion: 'Champ',
  Hero: 'Hero',
  Myth: 'Myth',
};

const TRACK_COLORS: Record<string, string> = {
  Adventurer: 'text-green-400',
  Veteran: 'text-blue-400',
  Champion: 'text-purple-400',
  Hero: 'text-orange-400',
  Myth: 'text-amber-300',
};

interface DifficultySelectProps {
  value: string;
  onChange: (key: string, level: number) => void;
  difficulties: DifficultyDef[];
  difficultyGroups: DifficultyGroup[] | null;
  upgradeTracks: UpgradeTracks;
  isCrafted?: boolean;
}

function getDiffDetails(d: DifficultyDef, upgradeTracks: UpgradeTracks) {
  const trackLevels = d.track ? upgradeTracks[d.track] : null;
  const max = trackLevels?.at(-1)?.max_level ?? d.level;
  const ilvl = trackLevels?.find((t) => t.level === d.level)?.ilvl ?? d.fixedIlvl;
  return { max, ilvl };
}

export default function DifficultySelect({
  value,
  onChange,
  difficulties,
  difficultyGroups,
  upgradeTracks,
  isCrafted,
}: DifficultySelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const selected = difficulties.find((d) => d.key === value);
  const selectedDetails = selected ? getDiffDetails(selected, upgradeTracks) : null;
  const selectedTrackColor = selected?.track ? TRACK_COLORS[selected.track] : null;

  const groups: { label: string | null; difficulties: DifficultyDef[] }[] = difficultyGroups
    ? difficultyGroups.map((g) => ({ label: g.label, difficulties: g.difficulties }))
    : [{ label: null, difficulties }];

  const hasTrack = difficulties.some((d) => d.track && !isCrafted);

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="input-field flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 truncate">
          <span className="font-medium text-on-surface">{selected?.label ?? 'Select'}</span>
          {selected?.track && !isCrafted && (
            <span className={`text-xs ${selectedTrackColor ?? 'text-on-surface-variant'}`}>
              {TRACK_SHORT[selected.track] ?? selected.track} {selected.level}/
              {selectedDetails?.max}
            </span>
          )}
          {selectedDetails?.ilvl && (
            <span className="text-xs tabular-nums text-on-surface-variant">
              ilvl {selectedDetails.ilvl}
            </span>
          )}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-on-surface-variant/40 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-outline-variant/20 bg-surface-container shadow-xl">
          {groups.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <div className="sticky top-0 bg-surface-container-low px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/50">
                  {group.label}
                </div>
              )}
              {group.difficulties.map((d) => {
                const isActive = value === d.key;
                const { max, ilvl } = getDiffDetails(d, upgradeTracks);
                const short = d.track && !isCrafted ? (TRACK_SHORT[d.track] ?? d.track) : null;
                const trackColor = d.track ? TRACK_COLORS[d.track] : null;
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => {
                      onChange(d.key, d.level ?? 0);
                      setOpen(false);
                    }}
                    className={`grid w-full gap-x-3 px-3 py-2 text-left text-sm transition-colors ${
                      isActive
                        ? 'bg-gold/[0.06] text-gold'
                        : 'text-on-surface hover:bg-surface-container-high'
                    }`}
                    style={{ gridTemplateColumns: hasTrack ? '1fr auto auto' : '1fr auto' }}
                  >
                    <span className="truncate font-medium">{d.label}</span>
                    {hasTrack && (
                      <span
                        className={`text-xs tabular-nums ${isActive ? 'text-gold/70' : (trackColor ?? 'text-on-surface-variant/50')}`}
                      >
                        {short ? `${short} ${d.level}/${max}` : ''}
                      </span>
                    )}
                    <span
                      className={`text-right text-xs tabular-nums ${isActive ? 'text-gold/70' : 'text-on-surface-variant/50'}`}
                    >
                      {ilvl ? `ilvl ${ilvl}` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
