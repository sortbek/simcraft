'use client';

import { useMemo, useState } from 'react';
import DpsHeroCard from './DpsHeroCard';
import GearOverview from './GearOverview';
import type { GearItem } from './GearOverview';
import { SLOT_LABELS, specDisplayName } from '../lib/types';
import type { EnchantInfo, GemInfo, ItemInfo, ItemQuery } from '../lib/useItemInfo';
import {
    getIconUrl,
    getWowheadData,
    getWowheadUrl,
    QUALITY_COLORS,
    useEnchantInfo,
    useGemInfo,
    useItemInfo,
} from '../lib/useItemInfo';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';

interface ResultItem {
  slot: string;
  item_id: number;
  ilevel: number;
  name: string;
  bonus_ids?: number[];
  enchant_id?: number;
  gem_id?: number;
  is_kept?: boolean;
  encounter?: string;
  origin?: string;
  upgrade_levels?: number;
}

interface TopGearResult {
  name: string;
  items: ResultItem[];
  dps: number;
  talent_build?: string;
  talent_spec?: string;
  delta: number;
}

interface TopGearResultsProps {
  playerName: string;
  playerClass: string;
  playerRealm?: string;
  baseDps: number;
  results: TopGearResult[];
  equippedGear?: Record<string, ResultItem>;
  dpsError?: number;
  dpsErrorPct?: number;
  fightLength?: number;
  desiredTargets?: number;
  iterations?: number;
  targetError?: number;
  elapsedTime?: number;
}

// WoW character sheet order: left column, right column, then weapons
const GEAR_ORDER_LEFT = ['head', 'neck', 'shoulder', 'back', 'chest', 'wrist'];
const GEAR_ORDER_RIGHT = [
  'hands',
  'waist',
  'legs',
  'feet',
  'finger1',
  'finger2',
  'trinket1',
  'trinket2',
];
const GEAR_ORDER_BOTTOM = ['main_hand', 'off_hand'];
const ALL_SLOTS = [...GEAR_ORDER_LEFT, ...GEAR_ORDER_RIGHT, ...GEAR_ORDER_BOTTOM];

