'use client';

import { type ReactNode, useState } from 'react';

interface MiniSelectOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/** Compact dropdown for the sidebar footer rows (theme, language). Opens upwards;
 *  focus may move into the menu without closing it, so it works from the keyboard. */
export default function MiniSelect<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: MiniSelectOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name of the trigger, e.g. "Theme". */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div
      className="relative min-w-0"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        className="sel-mini"
      >
        {current.icon}
        <span className="truncate">{current.label}</span>
        <svg
          className="ml-auto h-3 w-3 shrink-0 text-outline"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          // Safari and macOS Firefox don't focus a clicked button, so the blur
          // would close the menu before the click lands; keep focus where it is.
          onMouseDown={(e) => e.preventDefault()}
          className="popover absolute bottom-full right-0 z-50 mb-1 min-w-[160px] overflow-hidden rounded-[6px] py-1"
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-xs outline-none transition-colors focus-visible:bg-surface-container-highest ${
                o.value === value
                  ? 'bg-gold/[0.08] text-gold'
                  : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
              }`}
            >
              {o.icon}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
