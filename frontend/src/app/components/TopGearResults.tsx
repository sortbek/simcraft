"use client";

import { useMemo, useState } from "react";
import { useItemInfo, useEnchantInfo, useGemInfo, getIconUrl, getWowheadUrl, getWowheadData, QUALITY_COLORS } from "../lib/useItemInfo";
import type { ItemInfo, EnchantInfo, GemInfo, ItemQuery } from "../lib/useItemInfo";
import { SLOT_LABELS } from "../lib/types";
import { useWowheadTooltips } from "../lib/useWowheadTooltips";

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
}

interface TopGearResult {
  name: string;
  items: ResultItem[];
  dps: number;
  delta: number;
}

interface TopGearResultsProps {
  playerName: string;
  playerClass: string;
  baseDps: number;
  results: TopGearResult[];
  equippedGear?: Record<string, ResultItem>;
}

// WoW character sheet order: left column, right column, then weapons
const GEAR_ORDER_LEFT = ["head", "neck", "shoulder", "back", "chest", "wrist"];
const GEAR_ORDER_RIGHT = ["hands", "waist", "legs", "feet", "finger1", "finger2", "trinket1", "trinket2"];
const GEAR_ORDER_BOTTOM = ["main_hand", "off_hand"];
const ALL_SLOTS = [...GEAR_ORDER_LEFT, ...GEAR_ORDER_RIGHT, ...GEAR_ORDER_BOTTOM];

