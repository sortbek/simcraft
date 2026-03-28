'use client';

const FIGHT_STYLES = [
  { value: 'Patchwerk', label: 'Patchwerk' },
  { value: 'HecticAddCleave', label: 'Hectic Add Cleave' },
  { value: 'LightMovement', label: 'Light Movement' },
];

interface FightStyleSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function FightStyleSelector({ value, onChange }: FightStyleSelectorProps) {
  return (
    <div className="flex gap-1.5">
      {FIGHT_STYLES.map((fs) => {
        const active = value === fs.value;
        return (
          <button
            key={fs.value}
            type="button"
            onClick={() => onChange(fs.value)}
            className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition-all duration-150 ${
              active
                ? 'border-gold/40 bg-gold/[0.08] text-gold'
                : 'border-border bg-surface-2 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
            }`}
          >
            {fs.label}
          </button>
        );
      })}
    </div>
  );
}
