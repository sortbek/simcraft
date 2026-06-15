'use client';
import { useMemo, useState } from 'react';
import type { RosterReport, ReportPlayer } from '../../lib/rosters';
import { useItemInfo } from '../../lib/useItemInfo';
import {
  EMPTY_FILTERS, type ReportFilters, type ReportViewMode,
  filterItems, playerMap, resultLookup, sortItemsByBest,
} from './reportTypes';
import ItemCentricView from './ItemCentricView';
import MatrixView from './MatrixView';

function slotLabel(slot: string): string {
  return slot
    .replace(/\d+$/, '')
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function RosterReportView({ report }: { report: RosterReport }) {
  const [mode, setMode] = useState<ReportViewMode>('item');
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS);

  // batch-fetch item icons/quality for every item in the report (stable dep)
  const itemQueries = useMemo(() => report.items.map((i) => ({ item_id: i.item_id })), [report]);
  const itemInfo = useItemInfo(itemQueries);

  const pmap = useMemo(() => playerMap(report.players), [report]);

  // derived filtered + sorted items
  const filtered = useMemo(() => sortItemsByBest(filterItems(report.items, filters)), [report, filters]);
  const lookup = useMemo(() => resultLookup(filtered), [filtered]);

  // matrix column order: report players that (a) are status "ok" and (b) pass the player filter (empty = all)
  const columns: ReportPlayer[] = useMemo(() => {
    const sel = new Set(filters.players);
    return report.players.filter((p) => p.status === 'ok' && (sel.size === 0 || sel.has(p.member_id)));
  }, [report, filters]);

  // option lists for the filter controls
  const playerOptions = useMemo(() => report.players.filter((p) => p.status === 'ok'), [report]);
  const slotOptions = useMemo(
    () => Array.from(new Set(report.items.map((i) => i.slot))).sort(),
    [report]
  );
  const failedCount = report.players.filter((p) => p.status !== 'ok').length;

  function togglePlayer(memberId: string) {
    setFilters((f) => {
      const has = f.players.includes(memberId);
      return { ...f, players: has ? f.players.filter((p) => p !== memberId) : [...f.players, memberId] };
    });
  }

  function toggleSlot(slot: string) {
    setFilters((f) => {
      const has = f.slots.includes(slot);
      return { ...f, slots: has ? f.slots.filter((s) => s !== slot) : [...f.slots, slot] };
    });
  }

  const chipBase =
    'rounded-full border px-2.5 py-0.5 text-xs transition-colors';
  const chipOn =
    'border-primary/40 bg-primary/15 text-on-surface';
  const chipOff =
    'border-outline-variant/10 bg-surface-container-high text-on-surface-variant/70 hover:text-on-surface';

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* View toggle */}
        <div className="inline-flex overflow-hidden rounded-lg border border-outline-variant/10">
          {(['item', 'matrix'] as ReportViewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                mode === m
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant/70 hover:text-on-surface'
              }`}
            >
              {m === 'item' ? 'Item-centric' : 'Matrix'}
            </button>
          ))}
        </div>

        {/* Hide downgrades */}
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-on-surface-variant">
          <input
            type="checkbox"
            checked={filters.hideDowngrades}
            onChange={(e) => setFilters((f) => ({ ...f, hideDowngrades: e.target.checked }))}
            className="h-3.5 w-3.5 rounded border-outline-variant/30 accent-primary"
          />
          Hide downgrades
        </label>
      </div>

      {/* Player filter */}
      {playerOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant/60">
            Players
          </span>
          {playerOptions.map((p) => {
            const on = filters.players.includes(p.member_id);
            return (
              <button
                key={p.member_id}
                type="button"
                onClick={() => togglePlayer(p.member_id)}
                className={`${chipBase} ${on ? chipOn : chipOff}`}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Slot filter */}
      {slotOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant/60">
            Slots
          </span>
          {slotOptions.map((s) => {
            const on = filters.slots.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleSlot(s)}
                className={`${chipBase} ${on ? chipOn : chipOff}`}
              >
                {slotLabel(s)}
              </button>
            );
          })}
        </div>
      )}

      {/* Summary line */}
      <div className="text-xs text-on-surface-variant/60">
        {filtered.length} items · {columns.length} players
        {failedCount > 0 && (
          <span className="text-on-surface-variant/40"> · {failedCount} failed to sim</span>
        )}
      </div>

      {/* View */}
      {mode === 'item' ? (
        <ItemCentricView items={filtered} players={pmap} itemInfo={itemInfo} />
      ) : (
        <MatrixView items={filtered} players={columns} lookup={lookup} itemInfo={itemInfo} />
      )}
    </div>
  );
}
