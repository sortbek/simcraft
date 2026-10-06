'use client';

import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import RunButton from './RunButton';
import ProfilePicker from './ProfilePicker';
import { buttonClass } from '../ui/Button';
import Switch from '../ui/Switch';
import type { ComputeChoice } from '../../lib/useComputeChoice';
import type { ReactNode } from 'react';

interface ConfigFooterBarProps {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  onSubmit: () => void;
  submitting: boolean;
  buttonLabel: string;
  disabled?: boolean;
  /** Inline stat-weights opt-in toggle. Quick Sim only — staged flows compute
   * scale factors per-actor, which is too expensive. */
  showStatWeightsToggle?: boolean;
  compute: ComputeChoice;
  onComputeChange: (v: ComputeChoice) => void;
  computeTargetDisabledReasons?: Record<string, string>;
  /** Optional second line for the Run button (e.g. cloud cost estimate). */
  subLabel?: ReactNode;
  /** Optional status segment in the left info group (e.g. Top Gear combo count). */
  status?: ReactNode;
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
  status,
}: ConfigFooterBarProps) {
  const { t } = useLanguage();
  const { fightStyle, fightLength, targetCount, statWeights, setStatWeights } = useSimContext();
  const fightLengthLabel = `${Math.floor(fightLength / 60)}:${String(fightLength % 60).padStart(2, '0')}`;

  return (
    <div className="border-t border-line/[0.06] bg-background/90 backdrop-blur-lg">
      <div className="mx-auto flex max-w-screen-2xl items-center gap-3.5 px-8 py-3.5">
        <ProfilePicker />
        <div className="flex items-center gap-[22px]">
          <div className="flex flex-col gap-[5px]">
            <span className="lbl">{t('config.fightStyle')}</span>
            <b className="font-headline text-[13px] font-extrabold text-on-surface">
              {fightStyle} · <span className="tabular-nums">{fightLengthLabel}</span>
            </b>
          </div>
          <div className="flex flex-col gap-[5px]">
            <span className="lbl">{t('results.targets')}</span>
            <b className="font-headline text-[13px] font-extrabold tabular-nums text-on-surface">
              {targetCount} {targetCount === 1 ? t('config.boss') : t('config.bosses')}
            </b>
          </div>
        </div>

        <div className="flex-1" />

        {showStatWeightsToggle && (
          <label
            className="lbl flex cursor-pointer select-none items-center gap-2.5"
            title={t('config.statWeightsHint')}
          >
            <Switch
              checked={statWeights}
              onChange={setStatWeights}
              className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold/55"
            />
            <span className="text-on-surface-variant">{t('config.statWeights')}</span>
          </label>
        )}

        <button
          type="button"
          onClick={onToggleDrawer}
          className={`${buttonClass('quiet')} ${drawerOpen ? '!border-line/20 !text-on-surface' : ''}`}
        >
          <svg
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

        {status}

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
