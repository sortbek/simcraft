'use client';

import { useCallback, useEffect, useState } from 'react';
import ErrorAlert from '../ui/ErrorAlert';
import { useSimContext } from '../sim-config/SimContext';
import { useLanguage } from '../../lib/i18n';
import ForeverCharacterCard from './ForeverCharacterCard';
import ForeverFooter from './ForeverFooter';
import ForeverSettingsCard from './ForeverSettingsCard';
import { blockedReason } from './specs';
import { useForeverImport } from './useForeverImport';
import { useForeverSettings } from './useForeverSettings';
import { useForeverSubmit } from './useForeverSubmit';

export default function ForeverQuickSim() {
  const { simcInput } = useSimContext();
  const { t } = useLanguage();
  const { summary, error } = useForeverImport(simcInput);
  const settings = useForeverSettings();
  const [specKey, setSpecKey] = useState<string | null>(null);
  useEffect(() => setSpecKey(summary?.spec_key ?? null), [summary?.spec_key]);
  const blocked = summary ? blockedReason(summary.level, specKey) : null;

  const buildPayload = useCallback(
    () =>
      summary && !blocked
        ? {
            simc_input: simcInput,
            spec_key: specKey,
            iterations: settings.iterations,
            max_time: settings.fightLength,
          }
        : null,
    [summary, blocked, simcInput, specKey, settings.iterations, settings.fightLength]
  );
  const {
    submit,
    submitting,
    error: submitError,
  } = useForeverSubmit('/api/forever/sim', buildPayload);

  return (
    <>
      {error && <ErrorAlert message={error} />}
      {summary && (
        <>
          <ForeverSettingsCard {...settings} />
          <ForeverCharacterCard summary={summary} specKey={specKey} onSpecChange={setSpecKey} />
        </>
      )}
      <ErrorAlert message={submitError} />
      <ForeverFooter
        onSubmit={submit}
        submitting={submitting}
        disabled={!summary || !!blocked}
        label={t('button.runSimulation')}
        status={blocked ? t(`forever.blocked.${blocked}`) : null}
      />
    </>
  );
}
