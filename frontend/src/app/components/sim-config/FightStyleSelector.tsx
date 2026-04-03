'use client';

import { useState } from 'react';

const FIGHT_STYLES = [
  { value: 'Patchwerk', label: 'Patchwerk' },
  { value: 'CastingPatchwerk', label: 'Casting Patchwerk' },
  { value: 'HecticAddCleave', label: 'Hectic Add Cleave' },
  { value: 'CleaveAdd', label: 'Cleave Add' },
  { value: 'LightMovement', label: 'Light Movement' },
  { value: 'HeavyMovement', label: 'Heavy Movement' },
  { value: 'DungeonSlice', label: 'Dungeon Slice' },
  { value: 'DungeonRoute', label: 'Dungeon Route' },
  { value: 'HelterSkelter', label: 'Helter Skelter' },
];

interface FightStyleSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function FightStyleSelector({ value, onChange }: FightStyleSelectorProps) {
  const [open, setOpen] = useState(false);
  const activeLabel = FIGHT_STYLES.find((fs) => fs.value === value)?.label ?? value;

  return (
    <div className="relative" onBlur={() => setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="input-field flex w-full items-center justify-between text-sm"
      >
        <span>{activeLabel}</span>
        <svg
          className={`h-4 w-4 text-zinc-500 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface-2 py-1 shadow-lg shadow-black/40">
          {FIGHT_STYLES.map((fs) => (
            <button
              key={fs.value}
              type="button"
              onMouseDown={() => {
                onChange(fs.value);
                setOpen(false);
              }}
              className={`flex w-full px-3.5 py-2 text-left text-sm transition-colors ${
                fs.value === value
                  ? 'bg-gold/[0.08] text-gold'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
              }`}
            >
              {fs.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
