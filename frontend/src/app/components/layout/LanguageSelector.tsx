'use client';

import { useState } from 'react';
import { useLanguage, LOCALES } from '../../lib/i18n';

export default function LanguageSelector() {
  const { locale, setLocale } = useLanguage();
  const [open, setOpen] = useState(false);
  const current = LOCALES.find((l) => l.value === locale)!;

  return (
    <div className="relative" onBlur={() => setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-2 font-headline font-bold text-[10px] uppercase text-on-surface-variant/60 hover:text-primary transition-all"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
        {current.label}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-full overflow-hidden rounded-lg bg-surface-container-high py-1 shadow-lg shadow-black/40">
          {LOCALES.map((l) => (
            <button
              key={l.value}
              type="button"
              onMouseDown={() => {
                setLocale(l.value);
                setOpen(false);
              }}
              className={`flex w-full px-4 py-2 text-left text-xs transition-colors ${
                l.value === locale
                  ? 'bg-gold/[0.08] text-gold'
                  : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
