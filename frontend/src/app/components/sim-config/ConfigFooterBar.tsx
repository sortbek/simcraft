'use client';

import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import RunButton from './RunButton';
import type { ComputeChoice } from '../../lib/useComputeChoice';
import type { ReactNode } from 'react';

interface ConfigFooterBarProps {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  onSubmit: () => void;
  submitting: boolean;
  buttonLabel: string;
  disabled?: boolean;
  /** Show an inline stat-weights opt-in toggle. Quick Sim only — staged flows
   * (Top Gear, Drop Finder) compute scale factors per-actor which is too expensive. */
  showStatWeightsToggle?: boolean;
  compute: ComputeChoice;
  onComputeChange: (v: ComputeChoice) => void;
  computeTargetDisabledReasons?: Record<string, string>;
  /** Optional second line for the Run button (e.g. cloud cost estimate). */
  subLabel?: ReactNode;
}

export default function ConfigFooterBar({
  drawerOpen,
  onToggleDrawer,
  onSubmit,
  submitting,
  buttonLabel,
  disabled,
  showStatWeightsToggle,
  compute,
  onComputeChange,
  computeTargetDisabledReasons,
  subLabel,
}: ConfigFooterBarProps) {
  const { t } = useLanguage();
  const { fightStyle, fightLength, targetCount, statWeights, setStatWeights } = useSimContext();
  const fightLengthLabel = `${Math.floor(fightLength / 60)}:${String(fightLength % 60).padStart(2, '0')}`;

  return (
    <div className="border-t border-outline-variant/10 bg-[#131313]/95 shadow-[0_-4px_20px_rgba(0,0,0,0.4)] backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-screen-2xl items-center gap-6 px-8">
        <div className="flex items-center gap-4 text-sm text-on-surface-variant">
          <span className="font-headline font-bold uppercase">{fightStyle}</span>
          <span className="h-4 w-px bg-outline-variant/30" />
          <span className="font-mono tabular-nums">{fightLengthLabel}</span>
          <span className="h-4 w-px bg-outline-variant/30" />
          <span className="font-mono tabular-nums">
            {targetCount} {targetCount === 1 ? t('config.boss') : t('config.bosses')}
          </span>
          {showStatWeightsToggle && (
            <>
              <span className="h-4 w-px bg-outline-variant/30" />
              <label
                className="flex cursor-pointer select-none items-center gap-2"
                title={t('config.statWeightsHint')}
              >
                <input
                  type="checkbox"
                  checked={statWeights}
                  onChange={(e) => setStatWeights(e.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                <span className="text-[11px] font-bold uppercase tracking-widest">
                  {t('config.statWeights')}
                </span>
              </label>
            </>
          )}
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={onToggleDrawer}
          className={`flex items-center gap-2 rounded-lg px-4 py-3 text-xs font-bold uppercase tracking-widest transition-all ${
            drawerOpen
              ? 'bg-primary/10 text-primary'
              : 'text-on-surface-variant hover:bg-surface-container-high hover:text-primary'
          }`}
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="8" cy="8" r="2" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
          </svg>
          {drawerOpen ? t('common.close') : t('common.options')}
        </button>

        <RunButton
          value={compute}
          onChange={onComputeChange}
          onRun={onSubmit}
          submitting={submitting}
          buttonLabel={buttonLabel}
          disabled={disabled}
          targetDisabledReasons={computeTargetDisabledReasons}
          subLabel={subLabel}
        />
      </div>
    </div>
  );
}
