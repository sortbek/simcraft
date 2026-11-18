'use client';

import { useCallback, useMemo } from 'react';
import { useLanguage } from '../../lib/i18n';
import { useSimContext } from '../sim-config/SimContext';
import { blockedReason } from './specs';
import { useForeverBuffs } from './useForeverBuffs';
import { useForeverImport } from './useForeverImport';
import { useForeverSettings } from './useForeverSettings';
import { useForeverSpec } from './useForeverSpec';
import { useForeverSubmit } from './useForeverSubmit';
import { useForeverTalents } from './useForeverTalents';

/** What every Forever sim page shares: the import, spec, settings, buffs and talents, the fields
 *  every sim request carries, and the talent compare. */
export function useForeverPage() {
  const { simcInput } = useSimContext();
  const { t } = useLanguage();
  const talents = useForeverTalents(simcInput);
  const { summary, error } = useForeverImport(simcInput, talents.edited);
  const settings = useForeverSettings();
  const [specKey, setSpecKey] = useForeverSpec(simcInput, summary?.spec_key ?? null);
  const blocked = summary ? blockedReason(summary.level, summary.has_sheet, specKey) : null;
  const buffs = useForeverBuffs((specKey && summary?.sim_options?.[specKey]) || null);

  /** The fields every Forever sim request carries; null while the character can't sim. */
  const base = useMemo(
    () =>
      summary && !blocked
        ? {
            simc_input: simcInput,
            spec_key: specKey,
            iterations: settings.iterations,
            max_time: settings.fightLength,
            ...buffs?.payload,
          }
        : null,
    [summary, blocked, simcInput, specKey, settings.iterations, settings.fightLength, buffs]
  );

  const buildComparePayload = useCallback(
    () =>
      base && summary
        ? {
            ...base,
            builds: [
              {
                name: t('forever.exportedTalents'),
                talents_string: summary.exported_talents_string,
              },
              ...talents.builds,
            ],
          }
        : null,
    [base, summary, talents.builds, t]
  );
  const compare = useForeverSubmit('/api/forever/talent-compare', buildComparePayload);

  return {
    simcInput,
    summary,
    error,
    talents,
    settings,
    specKey,
    setSpecKey,
    blocked,
    buffs,
    base,
    compare,
  };
}
