'use client';
import type { ReportItem, ReportItemResult, ReportPlayer } from '../../lib/rosters';
import type { ItemInfo } from '../../lib/useItemInfo';
import { getIconUrl, getWowheadUrl, getWowheadData } from '../../lib/useItemInfo';
import { QUALITY_HEX } from '../../lib/qualityColors';
import { heatClasses } from './reportTypes';
import VariantBadges from '../loot/VariantBadges';

interface Props {
  items: ReportItem[]; // filtered + sorted by container
  players: ReportPlayer[]; // column order (filtered)
  lookup: Map<string, Map<string, ReportItemResult>>; // uid -> member_id -> result
  itemInfo: Record<number, ItemInfo>;
}

export default function MatrixView({ items, players, lookup, itemInfo }: Props) {
  if (items.length === 0 || players.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-on-surface-variant/50">
        No results match the current filters.
      </div>
    );
  }

  let prevBoss: string | null = null;

  const rows: React.ReactNode[] = [];

  for (const item of items) {
    const info = itemInfo[item.item_id];
    const quality = info?.quality ?? 3;
    const iconName = info?.icon ?? 'inv_misc_questionmark';
    const displayName = item.name || info?.name || String(item.item_id);
    const qualityColor = QUALITY_HEX[quality] ?? '#ffffff';
    const itemResults = lookup.get(item.uid);

    if (item.boss !== prevBoss) {
      prevBoss = item.boss;
      rows.push(
        <tr key={`boss-${item.boss}-${item.uid}`}>
          <td
            colSpan={players.length + 1}
            className="bg-surface-container px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/60"
          >
            {item.boss}
          </td>
        </tr>
      );
    }

    rows.push(
      <tr key={item.uid} className="group">
        {/* Sticky item cell */}
        <td className="sticky left-0 z-10 bg-surface-container-low">
          <div className="flex w-56 items-center gap-2 px-2 py-1">
            <a
              href={getWowheadUrl(item.item_id)}
              data-wowhead={getWowheadData(undefined, item.ilevel)}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 items-center gap-2 hover:underline"
            >
              <img
                src={getIconUrl(iconName)}
                alt={displayName}
                className="h-6 w-6 shrink-0 rounded object-cover"
              />
              <span className="truncate text-xs font-semibold" style={{ color: qualityColor }}>
                {displayName}
              </span>
            </a>
            <VariantBadges item={item} />
          </div>
        </td>

        {/* Player cells */}
        {players.map((player) => {
          const result = itemResults?.get(player.member_id);
          const pct = result?.upgrade_pct;
          const label = pct !== undefined ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}` : '';

          return (
            <td
              key={player.member_id}
              className={`border border-outline-variant/10 px-2 py-1 text-center text-xs tabular-nums ${heatClasses(pct)}`}
            >
              {label}
            </td>
          );
        })}
      </tr>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            {/* Sticky top-left corner */}
            <th className="sticky left-0 z-30 bg-surface-container-high px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
              Item
            </th>
            {players.map((player) => (
              <th
                key={player.member_id}
                className="min-w-[3.5rem] border border-outline-variant/10 px-2 py-2 text-center text-[10px] text-on-surface-variant/70"
              >
                <span className="block truncate">{player.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}