export default function TopGearResults({
  playerName,
  playerClass,
  baseDps,
  results,
  equippedGear,
}: TopGearResultsProps) {
  const maxDps = results.length > 0 ? results[0].dps : baseDps;
  const bestResult = results.length > 0 ? results[0] : null;

  // Droptimizer grouping — only available when items have encounter data
  const hasEncounterData = results.some((r) => r.items.some((it) => it.encounter));
  type GroupMode = "rank" | "encounter";
  const [groupMode, setGroupMode] = useState<GroupMode>("rank");

  const groupedResults = useMemo(() => {
    if (groupMode === "rank" || !hasEncounterData) return null;
    const groups: Record<string, TopGearResult[]> = {};
    for (const result of results) {
      const encounter = result.items[0]?.encounter || "Unknown";
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
    if (!equippedGear) return {};
    const gearSet: Record<string, ResultItem & { isUpgrade: boolean }> = {};
    // Start with all equipped gear
    for (const slot of ALL_SLOTS) {
      if (equippedGear[slot]) {
        gearSet[slot] = { ...equippedGear[slot], isUpgrade: false };
      }
    }
    // Overlay best result's changed items
    if (bestResult && bestResult.delta > 0) {
      for (const it of bestResult.items) {
        if (!it.is_kept && it.item_id > 0) {
          gearSet[it.slot] = { ...it, isUpgrade: true };
        }
      }
    }
    return gearSet;
  }, [equippedGear, bestResult]);

  // Collect all item queries from results + equipped gear
  const allItemQueries = useMemo(() => {
    const seen = new Set<string>();
    const queries: ItemQuery[] = [];
    const addItem = (it: { item_id: number; bonus_ids?: number[] }) => {
      if (it.item_id <= 0) return;
      const key = `${it.item_id}:${(it.bonus_ids || []).sort().join(":")}`;
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
    const addEnchant = (id?: number) => { if (id && id > 0) ids.add(id); };
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
    const addGem = (id?: number) => { if (id && id > 0) ids.add(id); };
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

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="card p-8 text-center">
        <p className="text-xs text-muted mb-4">
          {playerName} &middot; {playerClass}
        </p>
        {bestResult && bestResult.delta > 0 ? (
          <>
            <p className="text-5xl font-bold text-white tabular-nums tracking-tight">
              {Math.round(bestResult.dps).toLocaleString()}
            </p>
            <p className="text-xs text-muted mt-2 uppercase tracking-widest">
              DPS
            </p>
            <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/10 text-emerald-400">
              <span className="text-sm font-semibold tabular-nums">
                +{Math.round(bestResult.delta).toLocaleString()}
              </span>
              <span className="text-xs opacity-60">upgrade</span>
            </div>
          </>
        ) : (
          <>
            <p className="text-5xl font-bold text-white tabular-nums tracking-tight">
              {Math.round(baseDps).toLocaleString()}
            </p>
            <p className="text-xs text-muted mt-2 uppercase tracking-widest">
              DPS
            </p>
            <p className="text-sm text-muted mt-4">
              Current gear is already optimal.
            </p>
          </>
        )}
      </div>

      {/* Gear Overview */}
      {hasGearOverview && (
        <div className="card p-5">
          <p className="text-xs font-medium text-muted uppercase tracking-widest mb-4">
            Best Gear
          </p>
          <div className="grid grid-cols-2 gap-x-4">
            {/* Left column */}
            <div className="space-y-1">
              {GEAR_ORDER_LEFT.map((slot) => (
                <GearSlotRow
                  key={slot}
                  slot={slot}
                  item={bestGearSet[slot]}
                  isUpgrade={(bestGearSet[slot] as { isUpgrade?: boolean })?.isUpgrade}
                  itemInfoMap={itemInfoMap}
                  enchantInfoMap={enchantInfoMap}
                  gemInfoMap={gemInfoMap}
                />
              ))}
            </div>
            {/* Right column */}
            <div className="space-y-1">
              {GEAR_ORDER_RIGHT.map((slot) => (
                <GearSlotRow
                  key={slot}
                  slot={slot}
                  item={bestGearSet[slot]}
                  isUpgrade={(bestGearSet[slot] as { isUpgrade?: boolean })?.isUpgrade}
                  itemInfoMap={itemInfoMap}
                  enchantInfoMap={enchantInfoMap}
                  gemInfoMap={gemInfoMap}
                />
              ))}
            </div>
          </div>
          {/* Weapons row */}
          <div className="grid grid-cols-2 gap-x-4 mt-1">
            {GEAR_ORDER_BOTTOM.map((slot) => (
              <GearSlotRow
                key={slot}
                slot={slot}
                item={bestGearSet[slot]}
                isUpgrade={(bestGearSet[slot] as { isUpgrade?: boolean })?.isUpgrade}
                itemInfoMap={itemInfoMap}
                enchantInfoMap={enchantInfoMap}
                gemInfoMap={gemInfoMap}
              />
            ))}
          </div>
        </div>
      )}

      {/* Rankings */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-medium text-muted uppercase tracking-widest">
            Rankings
          </p>
          <div className="flex items-center gap-3">
            {hasEncounterData && (
              <div className="flex gap-1">
                {([["rank", "By Rank"], ["encounter", "By Boss"]] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setGroupMode(mode)}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition-all border ${
                      groupMode === mode
                        ? "bg-white text-black border-white"
                        : "bg-surface-2 text-gray-400 border-border hover:border-gray-500 hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <span className="text-[11px] text-muted font-mono">
              {results.length} results
            </span>
          </div>
        </div>

        {groupMode === "encounter" && groupedResults ? (
          <div className="space-y-6">
            {groupedResults.map(([encounter, group]) => (
              <div key={encounter}>
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-border/50">
                  <span className="text-[12px] font-semibold text-gray-300">{encounter}</span>
                  <span className="text-[10px] text-muted font-mono">{group.length} items</span>
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
        <div className="space-y-1">
          {results.map((result, idx) => (
            <ResultRow
              key={idx}
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
        </div>
        )}
      </div>
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
  const isEquipped = result.items.length === 0 || result.name === "Currently Equipped";

  return (
    <div
      className={`relative rounded-lg overflow-hidden ${
        isBest
          ? "ring-1 ring-gold/20"
          : isEquipped
          ? "ring-1 ring-white/5"
          : ""
      }`}
    >
      <div
        className="absolute inset-y-0 left-0 bg-white/[0.02]"
        style={{ width: `${barWidth}%` }}
      />
      <div className="relative flex items-center justify-between px-3 py-2 gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {rank != null && (
            <span className="text-[10px] font-mono text-gray-600 w-5 text-right shrink-0 tabular-nums">
              {rank}
            </span>
          )}

          {isEquipped ? (
            <span className="text-[12px] text-muted">
              Currently Equipped
            </span>
          ) : (
            <div className="flex items-center gap-1 min-w-0 flex-wrap">
              {result.items.filter(it => !it.is_kept).map((it, i) => (
                <ItemTag
                  key={i}
                  item={it}
                  info={
                    it.item_id > 0
                      ? itemInfoMap[it.item_id]
                      : undefined
                  }
                  enchant={it.enchant_id ? enchantInfoMap[it.enchant_id] : undefined}
                  gem={it.gem_id ? gemInfoMap[it.gem_id] : undefined}
                />
              ))}
            </div>
          )}

          {isBest && (
            <span className="shrink-0 text-[9px] uppercase tracking-wider font-bold text-gold bg-gold/10 px-1.5 py-0.5 rounded">
              Best
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span
            className={`text-[13px] font-mono tabular-nums flex items-center gap-1.5 ${
              result.delta > 0
                ? "text-emerald-400"
                : result.delta < 0
                ? "text-red-400"
                : "text-muted"
            }`}
          >
            <span>
              {result.delta > 0
                ? `+${Math.round(result.delta).toLocaleString()}`
                : result.delta < 0
                ? Math.round(result.delta).toLocaleString()
                : "—"}
            </span>
            {result.delta !== 0 && baseDps > 0 && (
              <span className="text-xs opacity-70">
                ({result.delta > 0 ? "+" : ""}{((result.delta / baseDps) * 100).toFixed(1)}%)
              </span>
            )}
          </span>
          <span className="text-sm font-mono text-gray-300 tabular-nums w-16 text-right">
            {Math.round(result.dps).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

function GearSlotRow({
  slot,
  item,
  isUpgrade,
  itemInfoMap,
  enchantInfoMap,
  gemInfoMap,
}: {
  slot: string;
  item?: ResultItem;
  isUpgrade?: boolean;
  itemInfoMap: Record<number, ItemInfo>;
  enchantInfoMap: Record<number, EnchantInfo>;
  gemInfoMap: Record<number, GemInfo>;
}) {
  if (!item || item.item_id <= 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
        <div className="w-7 h-7 shrink-0 rounded bg-white/[0.03] border border-border" />
        <div>
          <p className="text-[11px] text-gray-600">{SLOT_LABELS[slot] || slot}</p>
          <p className="text-[9px] text-gray-700">Empty</p>
        </div>
      </div>
    );
  }

  const info = itemInfoMap[item.item_id];
  const enchant = item.enchant_id ? enchantInfoMap[item.enchant_id] : undefined;
  const gem = item.gem_id ? gemInfoMap[item.gem_id] : undefined;
  const qc = info ? QUALITY_COLORS[info.quality] || "#fff" : "#fff";
  const name = info?.name || item.name || `Item ${item.item_id}`;
  const icon = info?.icon || "inv_misc_questionmark";
  const whData = item.item_id > 0 ? getWowheadData(item.bonus_ids, item.ilevel, item.enchant_id, item.gem_id) : undefined;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
        isUpgrade ? "bg-emerald-500/[0.07] ring-1 ring-emerald-500/20" : ""
      }`}
    >
      <div className="w-7 h-7 shrink-0 rounded overflow-hidden border border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getIconUrl(icon)}
          alt=""
          width={28}
          height={28}
          className="w-full h-full"
          loading="lazy"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <a
            href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
            data-wowhead={whData}
            className="text-[11px] font-medium leading-tight no-underline truncate"
            style={{ color: qc }}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.preventDefault()}
          >
            {name}
          </a>
          {isUpgrade && (
            <span className="shrink-0 text-[8px] uppercase tracking-wider font-bold text-emerald-400 bg-emerald-500/10 px-1 py-px rounded">
              New
            </span>
          )}
          {item.origin === "vault" && (
            <span className="shrink-0 text-[8px] uppercase tracking-wider font-bold text-amber-400 bg-amber-400/10 px-1 py-px rounded">
              Vault
            </span>
          )}
        </div>
        <p className="text-[9px] text-muted truncate">
          {SLOT_LABELS[slot] || slot}
          {item.ilevel > 0 && ` · ${item.ilevel}`}
          {info?.tag && ` · ${info.tag}`}
          {gem?.name ? <span className="text-sky-400/70"> · {gem.name}</span> : (info?.sockets ?? 0) > 0 && <span className="text-sky-400/70"> · Socket</span>}
          {enchant?.name && <span className="text-emerald-400/70"> · {enchant.name}</span>}
        </p>
      </div>
    </div>
  );
}

function ItemTag({ item, info, enchant, gem }: { item: ResultItem; info?: ItemInfo; enchant?: EnchantInfo; gem?: GemInfo }) {
  const qc = info ? QUALITY_COLORS[info.quality] || "#fff" : "#fff";
  const name = info?.name || item.name || `Item ${item.item_id}`;
  const icon = info?.icon || "inv_misc_questionmark";
  const kept = item.is_kept;
  const whData = item.item_id > 0 ? getWowheadData(item.bonus_ids, item.ilevel, item.enchant_id, item.gem_id) : undefined;

  return (
    <div
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
        kept ? "opacity-40" : "bg-white/[0.04]"
      }`}
    >
      <div className="w-4 h-4 shrink-0 rounded-sm overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getIconUrl(icon)}
          alt=""
          width={16}
          height={16}
          className="w-full h-full"
          loading="lazy"
        />
      </div>
      <a
        href={item.item_id > 0 ? getWowheadUrl(item.item_id) : undefined}
        data-wowhead={whData}
        className="text-[11px] font-medium truncate max-w-[120px] no-underline"
        style={{ color: qc }}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.preventDefault()}
      >
        {name}
      </a>
      {item.origin === "vault" && (
        <span className="text-[8px] font-bold text-amber-400 uppercase tracking-wider shrink-0">V</span>
      )}
      {enchant?.name && (
        <span className="text-[9px] text-emerald-400/70 truncate max-w-[70px]" title={enchant.name}>
          {enchant.name}
        </span>
      )}
    </div>
  );
}
