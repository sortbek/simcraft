'use client';

import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../../lib/i18n/LanguageContext';
import { cn } from '../../lib/cn';
import { useDismiss } from '../../lib/useDismiss';
import { useAnchoredPopup } from '../ui/useAnchoredPopup';

const MAX_CHARGES = 10;
const PICKER_WIDTH = 248;

/** Charge-count badge for the Catalyst option; opens a 1–10 picker. Shown
 *  whether or not the Catalyst is on, so the count is always visible. */
export default function CatalystChargesPicker({
  charges,
  active,
  onChange,
}: {
  charges: number;
  active: boolean;
  onChange: (charges: number) => void;
}) {
  const { t } = useLanguage();
  const popup = useAnchoredPopup<HTMLButtonElement>(PICKER_WIDTH, 'end');
  const panelRef = useRef<HTMLDivElement>(null);
  useDismiss(panelRef, popup.open, popup.hide, popup.ref);

  return (
    <>
      <button
        ref={popup.ref}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={popup.open}
        aria-label={t('topGear.changeCharges', { count: charges })}
        onClick={popup.open ? popup.hide : popup.show}
        className={cn(
          'mr-2 inline-grid h-[18px] min-w-[20px] place-items-center rounded-[4px] px-[5px] text-[11px] tabular-nums tracking-normal outline-none transition-colors focus-visible:ring-1 focus-visible:ring-gold/55',
          active
            ? 'bg-gold-fill text-on-primary hover:bg-gold-fill-hover'
            : 'bg-overlay/[0.08] text-on-surface-variant hover:bg-overlay/[0.14] hover:text-on-surface'
        )}
      >
        {charges}
      </button>
      {popup.style &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={t('topGear.catalystCharges')}
            className="popover fixed z-[100] p-3"
            style={popup.style}
          >
            <span className="lbl">{t('topGear.catalystCharges')}</span>
            <div className="mt-2.5 grid grid-cols-5 gap-1">
              {Array.from({ length: MAX_CHARGES }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={n === charges}
                  onClick={() => {
                    onChange(n);
                    popup.hide();
                  }}
                  className={cn(
                    'h-8 rounded-[6px] border font-headline text-[12.5px] font-extrabold tabular-nums transition-colors',
                    n === charges
                      ? 'border-gold-fill bg-gold-fill text-on-primary'
                      : 'border-line/[0.06] bg-surface-container-high text-on-surface-variant hover:border-line/20 hover:text-on-surface'
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-xs leading-snug text-outline">
              {t('topGear.catalystChargesHint')}
            </p>
          </div>,
          document.body
        )}
    </>
  );
}
