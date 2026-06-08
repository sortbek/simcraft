'use client';

import { useMemo, useState } from 'react';
import DpsHeroCard from '../results/DpsHeroCard';
import GearOverview from './GearOverview';
import TopGearRankings from './TopGearRankings';
import { useEnchantInfo, useGemInfo, useItemInfo } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import { useWowheadTooltips, wowheadKeyFor } from '../../lib/useWowheadTooltips';
import type { GroupMode, TopGearResultsProps } from './topGearResultsTypes';
import {
  buildBestGearSet,
  collectDowngradeSlots,
  collectEnchantIds,
  collectGemIds,
  collectItemQueries,
  collectUpgradeSlots,
  dedupeEncounterResults,
  getCharacterRenderUrl,
} from './topGearResultsUtils';

export default function TopGearResults({
  playerName,
  playerClass,
  playerRealm,
  playerRegion,
  baseDps,
  results,
  equippedGear,
  fightLength,
  desiredTargets,
  iterations,
  targetError,
  elapsedTime,
  backLink,
  sourceJobId,
  sourceIsStreamed,
}: TopGearResultsProps) {
  const { t } = useLanguage();
  const hasEncounterData = results.some((result) => result.items.some((item) => item.encounter));

  const activeResults = useMemo(() => {
    return dedupeEncounterResults(results, hasEncounterData);
  }, [results, hasEncounterData]);

  const maxDps = activeResults.length > 0 ? activeResults[0].dps : baseDps;
  const bestResult = activeResults.length > 0 ? activeResults[0] : null;

  const [groupMode, setGroupMode] = useState<GroupMode>(hasEncounterData ? 'slot' : 'rank');
  const [selectedResultName, setSelectedResultName] = useState<string | null>(null);

  const selectedResult = useMemo(() => {
    if (selectedResultName) {
      return activeResults.find((result) => result.name === selectedResultName) || bestResult;
    }
    return bestResult;
  }, [selectedResultName, activeResults, bestResult]);

  const bestGearSet = useMemo(() => {
    return buildBestGearSet(equippedGear, selectedResult);
  }, [equippedGear, selectedResult]);

  const upgradeSlots = useMemo(() => collectUpgradeSlots(selectedResult), [selectedResult]);
  const downgradeSlots = useMemo(() => collectDowngradeSlots(selectedResult), [selectedResult]);

  const allItemQueries = useMemo(() => {
    return collectItemQueries(results, equippedGear);
  }, [results, equippedGear]);
  const itemInfoMap = useItemInfo(allItemQueries);

  const allEnchantIds = useMemo(
    () => collectEnchantIds(results, equippedGear),
    [results, equippedGear]
  );
  const enchantInfoMap = useEnchantInfo(allEnchantIds);

  const allGemIds = useMemo(() => collectGemIds(results, equippedGear), [results, equippedGear]);
  const gemInfoMap = useGemInfo(allGemIds);

  const wowheadKey = useMemo(
    () => wowheadKeyFor({ item: itemInfoMap, enchant: enchantInfoMap, gem: gemInfoMap }),
    [itemInfoMap, enchantInfoMap, gemInfoMap]
  );
  useWowheadTooltips([wowheadKey]);

  const hasGearOverview = equippedGear && Object.keys(equippedGear).length > 0;
  const characterRenderUrl = getCharacterRenderUrl(playerRealm, playerName, playerRegion);

  return (
    <div className="space-y-6">
      <DpsHeroCard
        playerName={playerName}
        playerClass={playerClass}
        playerRealm={playerRealm}
        playerRegion={playerRegion}
        dps={selectedResult && selectedResult.delta > 0 ? selectedResult.dps : baseDps}
        fightLength={fightLength}
        desiredTargets={desiredTargets}
        iterations={iterations}
        targetError={targetError}
        elapsedTime={elapsedTime}
        topAction={backLink}
      >
        {selectedResult && selectedResult.delta > 0 ? (
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-3 py-1.5 text-emerald-400">
            <span className="text-sm font-semibold tabular-nums">
              +{Math.round(selectedResult.delta).toLocaleString()}
            </span>
            <span className="text-xs opacity-60">{t('gear.upgradeText')}</span>
          </div>
        ) : (
          <p className="mt-4 text-sm text-on-surface-variant">{t('gear.currentGearOptimal')}</p>
        )}
      </DpsHeroCard>

      {hasGearOverview && (
        <GearOverview
          gear={bestGearSet}
          title={
            selectedResultName && selectedResultName !== bestResult?.name
              ? t('gear.selectedGear')
              : t('gear.bestGear')
          }
          characterRenderUrl={characterRenderUrl}
          upgradeSlots={upgradeSlots}
          downgradeSlots={downgradeSlots}
          itemInfoMap={itemInfoMap}
          enchantInfoMap={enchantInfoMap}
          gemInfoMap={gemInfoMap}
        />
      )}

      <TopGearRankings
        results={activeResults}
        maxDps={maxDps}
        baseDps={baseDps}
        targetError={targetError}
        hasEncounterData={hasEncounterData}
        groupMode={groupMode}
        onGroupModeChange={setGroupMode}
        selectedResultName={selectedResultName}
        onSelectResult={setSelectedResultName}
        itemInfoMap={itemInfoMap}
        enchantInfoMap={enchantInfoMap}
        gemInfoMap={gemInfoMap}
        sourceJobId={sourceJobId}
        sourceIsStreamed={sourceIsStreamed}
      />
    </div>
  );
}
