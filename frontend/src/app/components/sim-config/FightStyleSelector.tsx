'use client';

import { useState } from 'react';
import { useLanguage } from '../../lib/i18n';

const FIGHT_STYLES = [
  { value: 'Patchwerk', labelKey: 'fightStyle.patchwerk' },
  { value: 'CastingPatchwerk', labelKey: 'fightStyle.castingPatchwerk' },
  { value: 'HecticAddCleave', labelKey: 'fightStyle.hecticAddCleave' },
  { value: 'CleaveAdd', labelKey: 'fightStyle.cleaveAdd' },
  { value: 'LightMovement', labelKey: 'fightStyle.lightMovement' },
  { value: 'HeavyMovement', labelKey: 'fightStyle.heavyMovement' },
  { value: 'DungeonSlice', labelKey: 'fightStyle.dungeonSlice' },
  { value: 'DungeonRoute', labelKey: 'fightStyle.dungeonRoute' },
  { value: 'HelterSkelter', labelKey: 'fightStyle.helterSkelter' },
] as const;

interface FightStyleSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function FightStyleSelector({ value, onChange }: FightStyleSelectorProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const match = FIGHT_STYLES.find((fs) => fs.value === value);
  const activeLabel = match ? t(match.labelKey) : value;

  return (
    <div className="relative" onBlur={() => setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="input-field flex w-full items-center justify-between text-sm"
      >
        <span>{activeLabel}</span>
        <svg
          className={`h-4 w-4 text-on-surface-variant/60 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
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
        <div className="absolute z-50 mt-1 w-full overflow-y-auto overscroll-contain rounded-lg bg-surface-container-high py-1 shadow-lg shadow-black/40" style={{ maxHeight: '12rem' }}>
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
                  : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
              }`}
            >
              {t(fs.labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
