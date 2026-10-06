'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useProviders, useReadyRemoteProviders } from '../../lib/providers';
import type { ComputeChoice } from '../../lib/useComputeChoice';
import { useLanguage } from '../../lib/i18n';
import { buttonClass } from '../ui/Button';

interface RunButtonProps {
  value: ComputeChoice;
  onChange: (v: ComputeChoice) => void;
  onRun: () => void;
  submitting: boolean;
  buttonLabel: string;
  disabled?: boolean;
  /** target id -> disable reason; absent = enabled.
   *  e.g. { simmit: 'too large for cloud' } (page-owned) or generic 'configure in Settings'. */
  targetDisabledReasons?: Record<string, string>;
  /** Optional second line under the main label (e.g. cloud cost estimate). Caller
   *  owns content and styling; the button only renders it. */
  subLabel?: ReactNode;
}

// Mock `.runbtn`: solid gold, 44px tall, square inner joins on the split button.
const GOLD = buttonClass('solid', 'lg');

export default function RunButton({
  value,
  onChange,
  onRun,
  submitting,
  buttonLabel,
  disabled,
  targetDisabledReasons = {},
  subLabel,
}: RunButtonProps) {
  const { t } = useLanguage();
  const providers = useProviders();
  const readyRemotes = useReadyRemoteProviders();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Self-heal a stale/unavailable selection: a persisted `compute` can name a remote
  // no longer configured or one the page disabled. Coerce back to "auto" so neither the
  // primary action nor the collapsed button submits a disabled/stale target.
  const selectedRemoteUnavailable =
    value !== 'auto' &&
    value !== 'local' &&
    (!readyRemotes.some((p) => p.id === value) || !!targetDisabledReasons[value]);
  useEffect(() => {
    if (providers === null) return; // wait for providers to load before coercing
    if (selectedRemoteUnavailable) onChange('auto');
    // onChange is an unstable per-render setter; gate on the availability primitives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, value, selectedRemoteUnavailable]);

  const spinner = (
    <>
      <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
        <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {t('config.running')}
    </>
  );

  // Synchronous guard complementing the self-heal effect: disable the primary action
  // while the selected remote is unavailable (stale choice pending coercion to auto),
  // so no button submits a stale/disabled target in the render before the effect fires.
  const runDisabled = disabled || submitting || selectedRemoteUnavailable;

  // No usable remote → no real choice → plain Run button (collapse rule).
  if (readyRemotes.length === 0) {
    return (
      <button type="button" onClick={onRun} disabled={runDisabled} className={GOLD}>
        {submitting ? (
          spinner
        ) : (
          <span className="flex flex-col items-start leading-tight">
            <span>{buttonLabel}</span>
            {subLabel && (
              <span className="mt-0.5 text-[11px] font-semibold normal-case tracking-normal">
                {subLabel}
              </span>
            )}
          </span>
        )}
      </button>
    );
  }

  const targetLabel =
    value === 'auto'
      ? t('config.computeAuto')
      : value === 'local'
        ? t('config.computeLocal')
        : (providers?.find((p) => p.id === value)?.display_name ?? value);

  const remoteMeta = (providers ?? []).filter((p) => p.id !== 'local');
  const options: { id: ComputeChoice; label: string }[] = [
    { id: 'auto', label: t('config.computeAuto') },
    { id: 'local', label: t('config.computeLocal') },
    ...remoteMeta.map((p) => ({ id: p.id as ComputeChoice, label: p.display_name })),
  ];

  const reasonFor = (id: ComputeChoice): string | null => {
    if (id === 'auto' || id === 'local') return null;
    if (targetDisabledReasons[id]) return targetDisabledReasons[id];
    if (!readyRemotes.some((p) => p.id === id)) return t('config.configureInSettings');
    return null;
  };

  return (
    <div className="relative flex" ref={rootRef}>
      <button
        type="button"
        onClick={onRun}
        disabled={runDisabled}
        className={`${GOLD} !rounded-r-none`}
      >
        {submitting ? (
          spinner
        ) : (
          <span className="flex flex-col items-start leading-tight">
            <span className="flex items-center gap-2">
              {buttonLabel}
              <span className="opacity-50">·</span>
              <span className="font-bold normal-case tracking-normal">{targetLabel}</span>
            </span>
            {subLabel && (
              <span className="mt-0.5 text-[11px] font-semibold normal-case tracking-normal">
                {subLabel}
              </span>
            )}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('config.chooseComputeTarget')}
        onClick={() => setOpen((o) => !o)}
        disabled={submitting}
        className={`${buttonClass('solid', 'lg')} !rounded-l-none !border-l-on-primary/25 !px-3`}
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="popover absolute bottom-full right-0 mb-2 min-w-[230px] overflow-hidden py-1"
        >
          {options.map((opt) => {
            const reason = reasonFor(opt.id);
            const isDisabled = !!reason;
            const checked = value === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                aria-disabled={isDisabled}
                disabled={isDisabled}
                onClick={() => {
                  if (!isDisabled) {
                    onChange(opt.id);
                    setOpen(false);
                  }
                }}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  isDisabled
                    ? 'cursor-not-allowed text-on-surface-variant/40'
                    : 'text-on-surface hover:bg-surface-container-highest'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className={`w-3.5 ${checked ? 'text-primary' : 'opacity-0'}`}>✓</span>
                  {opt.label}
                </span>
                {reason && <span className="text-[11px] text-on-surface-variant/50">{reason}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
