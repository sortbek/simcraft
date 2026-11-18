'use client';

import { useCallback, useMemo } from 'react';
import ErrorAlert from '../ui/ErrorAlert';
import GearOverview from '../gear/GearOverview';
import { getCharacterRenderUrl } from '../gear/topGearResultsUtils';
import type { GearItem } from '../gear/gearOverviewTypes';
import { formatFightLength } from '../sim-config/settingsUi';
import { FOREVER_REALM } from '../../lib/game';
import { useLanguage } from '../../lib/i18n';
import ForeverCharacterCard from './ForeverCharacterCard';
import ForeverFooter from './ForeverFooter';
import ForeverSettingsBlock from './ForeverSettingsBlock';
import ForeverTalentCard from './ForeverTalentCard';
import ForeverWarnings from './ForeverWarnings';
import { useForeverPage } from './useForeverPage';
import { useForeverSubmit } from './useForeverSubmit';
import { useForeverSd } from './useForeverSd';

const NO_INFO = {};

export default function ForeverQuickSim() {
  const { t } = useLanguage();
  const { summary, error, talents, settings, specKey, setSpecKey, blocked, buffs, base, compare } =
    useForeverPage();
  const [sd] = useForeverSd();

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
    () => (base ? { ...base, talents_string: talents.edited ?? undefined } : null),
    [base, talents.edited]
  );
  const {
    submit,
    submitting,
    error: submitError,
  } = useForeverSubmit('/api/forever/sim', buildPayload);

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
                  ? getCharacterRenderUrl(FOREVER_REALM, summary.name, summary.region, sd)
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
