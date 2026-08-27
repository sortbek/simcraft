'use client';
import { useMemo, useState } from 'react';
import type { RosterReport, ReportPlayer } from '../../lib/rosters';
import { useItemInfo } from '../../lib/useItemInfo';
import {
  EMPTY_FILTERS,
  type ReportFilters,
  type ReportViewMode,
  filterItems,
  playerMap,
  resultLookup,
  sortItemsByBest,
} from './reportTypes';
import ItemCentricView from './ItemCentricView';
import MatrixView from './MatrixView';
import { SLOT_LABELS } from '../../lib/types';

export default function RosterReportView({ report }: { report: RosterReport }) {
  const [mode, setMode] = useState<ReportViewMode>('item');
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS);

  // batch-fetch item icons/quality for every item in the report (stable dep)
  const itemQueries = useMemo(
    () => report.items.map((i) => ({ item_id: i.item_id })),
    [report.items]
  );
  const itemInfo = useItemInfo(itemQueries);

  const pmap = useMemo(() => playerMap(report.players), [report.players]);

  // derived filtered + sorted items
  const filtered = useMemo(
    () => sortItemsByBest(filterItems(report.items, filters)),
    [report.items, filters]
  );
  const lookup = useMemo(() => resultLookup(filtered), [filtered]);

  // matrix column order: report players that (a) are status "ok" and (b) pass the player filter (empty = all)
  const columns: ReportPlayer[] = useMemo(() => {
    const sel = new Set(filters.players);
    return report.players.filter(
      (p) => p.status === 'ok' && (sel.size === 0 || sel.has(p.member_id))
    );
  }, [report.players, filters]);

  // option lists for the filter controls
  const playerOptions = useMemo(
    () => report.players.filter((p) => p.status === 'ok'),
    [report.players]
  );
  const slotOptions = useMemo(
    () => Array.from(new Set(report.items.map((i) => i.slot))).sort(),
    [report.items]
  );
  // Grouped by reason: a whole roster usually fails the same way.
  const failures = useMemo(() => {
    const byReason = new Map<string, string[]>();
    for (const p of report.players) {
      if (p.status === 'ok') continue;
      const reason = p.error?.trim() || 'No reason recorded for this sim.';
      const names = byReason.get(reason);
      if (names) names.push(p.name);
      else byReason.set(reason, [p.name]);
    }
    return Array.from(byReason, ([reason, names]) => ({ reason, names }));
  }, [report.players]);

  const failedCount = failures.reduce((n, f) => n + f.names.length, 0);

  function togglePlayer(memberId: string) {
    setFilters((f) => {
      const has = f.players.includes(memberId);
      return {
        ...f,
        players: has ? f.players.filter((p) => p !== memberId) : [...f.players, memberId],
      };
    });
  }

  function toggleSlot(slot: string) {
    setFilters((f) => {
      const has = f.slots.includes(slot);
      return { ...f, slots: has ? f.slots.filter((s) => s !== slot) : [...f.slots, slot] };
    });
  }

  const chipBase = 'rounded-full border px-2.5 py-0.5 text-xs transition-colors';
  const chipOn = 'border-primary/40 bg-primary/15 text-on-surface';
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
                {SLOT_LABELS[s] ?? s}
              </button>
            );
          })}
        </div>
      )}

      {/* Summary line */}
      <div className="text-xs text-on-surface-variant/60">
        {filtered.length} items · {columns.length} players
      </div>

      {failedCount > 0 && (
        <details
          open={columns.length === 0}
          className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2"
        >
          <summary className="cursor-pointer text-sm font-medium text-red-400">
            {failedCount} {failedCount === 1 ? 'player' : 'players'} failed to sim
          </summary>
          <ul className="mt-2 space-y-2">
            {failures.map((f) => (
              <li key={f.reason}>
                <div className="text-sm text-on-surface">{f.names.join(', ')}</div>
                <div className="break-words text-sm text-on-surface-variant/80">{f.reason}</div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* View */}
      {mode === 'item' ? (
        <ItemCentricView items={filtered} players={pmap} itemInfo={itemInfo} />
      ) : (
        <MatrixView items={filtered} players={columns} lookup={lookup} itemInfo={itemInfo} />
      )}
    </div>
  );
}
