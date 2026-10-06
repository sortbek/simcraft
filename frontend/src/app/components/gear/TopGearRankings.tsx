'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SLOT_LABELS } from '../../lib/types';
import type { EnchantInfo, GemInfo, ItemInfo } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import type { GroupMode, TopGearResult } from './topGearResultsTypes';
import { ResultRow } from './ResultRow';
import CardHeader from '../ui/CardHeader';
import ToggleButtonGroup from '../ui/ToggleButtonGroup';
import { bestDelta, bestPerItem, expectedDelta, groupResults } from './topGearResultsUtils';

/** Rows revealed per step. The ranked list starts here and grows by this much whenever the
 * scroll sentinel comes into view, so every result is reachable without mounting a huge sim's
 * full set upfront. Grouped views (slot/boss) are bounded by group size and render in full. */
const VISIBLE_STEP = 50;

interface TopGearRankingsProps {
  results: TopGearResult[];
  maxDps: number;
  baseDps: number;
  /** Configured target_error (%), shown in the per-row precision tooltip. */
  targetError?: number;
  hasEncounterData: boolean;
  groupMode: GroupMode;
  onGroupModeChange: (mode: GroupMode) => void;
  selectedResultName: string | null;
  onSelectResult: (name: string) => void;
  /** Result pinned as the comparison target ("B" side); rows show a "vs" button to pin/unpin. */
  compareResultName: string | null;
  onCompareResult: (name: string) => void;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  sourceJobId?: string;
}

export default function TopGearRankings({
  results,
  maxDps,
  baseDps,
  targetError,
  hasEncounterData,
  groupMode,
  onGroupModeChange,
  selectedResultName,
  onSelectResult,
  compareResultName,
  onCompareResult,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  sourceJobId,
}: TopGearRankingsProps) {
  const { t } = useLanguage();
  const grouped = useMemo(() => groupResults(results, groupMode), [results, groupMode]);

  return (
    <section className="card overflow-hidden">
      <CardHeader
        title={
          <>
            {t('gear.rankings')}
            <span className="ml-2 font-semibold normal-case tracking-[0.04em] text-outline">
              {t('gear.resultsCount', { count: results.length })}
            </span>
          </>
        }
        right={
          hasEncounterData && (
            <ToggleButtonGroup
              value={groupMode}
              onChange={onGroupModeChange}
              options={[
                { key: 'rank', label: t('gear.byRank') },
                { key: 'slot', label: t('gear.bySlot') },
                { key: 'encounter', label: t('gear.byBoss') },
              ]}
            />
          )
        }
      />

      {(groupMode === 'encounter' || groupMode === 'slot') && grouped ? (
        <div>
          {grouped.map(([groupKey, group]) => {
            const groupBest = bestDelta(group);
            // Same per-item collapse as the summary: a ring simmed in both
            // fingers is one outcome, not two.
            const avgDelta = expectedDelta(bestPerItem(group));
            const groupLabel = groupMode === 'slot' ? SLOT_LABELS[groupKey] || groupKey : groupKey;

            return (
              <div key={groupKey} className="border-b border-line/[0.06] last:border-b-0">
                <div className="flex items-center justify-between gap-3 border-b border-line/[0.06] bg-shade/[0.15] px-6 py-3">
                  <div className="flex items-center gap-3">
                    <span className="font-headline text-sm font-extrabold text-on-surface">
                      {groupLabel}
                    </span>
                    <span className="text-[12.5px] text-outline">
                      {t('gear.itemsCount', { count: group.length })}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-outline">
                      {t('gear.expectedUpgrade')}
                      <span
                        className={`font-headline font-extrabold ${avgDelta > 0 ? 'text-positive' : 'text-fg-4'}`}
                      >
                        {avgDelta > 0 ? `+${((avgDelta / baseDps) * 100).toFixed(2)}%` : '--'}
                      </span>
                    </span>
                    <span className="text-outline">
                      {t('gear.bestUpgrade')}
                      <span
                        className={`font-headline font-extrabold ${groupBest > 0 ? 'text-positive' : 'text-fg-4'}`}
                      >
                        {groupBest > 0 ? `+${((groupBest / baseDps) * 100).toFixed(2)}%` : '--'}
                      </span>
                    </span>
                  </div>
                </div>
                <div>
                  {group.map((result) => (
                    <ResultRow
                      key={result.name}
                      result={result}
                      maxDps={maxDps}
                      baseDps={baseDps}
                      isBest={result === results[0] && result.delta > 0}
                      isSelected={result.name === (selectedResultName || results[0]?.name)}
                      onSelect={onSelectResult}
                      isCompareTarget={result.name === compareResultName}
                      onCompare={onCompareResult}
                      itemInfoMap={itemInfoMap}
                      enchantInfoMap={enchantInfoMap}
                      gemInfoMap={gemInfoMap}
                      targetError={targetError}
                      sourceJobId={sourceJobId}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <RankedResults
          results={results}
          maxDps={maxDps}
          baseDps={baseDps}
          targetError={targetError}
          itemInfoMap={itemInfoMap}
          enchantInfoMap={enchantInfoMap}
          gemInfoMap={gemInfoMap}
          selectedResultName={selectedResultName}
          onSelectResult={onSelectResult}
          compareResultName={compareResultName}
          onCompareResult={onCompareResult}
          sourceJobId={sourceJobId}
        />
      )}
    </section>
  );
}

function RankedResults({
  results,
  maxDps,
  baseDps,
  targetError,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
  selectedResultName,
  onSelectResult,
  compareResultName,
  onCompareResult,
  sourceJobId,
}: {
  results: TopGearResult[];
  maxDps: number;
  baseDps: number;
  targetError?: number;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
  selectedResultName: string | null;
  onSelectResult: (name: string) => void;
  compareResultName: string | null;
  onCompareResult: (name: string) => void;
  sourceJobId?: string;
}) {
  const [visibleCount, setVisibleCount] = useState(VISIBLE_STEP);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Newly revealed rows mount fresh wowhead anchors after the info maps have
  // settled, so the map-keyed refresh in TopGearResults never re-fires for them.
  useWowheadTooltips([visibleCount]);

  useEffect(() => {
    setVisibleCount(VISIBLE_STEP);
  }, [results]);

  // Re-created on every reveal so a sentinel still in view (tall viewport, short list
  // growth) immediately fires the next step instead of waiting for another scroll.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= results.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + VISIBLE_STEP, results.length));
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [results, visibleCount]);

  const visible = results.slice(0, visibleCount);

  return (
    <div>
      {visible.map((result, idx) => (
        <ResultRow
          key={result.name}
          result={result}
          rank={idx + 1}
          maxDps={maxDps}
          baseDps={baseDps}
          targetError={targetError}
          isBest={idx === 0 && result.delta > 0}
          isSelected={result.name === (selectedResultName || results[0]?.name)}
          onSelect={onSelectResult}
          isCompareTarget={result.name === compareResultName}
          onCompare={onCompareResult}
          itemInfoMap={itemInfoMap}
          enchantInfoMap={enchantInfoMap}
          gemInfoMap={gemInfoMap}
          sourceJobId={sourceJobId}
        />
      ))}
      {visibleCount < results.length && <div ref={sentinelRef} className="h-px" />}
    </div>
  );
}
