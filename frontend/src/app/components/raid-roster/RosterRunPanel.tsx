'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, fetchJson } from '../../lib/api';
import {
  startRun,
  getRun,
  type Roster,
  type RosterReport,
  type ReportItem,
} from '../../lib/rosters';

interface Instance {
  id: number;
  name: string;
}

const DIFFICULTIES = ['heroic', 'mythic', 'normal', 'lfr'] as const;

export default function RosterRunPanel({ roster }: { roster: Roster }) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [instanceId, setInstanceId] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<string>('heroic');

  const [running, setRunning] = useState(false);
  const [progressPct, setProgressPct] = useState<number>(0);
  const [done, setDone] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const [report, setReport] = useState<RosterReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Fetch instances on mount
  useEffect(() => {
    fetchJson<Instance[]>(`${API_URL}/api/instances`)
      .then((list) => {
        setInstances(list);
        if (list.length > 0) setInstanceId(list[0].id);
      })
      .catch(() => {});
  }, []);

  // Stop polling when roster changes
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [roster.id, stopPolling]);

  const handleGenerate = useCallback(async () => {
    if (instanceId === null) return;
    setError(null);
    setReport(null);
    setRunning(true);
    setProgressPct(0);
    setDone(0);
    setTotal(0);

    const started = await startRun(roster.id, instanceId, difficulty);
    if (!started) {
      setError('Failed to start run. Make sure all members have armory status "ok".');
      setRunning(false);
      return;
    }

    const runId = started.run_id;

    intervalRef.current = setInterval(async () => {
      const status = await getRun(runId);
      if (!status) {
        stopPolling();
        setRunning(false);
        setError('Lost connection to run. Please try again.');
        return;
      }
      if (status.progress_pct !== undefined) setProgressPct(status.progress_pct);
      if (status.done !== undefined) setDone(status.done);
      if (status.total !== undefined) setTotal(status.total);

      if (status.status === 'done') {
        stopPolling();
        setRunning(false);
        setReport(status.report ?? null);
      }
    }, 2000);
  }, [roster.id, instanceId, difficulty, stopPolling]);

  // Group items by boss
  const itemsByBoss = new Map<string, ReportItem[]>();
  if (report) {
    for (const item of report.items) {
      const list = itemsByBoss.get(item.boss) ?? [];
      list.push(item);
      itemsByBoss.set(item.boss, list);
    }
  }

  const memberMap = report
    ? new Map(report.players.map((p) => [p.member_id, p.name]))
    : new Map<string, string>();

  return (
    <div className="space-y-6 border-t border-outline-variant/10 pt-6">
      <div className="font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
        Loot Report
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="block font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
            Instance
          </label>
          <select
            value={instanceId ?? ''}
            onChange={(e) => setInstanceId(Number(e.target.value))}
            disabled={running || instances.length === 0}
            className="rounded-lg border border-outline-variant/10 bg-surface-container-high px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {instances.length === 0 && (
              <option value="">Loading…</option>
            )}
            {instances.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
            Difficulty
          </label>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            disabled={running}
            className="rounded-lg border border-outline-variant/10 bg-surface-container-high px-3 py-2 text-sm capitalize text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleGenerate}
          disabled={running || instanceId === null}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-headline text-xs font-bold uppercase tracking-wider text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running && (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
          {running ? 'Running…' : 'Generate'}
        </button>
      </div>

      {running && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-on-surface-variant">
            <span>Simulating…</span>
            <span>
              {done}/{total} jobs
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="text-right text-[11px] text-on-surface-variant/60">
            {progressPct.toFixed(0)}%
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}

      {report && (
        <div className="space-y-6">
          {report.items.length === 0 ? (
            <p className="py-4 text-sm text-on-surface-variant/60">No upgrades found.</p>
          ) : (
            Array.from(itemsByBoss.entries()).map(([boss, items]) => (
              <div key={boss} className="space-y-3">
                <div className="font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                  {boss}
                </div>
                <div className="space-y-2">
                  {items.map((item) => (
                    <div
                      key={item.item_id}
                      className="overflow-hidden rounded-lg border border-outline-variant/10 bg-surface-container-low"
                    >
                      <div className="flex items-center gap-2 border-b border-outline-variant/10 px-4 py-2">
                        <span className="text-sm font-medium text-on-surface">{item.name}</span>
                        <span className="rounded bg-surface-container-high px-1.5 py-0.5 text-[11px] font-semibold text-on-surface-variant">
                          ilvl {item.ilevel}
                        </span>
                        <span className="text-[11px] text-on-surface-variant/50">{item.slot}</span>
                      </div>
                      <div className="divide-y divide-outline-variant/10">
                        {item.results
                          .filter((r) => memberMap.has(r.member_id))
                          .map((r) => {
                            const isUpgrade = !r.is_downgrade && r.upgrade_pct > 0;
                            return (
                              <div
                                key={r.member_id}
                                className="flex items-center justify-between px-4 py-2"
                              >
                                <span className="text-sm text-on-surface">
                                  {memberMap.get(r.member_id)}
                                </span>
                                <span
                                  className={`text-sm font-medium tabular-nums ${
                                    isUpgrade
                                      ? 'text-green-400'
                                      : 'text-on-surface-variant/50'
                                  }`}
                                >
                                  {isUpgrade ? '+' : ''}
                                  {r.upgrade_pct.toFixed(1)}%
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
