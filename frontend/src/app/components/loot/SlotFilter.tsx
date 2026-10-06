import { usePopupDismissal } from './usePopupDismissal';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { buttonClass } from '../ui/Button';
import Pill from '../ui/Pill';

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
      <span className="h-3.5 w-px bg-overlay/[0.06]" />
      <details
        ref={slotFilterRef}
        className="relative"
        open={slotFilterOpen}
        onToggle={(e) => setSlotFilterOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary
          ref={triggerRef}
          aria-expanded={slotFilterOpen}
          className={`chip cursor-pointer list-none [&::-webkit-details-marker]:hidden ${
            slotFilterOpen || excludedSlots.size > 0 ? 'chip-on' : ''
          }`}
        >
          <span className="font-semibold">{t('dropFinder.slots')}</span>
          <span className={slotFilterOpen || excludedSlots.size > 0 ? 'text-gold' : ''}>
            {slotFilterSummary}
          </span>
          {excludedSlots.size > 0 && (
            <Pill variant="gold">{t('dropFinder.hiddenCount', { count: excludedSlots.size })}</Pill>
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
        <div className="popover absolute right-0 top-full z-20 mt-2 w-[min(28rem,calc(100vw-2rem))] p-4">
          <div className="flex items-center justify-between gap-3 border-b border-line/[0.06] pb-3">
            <div>
              <p className="lbl">{t('dropFinder.slotFilter')}</p>
              <p className="mt-1.5 text-xs text-on-surface-variant">
                {t('dropFinder.slotFilterDesc')}
              </p>
            </div>
            {excludedSlots.size > 0 && (
              <button type="button" onClick={resetExcludedSlots} className={buttonClass('quiet')}>
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
                  className={`lbl flex items-center justify-between gap-2 rounded-[6px] border px-3 py-2.5 text-left transition-colors ${
                    isEnabled
                      ? 'border-gold-edge bg-gold-tint text-on-surface hover:bg-gold/20'
                      : 'border-line/[0.06] bg-surface-container-high text-fg-4 hover:text-outline'
                  }`}
                >
                  <span className={isEnabled ? '' : 'line-through'}>{slot}</span>
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${isEnabled ? 'bg-gold-fill' : 'bg-overlay/[0.11]'}`}
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
