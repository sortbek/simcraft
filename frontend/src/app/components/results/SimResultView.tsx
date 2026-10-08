'use client';

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import DpsHeroCard from './DpsHeroCard';
import GearOverview from '../gear/GearOverview';
import ResultsChart from './ResultsChart';
import SimSetup from './SimSetup';
import StatWeightsTable from './StatWeightsTable';
import TalentTree from '../talents/TalentTree';
import TopGearResults from '../gear/TopGearResults';
import { useEnchantInfo, useGemInfo, useItemInfo } from '../../lib/useItemInfo';
import { isGearComparisonResult, type SimResult } from '../../lib/simResultTypes';
import { collectEnchantIds, collectGemIds, collectItemQueries } from '../gear/gearOverviewUtils';
import { VIEWER_BUILD } from '../../lib/featureFlags';
import { decodeHeader } from '../../lib/talentDecode';
import { cachedTalentTree } from '../../lib/useTalentTree';

// The viewer build has no backend to fetch a talent tree it wasn't shipped with
// (shares made before lookups existed). Rather than spin forever, just hide the
// section — normal app behavior (always render, let TalentTree fetch) is unchanged.
function canShowTalents(talentString?: string): boolean {
  if (!talentString) return false;
  if (!VIEWER_BUILD) return true;
  try {
    return !!cachedTalentTree(decodeHeader(talentString).specId);
  } catch {
    return false;
  }
}

export default function SimResultView({
  result,
  sourceJobId,
  backLink,
  actions,
}: {
  result: SimResult;
  sourceJobId?: string;
  backLink?: ReactNode;
  actions?: ReactNode;
}) {
  // Info maps for the non-TopGear GearOverview. Hooks must be unconditional,
  // so we derive safe empty inputs when the result is absent or is a TopGear result.
  const nonTgGear = useMemo(
    () => (!isGearComparisonResult(result) ? (result.equipped_gear ?? {}) : {}),
    [result]
  );
  const goItemQueries = useMemo(() => collectItemQueries(nonTgGear), [nonTgGear]);
  const goEnchantIds = useMemo(() => collectEnchantIds(nonTgGear), [nonTgGear]);
  const goGemIds = useMemo(() => collectGemIds(nonTgGear), [nonTgGear]);
  const goItemInfo = useItemInfo(goItemQueries);
  const goEnchantInfo = useEnchantInfo(goEnchantIds);
  const goGemInfo = useGemInfo(goGemIds);

  const headerActions =
    backLink || actions ? (
      <div className="flex max-w-[70vw] flex-wrap items-center justify-end gap-2">
        {backLink}
        {actions}
      </div>
    ) : undefined;

  return isGearComparisonResult(result) ? (
    <>
      <TopGearResults
        playerName={result.player_name}
        playerClass={result.player_class}
        playerRealm={result.realm}
        playerRegion={result.region}
        baseDps={result.base_dps}
        results={result.results}
        equippedGear={result.equipped_gear}
        fightLength={result.fight_length}
        desiredTargets={result.desired_targets}
        iterations={result.iterations}
        targetError={result.target_error}
        elapsedTime={result.total_elapsed_seconds ?? result.elapsed_time_seconds}
        sourceJobId={typeof sourceJobId === 'string' ? sourceJobId : undefined}
        backLink={headerActions}
        setup={result.setup ?? undefined}
      />
      {canShowTalents(result.talent_string) && <TalentTree talentString={result.talent_string} />}
    </>
  ) : (
    <>
      <DpsHeroCard
        playerName={result.player_name}
        playerClass={result.player_class}
        playerRealm={result.realm}
        playerRegion={result.region}
        dps={result.dps}
        fightLength={result.fight_length}
        desiredTargets={result.desired_targets}
        iterations={result.iterations}
        targetError={result.target_error}
        elapsedTime={result.total_elapsed_seconds ?? result.elapsed_time_seconds}
        baseDps={result.base_dps}
        topAction={headerActions}
        aside={result.setup ? <SimSetup setup={result.setup} /> : undefined}
      />
      {result.equipped_gear && Object.keys(result.equipped_gear).length > 0 ? (
        <GearOverview
          gear={result.equipped_gear}
          characterRenderUrl={
            result.realm && result.player_name
              ? `https://simhammer.com/api/blizzard/character/${result.region || 'eu'}/${encodeURIComponent(result.realm.toLowerCase())}/${encodeURIComponent(result.player_name.toLowerCase())}/media/render`
              : null
          }
          itemInfoMap={goItemInfo}
          enchantInfoMap={goEnchantInfo}
          gemInfoMap={goGemInfo}
        />
      ) : null}
      {result.stat_weights ? <StatWeightsTable statWeights={result.stat_weights} /> : null}
      {canShowTalents(result.talent_string) && <TalentTree talentString={result.talent_string} />}
      <ResultsChart dps={result.dps} abilities={result.abilities ?? []} />
    </>
  );
}
