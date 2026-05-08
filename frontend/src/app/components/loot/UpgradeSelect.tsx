'use client';

import { useEffect, useRef, useState } from 'react';

interface UpgradeOption {
  key: number;
  label: string;
  sublabel?: string;
}

interface UpgradeSelectProps {
  value: number;
  onChange: (value: number) => void;
  options: UpgradeOption[];
}

export default function UpgradeSelect({ value, onChange, options }: UpgradeSelectProps) {
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

  const selected = options.find((o) => o.key === value);

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
          {selected && 'sublabel' in selected && selected.sublabel && (
            <span className="text-xs tabular-nums text-on-surface-variant">
              ilvl {selected.sublabel}
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
          {options.map((opt) => {
            const isActive = value === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  onChange(opt.key);
                  setOpen(false);
                }}
                className={`grid w-full gap-x-3 px-3 py-2 text-left text-sm transition-colors ${
                  isActive
                    ? 'bg-gold/[0.06] text-gold'
                    : 'text-on-surface hover:bg-surface-container-high'
                }`}
                style={{ gridTemplateColumns: '1fr auto' }}
              >
                <span className="truncate font-medium">{opt.label}</span>
                <span
                  className={`text-right text-xs tabular-nums ${isActive ? 'text-gold/70' : 'text-on-surface-variant/50'}`}
                >
                  {'sublabel' in opt && opt.sublabel ? `ilvl ${opt.sublabel}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