export default function TopGearResults({
  playerName,
  playerClass,
  playerRealm,
  baseDps,
  results,
  equippedGear,
  dpsError,
  dpsErrorPct,
  fightLength,
  desiredTargets,
  iterations,
  targetError,
  elapsedTime,
}: TopGearResultsProps) {
  const maxDps = results.length > 0 ? results[0].dps : baseDps;
  const bestResult = results.length > 0 ? results[0] : null;

  // Droptimizer grouping — only available when items have encounter data
  const hasEncounterData = results.some((r) => r.items.some((it) => it.encounter));
  type GroupMode = 'rank' | 'encounter';
  const [groupMode, setGroupMode] = useState<GroupMode>('rank');

  const groupedResults = useMemo(() => {
    if (groupMode === 'rank' || !hasEncounterData) return null;
    const groups: Record<string, TopGearResult[]> = {};
    for (const result of results) {
      const encounter = result.items[0]?.encounter || 'Unknown';
      if (!groups[encounter]) groups[encounter] = [];
      groups[encounter].push(result);
    }
    // Sort groups by their best item's delta (descending)
    return Object.entries(groups).sort(([, a], [, b]) => {
      const bestA = a[0]?.delta ?? 0;
      const bestB = b[0]?.delta ?? 0;
      return bestB - bestA;
    });
  }, [results, groupMode, hasEncounterData]);

  // Build the full gear set for best result: start with equipped, overlay upgrades
  const bestGearSet = useMemo(() => {
    if (!equippedGear) return {} as Record<string, GearItem>;
    const gearSet: Record<string, GearItem> = {};
    for (const slot of ALL_SLOTS) {
      if (equippedGear[slot]) {
        gearSet[slot] = { ...equippedGear[slot] };
      }
    }
    if (bestResult && bestResult.delta > 0) {
      for (const it of bestResult.items) {
        if (!it.is_kept && it.slot === 'off_hand' && it.item_id === 0) {
          delete gearSet.off_hand;
          continue;
        }
        if (!it.is_kept && it.item_id > 0) {
          gearSet[it.slot] = { ...it };
        }
      }
    }
    return gearSet;
  }, [equippedGear, bestResult]);

  const upgradeSlots = useMemo(() => {
    const slots = new Set<string>();
    if (bestResult && bestResult.delta > 0) {
      for (const it of bestResult.items) {
        if (!it.is_kept && it.item_id > 0) slots.add(it.slot);
      }
    }
    return slots;
  }, [bestResult]);

  // Collect all item queries from results (for rankings ItemTag)
  const allItemQueries = useMemo(() => {
    const seen = new Set<string>();
    const queries: ItemQuery[] = [];
    const addItem = (it: { item_id: number; bonus_ids?: number[] }) => {
      if (it.item_id <= 0) return;
      const key = `${it.item_id}:${(it.bonus_ids || []).sort().join(':')}`;
      if (!seen.has(key)) {
        seen.add(key);
        queries.push({ item_id: it.item_id, bonus_ids: it.bonus_ids });
      }
    };
    for (const r of results) {
      for (const it of r.items) addItem(it);
    }
    if (equippedGear) {
      for (const it of Object.values(equippedGear)) addItem(it);
    }
    return queries;
  }, [results, equippedGear]);

  const itemInfoMap = useItemInfo(allItemQueries);

  const allEnchantIds = useMemo(() => {
    const ids = new Set<number>();
    const addEnchant = (id?: number) => {
      if (id && id > 0) ids.add(id);
    };
    for (const r of results) {
      for (const it of r.items) addEnchant(it.enchant_id);
    }
    if (equippedGear) {
      for (const it of Object.values(equippedGear)) addEnchant(it.enchant_id);
    }
    return [...ids];
  }, [results, equippedGear]);

  const enchantInfoMap = useEnchantInfo(allEnchantIds);

  const allGemIds = useMemo(() => {
    const ids = new Set<number>();
    const addGem = (id?: number) => {
      if (id && id > 0) ids.add(id);
    };
    for (const r of results) {
      for (const it of r.items) addGem(it.gem_id);
    }
    if (equippedGear) {
      for (const it of Object.values(equippedGear)) addGem(it.gem_id);
    }
    return [...ids];
  }, [results, equippedGear]);

  const gemInfoMap = useGemInfo(allGemIds);
  useWowheadTooltips([itemInfoMap]);

  const hasGearOverview = equippedGear && Object.keys(equippedGear).length > 0;

  const characterRenderUrl =
    playerRealm && playerName
      ? `https://simhammer.com/api/blizzard/character/${encodeURIComponent(playerRealm.toLowerCase())}/${encodeURIComponent(playerName.toLowerCase())}/media/render`
      : null;

  return (
    <div className="space-y-6">
      <DpsHeroCard
        playerName={playerName}
        playerClass={playerClass}
        playerRealm={playerRealm}
        dps={bestResult && bestResult.delta > 0 ? bestResult.dps : baseDps}
        dpsError={dpsError}
        dpsErrorPct={dpsErrorPct}
        fightLength={fightLength}
        desiredTargets={desiredTargets}
        iterations={iterations}
        targetError={targetError}
        elapsedTime={elapsedTime}
      >
        {bestResult && bestResult.delta > 0 ? (
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-3 py-1.5 text-emerald-400">
            <span className="text-sm font-semibold tabular-nums">
              +{Math.round(bestResult.delta).toLocaleString()}
            </span>
            <span className="text-xs opacity-60">upgrade</span>
          </div>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">Current gear is already optimal.</p>
        )}
      </DpsHeroCard>

      {/* Gear Overview */}
      {hasGearOverview && (
        <GearOverview
          gear={bestGearSet}
          title="Best Gear"
          characterRenderUrl={characterRenderUrl}
          upgradeSlots={upgradeSlots}
        />
      )}

      {/* Rankings */}
      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-widest text-muted">Rankings</p>
          <div className="flex items-center gap-3">
            {hasEncounterData && (
              <div className="flex gap-1">
                {(
                  [
                    ['rank', 'By Rank'],
                    ['encounter', 'By Boss'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setGroupMode(mode)}
                    className={`rounded border px-2.5 py-1 text-[11px] font-medium transition-all ${
                      groupMode === mode
                        ? 'border-white bg-white text-black'
                        : 'border-border bg-surface-2 text-gray-400 hover:border-gray-500 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <span className="font-mono text-[11px] text-muted">{results.length} results</span>
          </div>
        </div>

        {groupMode === 'encounter' && groupedResults ? (
          <div className="space-y-6">
            {groupedResults.map(([encounter, group]) => (
              <div key={encounter}>
                <div className="mb-2 flex items-center gap-2 border-b border-border/50 pb-1.5">
                  <span className="text-[12px] font-semibold text-gray-300">{encounter}</span>
                  <span className="font-mono text-[10px] text-muted">{group.length} items</span>
                </div>
                <div className="space-y-1">
                  {group.map((result) => (
                    <ResultRow
                      key={result.name}
                      result={result}
                      maxDps={maxDps}
                      baseDps={baseDps}
                      isBest={result === results[0] && result.delta > 0}
                      itemInfoMap={itemInfoMap}
                      enchantInfoMap={enchantInfoMap}
                      gemInfoMap={gemInfoMap}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <RankedResults
            results={results}
            maxDps={maxDps}
            baseDps={baseDps}
            itemInfoMap={itemInfoMap}
            enchantInfoMap={enchantInfoMap}
            gemInfoMap={gemInfoMap}
          />
        )}
      </div>
    </div>
  );
}

const INITIAL_VISIBLE = 8;

function RankedResults({
  results,
  maxDps,
  baseDps,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
}: {
  results: TopGearResult[];
  maxDps: number;
  baseDps: number;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? results : results.slice(0, INITIAL_VISIBLE);
  const hasMore = results.length > INITIAL_VISIBLE;

  return (
    <div className="space-y-1">
      {visible.map((result, idx) => (
        <ResultRow
          key={result.name}
          result={result}
          rank={idx + 1}
          maxDps={maxDps}
          baseDps={baseDps}
          isBest={idx === 0 && result.delta > 0}
          itemInfoMap={itemInfoMap}
          enchantInfoMap={enchantInfoMap}
          gemInfoMap={gemInfoMap}
        />
      ))}
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 w-full rounded-lg border border-border bg-surface-2 py-2 text-xs text-zinc-400 transition-all hover:border-zinc-600 hover:text-zinc-200"
        >
          {expanded
            ? 'Show less'
            : `Show all ${results.length} results (+${results.length - INITIAL_VISIBLE} more)`}
        </button>
      )}
    </div>
  );
}

function ResultRow({
  result,
  rank,
  maxDps,
  baseDps,
  isBest,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
}: {
  result: TopGearResult;
  rank?: number;
  maxDps: number;
  baseDps: number;
  isBest: boolean;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
}) {
  const barWidth = maxDps > 0 ? (result.dps / maxDps) * 100 : 0;
  const isEquipped =
    result.items.length === 0 || result.name.startsWith('Currently Equipped');
  const hasTalentBuild = !!result.talent_build;
  const talentBadge = hasTalentBuild ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-purple-500/10 px-1.5 py-px text-[9px] font-medium">
      {result.talent_spec && (
        <span className="text-purple-300">{specDisplayName(result.talent_spec)}</span>
      )}
      <span className="text-purple-400/70">{result.talent_build}</span>
    </span>
  ) : null;

  const changedItems = result.items.filter((it) => !it.is_kept && it.item_id > 0);
  const changedSlots = new Set(changedItems.map((it) => it.slot));

  const showBothRings = changedSlots.has('finger1') || changedSlots.has('finger2');
  const showBothTrinkets = changedSlots.has('trinket1') || changedSlots.has('trinket2');

  const displayItems = result.items.filter((it) => {
    if (!it.is_kept) return it.item_id > 0;
    if (showBothRings && (it.slot === 'finger1' || it.slot === 'finger2')) return true;
    if (showBothTrinkets && (it.slot === 'trinket1' || it.slot === 'trinket2')) return true;
    return false;
  });

  return (
    <div
      className={`relative overflow-hidden rounded-lg ${
        isBest ? 'ring-1 ring-gold/20' : isEquipped ? 'ring-1 ring-white/5' : ''
      }`}
    >
      <div
        className="absolute inset-y-0 left-0 bg-white/[0.02]"
        style={{ width: `${barWidth}%` }}
      />
      <div className="relative flex items-center justify-between gap-3 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {rank != null && (
            <span className="w-5 shrink-0 text-right font-mono text-[10px] tabular-nums text-gray-600">
              {rank}
            </span>
          )}

          {(() => {
            const hasChangedItems = changedItems.length > 0;

            if (isEquipped) {
              return (
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-muted">Currently Equipped</span>
                  {talentBadge}
                </div>
              );
            }

            // Talent-only comparison (no gear changes): show talent build as primary label
            if (!hasChangedItems && hasTalentBuild) {
              return talentBadge;
            }

            return (
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                {displayItems.map((it, i) => (
                  <ItemTag
                    key={i}
                    item={it}
                    info={it.item_id > 0 ? itemInfoMap[it.item_id] : undefined}
                    enchant={it.enchant_id ? enchantInfoMap[it.enchant_id] : undefined}
                    gem={it.gem_id ? gemInfoMap[it.gem_id] : undefined}
                  />
                ))}
                {talentBadge}
              </div>
            );
          })()}

          {isBest && (
            <span className="shrink-0 rounded bg-gold/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gold">
              Best
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span
            className={`flex items-center gap-1.5 font-mono text-[13px] tabular-nums ${
              result.delta > 0
                ? 'text-emerald-400'
                : result.delta < 0
                  ? 'text-red-400'
                  : 'text-muted'
            }`}
          >
            <span>
              {result.delta > 0
                ? `+${Math.round(result.delta).toLocaleString()}`
                : result.delta < 0
                  ? Math.round(result.delta).toLocaleString()
                  : '—'}
            </span>
            {result.delta !== 0 && baseDps > 0 && (
              <span className="text-xs opacity-70">
                ({result.delta > 0 ? '+' : ''}
                {((result.delta / baseDps) * 100).toFixed(1)}%)
              </span>
            )}
          </span>
          <span className="w-16 text-right font-mono text-sm tabular-nums text-gray-300">
            {Math.round(result.dps).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

function ItemTag({
  item,
  info,
  enchant,
  gem,
}: {
  item: ResultItem;
  info?: ItemInfo;
  enchant?: EnchantInfo;
  gem?: GemInfo;
}) {
  const qc = info ? QUALITY_COLORS[info.quality] || '#fff' : '#fff';
  const name = info?.name || item.name || `Item ${item.item_id}`;
  const icon = info?.icon || 'inv_misc_questionmark';
  const kept = item.is_kept;
  const whData =
    item.item_id > 0
      ? getWowheadData(item.bonus_ids, item.ilevel, item.enchant_id, item.gem_id)
      : undefined;

  return (
    <div
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
        kept ? 'opacity-40' : 'bg-white/[0.04]'
      }`}
    >
      <div className="h-4 w-4 shrink-0 overflow-hidden rounded-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getIconUrl(icon)}
          alt=""
          width={16}
          height={16}
          className="h-full w-full"
          loading="lazy"
        />
      </div>
      <a
        href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
        data-wowhead={whData}
        className="max-w-[120px] truncate text-[11px] font-medium no-underline"
        style={{ color: qc }}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.preventDefault()}
      >
        {name}
      </a>
      {item.upgrade_levels ? (
        <span className="shrink-0 text-[8px] font-bold uppercase tracking-wider text-emerald-400">
          +{item.upgrade_levels}
        </span>
      ) : item.origin === 'vault' ? (
        <span className="shrink-0 text-[8px] font-bold uppercase tracking-wider text-amber-400">
          V
        </span>
      ) : null}
      {enchant?.name && (
        <span className="max-w-[70px] truncate text-[9px] text-emerald-400/70" title={enchant.name}>
          {enchant.name}
        </span>
      )}
    </div>
  );
}
