'use client';

import { useEffect, useRef, useState } from 'react';

export interface SelectOption<T> {
  value: T;
  label: string;
  sublabel?: string;
}

interface SelectProps<T> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Used to find/highlight the selected option. Defaults to Object.is. */
  isEqual?: (a: T, b: T) => boolean;
}

/** Generic dropdown: trigger + outside-click-to-close + option panel. */
export default function Select<T>({
  value,
  options,
  onChange,
  isEqual = Object.is,
}: SelectProps<T>) {
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

  const selected = options.find((o) => isEqual(o.value, value));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="input-field flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 truncate">
          <span className="font-medium text-on-surface">{selected?.label ?? 'Select'}</span>
          {selected?.sublabel && (
            <span className="text-xs tabular-nums text-on-surface-variant">
              {selected.sublabel}
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

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-outline-variant/20 bg-surface-container shadow-xl">
          {options.map((opt) => {
            const isActive = isEqual(opt.value, value);
            return (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-gold/[0.06] text-gold'
                    : 'text-on-surface hover:bg-surface-container-high'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {opt.sublabel && (
                  <span
                    className={`text-right text-xs tabular-nums ${isActive ? 'text-gold/70' : 'text-on-surface-variant/50'}`}
                  >
                    {opt.sublabel}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
