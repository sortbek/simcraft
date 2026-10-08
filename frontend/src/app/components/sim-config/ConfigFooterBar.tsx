'use client';

import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import RunButton from './RunButton';
import { OPEN_SIM_SETTINGS_EVENT, useSimSettingsSummary } from './SimSettingsBlock';
import { isDefaultProfile } from '../../lib/sim-profiles';
import Switch from '../ui/Switch';
import type { ComputeChoice } from '../../lib/useComputeChoice';
import type { ReactNode } from 'react';

interface ConfigFooterBarProps {
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
  const { statWeights, setStatWeights, activeProfile, profileDirty } = useSimContext();
  const summary = useSimSettingsSummary();
  const profileName = activeProfile
    ? isDefaultProfile(activeProfile)
      ? t('profiles.default')
      : activeProfile.name
    : null;

  return (
    <div className="config-footer border-t border-line/[0.06] bg-background">
      <div className="mx-auto flex max-w-screen-2xl items-center gap-3.5 px-8 py-3.5">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_SIM_SETTINGS_EVENT))}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left text-[12.5px] font-semibold text-outline transition-colors hover:text-on-surface-variant"
        >
          {profileName && (
            <span className="flex shrink-0 items-center gap-1.5 font-headline text-[12.5px] font-extrabold text-on-surface">
              <span className="max-w-[160px] truncate">{profileName}</span>
              {profileDirty && (
                <span
                  title={t('simSettings.unsaved')}
                  className="inline-block h-1.5 w-1.5 rounded-full bg-gold-fill"
                />
              )}
            </span>
          )}
          <span className="config-footer-summary-text min-w-0 truncate">
            {summary.fight} · {summary.buffs} · {summary.consumables}
          </span>
          <span className="shrink-0 font-headline text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-gold">
            {t('simSettings.edit')}
          </span>
        </button>

        {showStatWeightsToggle && (
          <label
            className="lbl flex shrink-0 cursor-pointer select-none items-center gap-2.5"
            title={t('config.statWeightsHint')}
          >
            <Switch
              checked={statWeights}
              onChange={setStatWeights}
              className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold/55"
            />
            <span className="config-footer-hide-sm text-on-surface-variant">
              {t('config.statWeights')}
            </span>
          </label>
        )}

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
