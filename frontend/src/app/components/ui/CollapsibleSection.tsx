'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { readStoredJson } from '../../lib/storage';

interface CollapsibleSectionProps {
  title: string;
  subtitle?: string;
  /** Count shown as a gold pill on the header while collapsed (hidden when 0). */
  count?: number;
  defaultOpen?: boolean;
  /** localStorage key to persist the open/closed state across visits. */
  storageKey?: string;
  children: ReactNode;
}

/**
 * A page section with a sticky, clickable header that expands/collapses its body.
 * Matches the app's section-header language (uppercase, full-bleed sticky bar) used
 * by the gear item selector, with a rotating chevron and an optional count badge
 * shown while collapsed. Optionally persists open/closed state via `storageKey`.
 */
export default function CollapsibleSection({
  title,
  subtitle,
  count = 0,
  defaultOpen = false,
  storageKey,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Restore persisted state after mount (avoids SSR hydration mismatch).
  useEffect(() => {
    if (storageKey) setOpen(readStoredJson<boolean>(storageKey, defaultOpen));
  }, [storageKey, defaultOpen]);

  const toggle = () => {
    setOpen((previous) => {
      const next = !previous;
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  };

  return (
    <div>
      <div className="sticky top-14 z-30 -mx-8 border-b border-outline-variant/20 bg-background/90 px-8 backdrop-blur-sm">
        <button
          type="button"
          onClick={toggle}
          className="group flex w-full items-center justify-between gap-3 py-2.5 text-left"
        >
          <div className="flex flex-col">
            <span className="text-xs font-medium uppercase tracking-widest text-muted transition-colors group-hover:text-on-surface-variant">
              {title}
            </span>
            {subtitle && (
              <span className="text-[11px] leading-snug text-on-surface-variant/50">
                {subtitle}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            {!open && count > 0 && (
              <span className="rounded-md bg-gold/10 px-1.5 py-0.5 text-[12px] font-medium tabular-nums text-gold">
                {count}
              </span>
            )}
            <svg
              className={`h-3.5 w-3.5 text-on-surface-variant/40 transition-transform duration-200 group-hover:text-on-surface-variant ${open ? 'rotate-180' : ''}`}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </div>
        </button>
      </div>
      {open && <div className="animate-fade-in pt-4">{children}</div>}
    </div>
  );
}
