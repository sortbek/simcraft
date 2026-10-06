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
import ToggleButtonGroup from '../ui/ToggleButtonGroup';

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

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* View toggle */}
        <ToggleButtonGroup<ReportViewMode>
          value={mode}
          onChange={setMode}
          options={[
            { key: 'item', label: 'Item-centric' },
            { key: 'matrix', label: 'Matrix' },
          ]}
        />

        {/* Hide downgrades */}
        <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-on-surface-variant">
          <input
            type="checkbox"
            checked={filters.hideDowngrades}
            onChange={(e) => setFilters((f) => ({ ...f, hideDowngrades: e.target.checked }))}
            className="h-3.5 w-3.5 accent-gold-fill"
          />
          Hide downgrades
        </label>
      </div>

      {/* Player filter */}
      {playerOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="lbl mr-1">Players</span>
          {playerOptions.map((p) => {
            const on = filters.players.includes(p.member_id);
            return (
              <button
                key={p.member_id}
                type="button"
                onClick={() => togglePlayer(p.member_id)}
                className={`chip ${on ? 'chip-on' : ''}`}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Slot filter */}
      {slotOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="lbl mr-1">Slots</span>
          {slotOptions.map((s) => {
            const on = filters.slots.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleSlot(s)}
                className={`chip ${on ? 'chip-on' : ''}`}
              >
                {SLOT_LABELS[s] ?? s}
              </button>
            );
          })}
        </div>
      )}

      {/* Summary line */}
      <div className="text-[12.5px] text-outline">
        {filtered.length} items · {columns.length} players
      </div>

      {failedCount > 0 && (
        <details
          open={columns.length === 0}
          className="rounded-[6px] border border-negative/25 bg-negative/[0.08] px-3 py-2"
        >
          <summary className="cursor-pointer text-sm font-semibold text-negative">
            {failedCount} {failedCount === 1 ? 'player' : 'players'} failed to sim
          </summary>
          <ul className="mt-2 space-y-2">
            {failures.map((f) => (
              <li key={f.reason}>
                <div className="text-sm text-on-surface">{f.names.join(', ')}</div>
                <div className="break-words text-sm text-on-surface-variant">{f.reason}</div>
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
