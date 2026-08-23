'use client';

import { useCallback, useMemo, useState } from 'react';
import DpsHeroCard from '../results/DpsHeroCard';
import GearOverview from './GearOverview';
import TopGearRankings from './TopGearRankings';
import { useEnchantInfo, useGemInfo, useItemInfo } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import { useWowheadTooltips, wowheadKeyFor } from '../../lib/useWowheadTooltips';
import type { GearItem } from './gearOverviewTypes';
import type { EnchantInfo, GemInfo, ItemInfo } from '../../lib/useItemInfo';
import type { GroupMode, TopGearResult, TopGearResultsProps } from './topGearResultsTypes';
import {
  buildBestGearSet,
  collectDowngradeSlots,
  collectEnchantIds,
  collectGemIds,
  collectItemQueries,
  collectUpgradeSlots,
  dedupeEncounterResults,
  diffGearSets,
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
  const [compareResultName, setCompareResultName] = useState<string | null>(null);

  // Stable identity keeps ResultRow's memo effective across the (potentially long) list.
  const toggleCompareResult = useCallback((name: string) => {
    setCompareResultName((prev) => (prev === name ? null : name));
  }, []);

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

  // A-vs-B compare: a row pinned via its "vs" button becomes the B side; the selected
  // row stays A. Meaningless when both are the same row, so treat that as not comparing.
  const compareResult = useMemo(() => {
    if (!compareResultName) return null;
    return activeResults.find((result) => result.name === compareResultName) || null;
  }, [compareResultName, activeResults]);
  const isComparing =
    !!compareResult && !!selectedResult && compareResult.name !== selectedResult.name;

  const compareGearSet = useMemo(
    () => (isComparing ? buildBestGearSet(equippedGear, compareResult) : {}),
    [isComparing, equippedGear, compareResult]
  );
  // Compare highlight sets. Each panel rings only the disagreeing slots its OWN set
  // changed vs equipped — a slot the set kept stays unmarked even when the other side
  // changed it (the ring on the opposite panel's row carries the disagreement).
  // `shared` = slots where both sets carry the same change vs equipped.
  const compareSlots = useMemo(() => {
    const empty = () => new Set<string>();
    if (!isComparing) {
      return { selectedDiff: empty(), compareDiff: empty(), shared: empty() };
    }
    const diff = diffGearSets(bestGearSet, compareGearSet);
    const equippedSet = buildBestGearSet(equippedGear, null);
    const changedA = diffGearSets(bestGearSet, equippedSet);
    const changedB = diffGearSets(compareGearSet, equippedSet);
    return {
      selectedDiff: new Set([...changedA].filter((slot) => diff.has(slot))),
      compareDiff: new Set([...changedB].filter((slot) => diff.has(slot))),
      shared: new Set([...changedA].filter((slot) => changedB.has(slot) && !diff.has(slot))),
    };
  }, [isComparing, equippedGear, bestGearSet, compareGearSet]);

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

      {hasGearOverview &&
        (isComparing && selectedResult && compareResult ? (
          <CompareOverview
            selectedResult={selectedResult}
            compareResult={compareResult}
            selectedGearSet={bestGearSet}
            compareGearSet={compareGearSet}
            selectedDiffSlots={compareSlots.selectedDiff}
            compareDiffSlots={compareSlots.compareDiff}
            sharedSlots={compareSlots.shared}
            onClear={() => setCompareResultName(null)}
            itemInfoMap={itemInfoMap}
            enchantInfoMap={enchantInfoMap}
            gemInfoMap={gemInfoMap}
          />
        ) : (
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
        ))}

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
        compareResultName={compareResultName}
        onCompareResult={toggleCompareResult}
        itemInfoMap={itemInfoMap}
        enchantInfoMap={enchantInfoMap}
        gemInfoMap={gemInfoMap}
        sourceJobId={sourceJobId}
      />
    </div>
  );
}

/** Side-by-side A-vs-B gear panels: selected result left, pinned compare target right.
 * Slots that differ between the two sets get the ring highlight — emerald on the
 * higher-DPS side, red on the lower. */
function CompareOverview({
  selectedResult,
  compareResult,
  selectedGearSet,
  compareGearSet,
  selectedDiffSlots,
  compareDiffSlots,
  sharedSlots,
  onClear,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
}: {
  selectedResult: TopGearResult;
  compareResult: TopGearResult;
  selectedGearSet: Record<string, GearItem>;
  compareGearSet: Record<string, GearItem>;
  /** Disagreeing slots the selected set itself changed vs equipped (left panel's rings). */
  selectedDiffSlots: Set<string>;
  /** Disagreeing slots the compare target itself changed vs equipped (right panel's rings). */
  compareDiffSlots: Set<string>;
  sharedSlots: Set<string>;
  onClear: () => void;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
}) {
  const { t } = useLanguage();
  const delta = selectedResult.dps - compareResult.dps;
  const deltaPct = compareResult.dps > 0 ? (delta / compareResult.dps) * 100 : 0;
  const selectedWins = delta >= 0;

  return (
    <div className="space-y-3">
      <div className="card flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[14px]">
          <span className="truncate font-semibold text-on-surface">{selectedResult.name}</span>
          <span className="shrink-0 text-[12px] uppercase tracking-wider text-muted">
            {t('gear.compareVs')}
          </span>
          <span className="truncate font-semibold text-sky-300">{compareResult.name}</span>
          <span
            className={`shrink-0 font-mono text-[13px] tabular-nums ${
              delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-muted'
            }`}
          >
            {delta > 0 ? '+' : ''}
            {Math.round(delta).toLocaleString()} ({delta > 0 ? '+' : ''}
            {deltaPct.toFixed(2)}%)
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex items-center gap-3 text-[11px] text-on-surface-variant/70">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
              {t('gear.compareBetterSide')}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
              {t('gear.compareWorseSide')}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 shrink-0 rounded-full bg-sky-400" />
              {t('gear.compareSharedChange')}
            </span>
          </div>
          <button
            onClick={onClear}
            className="shrink-0 rounded border border-outline-variant/20 bg-surface-container-high/60 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
          >
            {t('gear.compareClear')}
          </button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <GearOverview
          gear={selectedGearSet}
          title={selectedResult.name}
          upgradeSlots={selectedWins ? selectedDiffSlots : undefined}
          downgradeSlots={selectedWins ? undefined : selectedDiffSlots}
          sharedSlots={sharedSlots}
          itemInfoMap={itemInfoMap}
          enchantInfoMap={enchantInfoMap}
          gemInfoMap={gemInfoMap}
        />
        <GearOverview
          gear={compareGearSet}
          title={compareResult.name}
          upgradeSlots={selectedWins ? undefined : compareDiffSlots}
          downgradeSlots={selectedWins ? compareDiffSlots : undefined}
          sharedSlots={sharedSlots}
          itemInfoMap={itemInfoMap}
          enchantInfoMap={enchantInfoMap}
          gemInfoMap={gemInfoMap}
        />
      </div>
    </div>
  );
}
