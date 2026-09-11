import { usePopupDismissal } from './usePopupDismissal';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../lib/i18n';

interface SlotFilterProps {
  availableSlots: string[];
  excludedSlots: Set<string>;
  toggleSlot: (slot: string) => void;
  resetExcludedSlots: () => void;
}

export default function SlotFilter({
  availableSlots,
  excludedSlots,
  toggleSlot,
  resetExcludedSlots,
}: SlotFilterProps) {
  const { t } = useLanguage();
  const [slotFilterOpen, setSlotFilterOpen] = useState(false);
  const slotFilterRef = useRef<HTMLDetailsElement | null>(null);
  const slotFilterSummary = useMemo(() => {
    if (availableSlots.length === 0 || excludedSlots.size === 0) return t('dropFinder.allSlots');
    const visibleCount = availableSlots.filter((slot) => !excludedSlots.has(slot)).length;
    if (visibleCount <= 0) return t('dropFinder.noSlots');
    if (visibleCount === 1) {
      return availableSlots.find((slot) => !excludedSlots.has(slot)) ?? t('dropFinder.slotsOne');
    }
    return t('dropFinder.slotsMany', { visibleCount });
  }, [availableSlots, excludedSlots, t]);

  const triggerRef = useRef<HTMLElement>(null);
  const close = useCallback(() => setSlotFilterOpen(false), []);
  usePopupDismissal(slotFilterOpen, close, slotFilterRef, undefined, triggerRef);

  if (availableSlots.length <= 1) return null;
  return (
    <div className="ml-auto flex items-center gap-2">
      <span className="h-3.5 w-px bg-outline-variant/20" />
      <details
        ref={slotFilterRef}
        className="relative"
        open={slotFilterOpen}
        onToggle={(e) => setSlotFilterOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary
          ref={triggerRef}
          aria-expanded={slotFilterOpen}
          className={`flex cursor-pointer list-none items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all duration-150 [&::-webkit-details-marker]:hidden ${
            slotFilterOpen || excludedSlots.size > 0
              ? 'border-gold/40 bg-gold/[0.08] text-gold'
              : 'border-transparent bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
          }`}
        >
          <span className="font-semibold">{t('dropFinder.slots')}</span>
          <span className={slotFilterOpen || excludedSlots.size > 0 ? 'text-gold/90' : ''}>
            {slotFilterSummary}
          </span>
          {excludedSlots.size > 0 && (
            <span className="rounded-full border border-gold/20 bg-black/10 px-1.5 py-0.5 text-[10px] font-bold text-gold">
              {t('dropFinder.hiddenCount', { count: excludedSlots.size })}
            </span>
          )}
          <svg
            className={`h-3 w-3 transition-transform ${slotFilterOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2.5 4.5L6 8l3.5-3.5" />
          </svg>
        </summary>
        <div className="absolute right-0 top-full z-20 mt-2 w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-outline-variant/15 bg-surface-container p-3 shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-outline-variant/10 pb-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-variant/60">
                {t('dropFinder.slotFilter')}
              </p>
              <p className="mt-1 text-xs text-on-surface-variant">
                {t('dropFinder.slotFilterDesc')}
              </p>
            </div>
            {excludedSlots.size > 0 && (
              <button
                type="button"
                onClick={resetExcludedSlots}
                className="rounded-lg border border-outline-variant/20 bg-surface-container-high px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-variant transition-colors hover:border-outline-variant/35 hover:text-on-surface"
              >
                {t('common.reset')}
              </button>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {availableSlots.map((slot) => {
              const isEnabled = !excludedSlots.has(slot);
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => toggleSlot(slot)}
                  aria-pressed={isEnabled}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] transition-colors ${
                    isEnabled
                      ? 'border-gold/20 bg-gold/[0.08] text-on-surface hover:border-gold/35 hover:bg-gold/[0.12]'
                      : 'border-outline-variant/10 bg-surface-container-high text-on-surface-variant/45 hover:border-outline-variant/25 hover:text-on-surface-variant/70'
                  }`}
                >
                  <span className={isEnabled ? '' : 'line-through'}>{slot}</span>
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${isEnabled ? 'bg-gold' : 'bg-outline-variant/30'}`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </details>
    </div>
  );
}
