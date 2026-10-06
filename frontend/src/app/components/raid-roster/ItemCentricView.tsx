'use client';
import { useMemo, useState } from 'react';
import type { ReportItem, ReportItemResult, ReportPlayer } from '../../lib/rosters';
import type { ItemInfo } from '../../lib/useItemInfo';
import { getWowheadUrl, getWowheadData, iconProps } from '../../lib/useItemInfo';
import { QUALITY_HEX } from '../../lib/qualityColors';
import { SLOT_LABELS } from '../../lib/types';
import VariantBadges from '../loot/VariantBadges';

interface Props {
  items: ReportItem[];
  players: Map<string, ReportPlayer>;
  itemInfo: Record<number, ItemInfo>;
}

function ResultRow({ result, playerName }: { result: ReportItemResult; playerName: string }) {
  const pct = result.upgrade_pct;
  const isUpgrade = pct > 0;
  const isDowngrade = pct < 0;
  const barWidth = Math.min(Math.abs(pct) / 5, 1) * 100;

  const barColor = isUpgrade
    ? 'bg-positive'
    : isDowngrade
      ? 'bg-negative/60'
      : 'bg-surface-container-highest';

  const textColor = isUpgrade ? 'text-positive' : isDowngrade ? 'text-negative/80' : 'text-outline';

  const sign = pct > 0 ? '+' : '';

  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-32 shrink-0 truncate text-sm text-on-surface">{playerName}</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-container-highest">
        <div
          className={`absolute left-0 top-0 h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <span
        className={`w-14 shrink-0 text-right font-headline text-sm font-extrabold tabular-nums ${textColor}`}
      >
        {sign}
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

export default function ItemCentricView({ items, players, itemInfo }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Group items by boss, preserving first-seen order. Memoized so toggling a
  // collapsed section doesn't re-bucket every item on each render.
  const { bossOrder, byBoss } = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, ReportItem[]>();
    for (const item of items) {
      if (!map.has(item.boss)) {
        order.push(item.boss);
        map.set(item.boss, []);
      }
      map.get(item.boss)!.push(item);
    }
    return { bossOrder: order, byBoss: map };
  }, [items]);

  function toggleBoss(boss: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(boss)) next.delete(boss);
      else next.add(boss);
      return next;
    });
  }

  if (items.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-outline">
        No results match the current filters.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {bossOrder.map((boss) => {
        const bossItems = byBoss.get(boss)!;
        const isCollapsed = collapsed.has(boss);

        return (
          <div key={boss} className="card overflow-hidden">
            {/* Boss header */}
            <button
              type="button"
              onClick={() => toggleBoss(boss)}
              className="flex h-[58px] w-full items-center justify-between gap-3 border-b border-line/[0.06] px-6 transition-colors hover:bg-overlay/[0.015]"
            >
              <span className="h-card">{boss}</span>
              <span className="text-base text-outline">{isCollapsed ? '▸' : '▾'}</span>
            </button>

            {!isCollapsed && (
              <div className="divide-y divide-line/[0.06]">
                {bossItems.map((item) => {
                  const info = itemInfo[item.item_id];
                  const quality = info?.quality ?? 3;
                  const iconName = info?.icon ?? 'inv_misc_questionmark';
                  const displayName = item.name || info?.name || String(item.item_id);

                  return (
                    <div key={item.uid} className="px-6 py-4">
                      {/* Item header row */}
                      <div className="mb-2 flex items-start gap-3">
                        {/* Icon */}
                        <div
                          className="shrink-0 overflow-hidden rounded border-b-2 bg-surface-container-highest"
                          style={{ borderBottomColor: QUALITY_HEX[quality] ?? QUALITY_HEX[0] }}
                        >
                          <img
                            {...iconProps(iconName)}
                            alt={displayName}
                            className="h-7 w-7 object-cover"
                          />
                        </div>

                        {/* Name + meta */}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <a
                              href={getWowheadUrl(item.item_id)}
                              data-wowhead={getWowheadData({ ilevel: item.ilevel, is_catalyst: item.is_catalyst, source_item_id: item.source_item_id })}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm font-bold hover:underline"
                              style={{ color: QUALITY_HEX[quality] ?? QUALITY_HEX[1] }}
                            >
                              {displayName}
                            </a>
                            <VariantBadges item={item} />
                          </div>
                          <p className="mt-0.5 text-xs text-outline">
                            ilvl {item.ilevel} · {SLOT_LABELS[item.slot] ?? item.slot}
                          </p>
                        </div>
                      </div>

                      {/* Results */}
                      <div className="mt-1 flex flex-col">
                        {item.results.map((r) => (
                          <ResultRow
                            key={r.member_id}
                            result={r}
                            playerName={players.get(r.member_id)?.name ?? r.member_id}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
