'use client';

import { useCallback, useMemo } from 'react';
import ErrorAlert from '../ui/ErrorAlert';
import GearOverview from '../gear/GearOverview';
import { getCharacterRenderUrl } from '../gear/topGearResultsUtils';
import type { GearItem } from '../gear/gearOverviewTypes';
import { formatFightLength } from '../sim-config/settingsUi';
import { useSimContext } from '../sim-config/SimContext';
import { FOREVER_REALM } from '../../lib/game';
import { useLanguage } from '../../lib/i18n';
import ForeverCharacterCard from './ForeverCharacterCard';
import ForeverFooter from './ForeverFooter';
import ForeverSettingsBlock from './ForeverSettingsBlock';
import { useForeverBuffs } from './useForeverBuffs';
import { useForeverTalents } from './useForeverTalents';
import ForeverTalentCard from './ForeverTalentCard';
import ForeverWarnings from './ForeverWarnings';
import { blockedReason } from './specs';
import { useForeverImport } from './useForeverImport';
import { useForeverSettings } from './useForeverSettings';
import { useForeverSpec } from './useForeverSpec';
import { useForeverSubmit } from './useForeverSubmit';

const NO_INFO = {};

export default function ForeverQuickSim() {
  const { simcInput } = useSimContext();
  const { t } = useLanguage();
  const talents = useForeverTalents(simcInput);
  const { summary, error } = useForeverImport(simcInput, talents.edited);
  const settings = useForeverSettings();
  const [specKey, setSpecKey] = useForeverSpec(simcInput, summary?.spec_key ?? null);
  const blocked = summary ? blockedReason(summary.level, summary.has_sheet, specKey) : null;
  const buffs = useForeverBuffs((specKey && summary?.sim_options?.[specKey]) || null);

  const gear = useMemo<Record<string, GearItem>>(
    () =>
      Object.fromEntries(
        (summary?.equipped ?? []).map((g) => [
          g.slot,
          {
            slot: g.slot,
            item_id: g.item_id,
            ilevel: g.ilevel,
            name: g.name,
            icon: g.icon,
            quality: g.quality,
          },
        ])
      ),
    [summary]
  );

  const buildPayload = useCallback(
    () =>
      summary && !blocked
        ? {
            simc_input: simcInput,
            spec_key: specKey,
            iterations: settings.iterations,
            max_time: settings.fightLength,
            ...buffs?.payload,
            talents_string: talents.edited ?? undefined,
          }
        : null,
    [
      summary,
      blocked,
      simcInput,
      specKey,
      settings.iterations,
      settings.fightLength,
      buffs,
      talents.edited,
    ]
  );
  const {
    submit,
    submitting,
    error: submitError,
  } = useForeverSubmit('/api/forever/sim', buildPayload);
  const buildComparePayload = useCallback(
    () =>
      summary && !blocked
        ? {
            simc_input: simcInput,
            spec_key: specKey,
            iterations: settings.iterations,
            max_time: settings.fightLength,
            ...buffs?.payload,
            builds: [
              {
                name: t('forever.exportedTalents'),
                talents_string: summary.exported_talents_string,
              },
              ...talents.builds,
            ],
          }
        : null,
    [
      summary,
      blocked,
      simcInput,
      specKey,
      settings.iterations,
      settings.fightLength,
      buffs,
      talents.builds,
      t,
    ]
  );
  const compare = useForeverSubmit('/api/forever/talent-compare', buildComparePayload);

  const status = blocked
    ? t(`forever.blocked.${blocked}`)
    : t('forever.summary', {
        length: formatFightLength(settings.fightLength),
        iterations: settings.iterations.toLocaleString(),
      });

  return (
    <>
      {error && <ErrorAlert message={error} />}
      {summary && (
        <>
          <ForeverCharacterCard summary={summary} specKey={specKey} />
          <ForeverWarnings warnings={summary.warnings} />
          <ForeverSettingsBlock
            {...settings}
            buffs={buffs}
            levelling={(summary?.level ?? 60) < 60}
          />
          <ForeverTalentCard
            summary={summary}
            specKey={specKey}
            onSpecChange={setSpecKey}
            talents={talents}
            compare={compare}
          />
          {summary.equipped.length > 0 && (
            <GearOverview
              gear={gear}
              title={t('gear.equippedGear')}
              characterRenderUrl={
                summary.region
                  ? getCharacterRenderUrl(FOREVER_REALM, summary.name, summary.region)
                  : null
              }
              itemInfoMap={NO_INFO}
              enchantInfoMap={NO_INFO}
              gemInfoMap={NO_INFO}
            />
          )}
        </>
      )}
      <ErrorAlert message={submitError} />
      <ForeverFooter
        onSubmit={submit}
        submitting={submitting}
        disabled={!summary || !!blocked}
        label={t('button.runSimulation')}
        status={summary ? status : null}
      />
    </>
  );
}
