'use client';

import { useCallback, useRef, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { useDismiss } from '../../lib/useDismiss';
import { cn } from '../../lib/cn';
import { formatSpecName } from './types';
import { FILTER_LABEL, filterTriggerClass, filterValueClass } from './filterTrigger';

/** Which specs' loot the list shows, as one compact dropdown of checkboxes. */
export default function LootFor({
  specs,
  active,
  mainSpec,
  onToggle,
}: {
  specs: string[];
  active: Set<string>;
  mainSpec: string | null;
  onToggle: (spec: string) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  const on = specs.filter((spec) => active.has(spec));
  const summary =
    on.length === 1 ? formatSpecName(on[0]) : t('dropFinder.specsCount', { count: on.length });
  const canChoose = specs.length > 1;

  return (
    <span ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => canChoose && setOpen((v) => !v)}
        aria-expanded={canChoose ? open : undefined}
        aria-haspopup={canChoose ? 'dialog' : undefined}
        className={filterTriggerClass(false, canChoose)}
      >
        <span className={FILTER_LABEL}>{t('dropFinder.lootFor')}</span>
        <span className={filterValueClass(false)}>{summary}</span>
        {canChoose && (
          <svg
            className={cn('h-3.5 w-3.5 text-outline transition-transform', open && 'rotate-180')}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          className="popover absolute right-0 top-full z-40 mt-1.5 min-w-[220px] p-1.5"
        >
          {specs.map((spec) => (
            <label
              key={spec}
              className="flex cursor-pointer items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
            >
              <input
                type="checkbox"
                checked={active.has(spec)}
                onChange={() => onToggle(spec)}
                className="h-4 w-4 accent-gold-fill"
              />
              {formatSpecName(spec)}
              {spec === mainSpec && (
                <span className="ml-auto text-[11px] font-medium text-outline">
                  {t('dropFinder.mainSpec')}
                </span>
              )}
            </label>
          ))}
        </div>
      )}
    </span>
  );
}
