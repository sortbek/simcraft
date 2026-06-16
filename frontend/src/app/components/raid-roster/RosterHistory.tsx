'use client';

import { useEffect, useState } from 'react';
import { API_URL, fetchJson } from '../../lib/api';
import {
  listRuns,
  getRun,
  type Roster,
  type RosterRun,
  type RosterReport,
} from '../../lib/rosters';
import type { Instance } from '../loot/types';
import RosterReportView from './RosterReportView';

interface Selected {
  run: RosterRun;
  report: RosterReport | null;
  status: string;
}

function statusBadge(status: string) {
  let cls = 'rounded px-1.5 py-0.5 font-headline text-[10px] font-bold uppercase tracking-wider';
  if (status === 'done') cls += ' bg-green-500/20 text-green-400';
  else if (status === 'running') cls += ' bg-surface-container-high text-on-surface-variant';
  else if (status === 'failed') cls += ' bg-red-500/20 text-red-400';
  else cls += ' bg-surface-container-high text-on-surface-variant/60';
  return <span className={cls}>{status}</span>;
}

export default function RosterHistory({ roster }: { roster: Roster }) {
  const [runs, setRuns] = useState<RosterRun[]>([]);
  const [instanceNames, setInstanceNames] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Selected | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingRun, setLoadingRun] = useState(false);

  useEffect(() => {
    setSelected(null);
    setLoadingRuns(true);
    listRuns(roster.id).then((r) => {
      setRuns(r);
      setLoadingRuns(false);
    });
  }, [roster.id]);

  useEffect(() => {
    fetchJson<Instance[]>(`${API_URL}/api/instances`)
      .then((instances) => {
        const map: Record<number, string> = {};
        for (const inst of instances) map[inst.id] = inst.name;
        setInstanceNames(map);
      })
      .catch(() => {});
  }, []);

  const handleRefresh = () => {
    setLoadingRuns(true);
    listRuns(roster.id).then((r) => {
      setRuns(r);
      setLoadingRuns(false);
    });
  };

  const handleSelectRun = async (run: RosterRun) => {
    setLoadingRun(true);
    const res = await getRun(run.id);
    setSelected({
      run,
      report: res?.report ?? null,
      status: res?.status ?? 'unknown',
    });
    setLoadingRun(false);
  };

  const instanceName = (id: number) => instanceNames[id] ?? `Instance ${id}`;

  if (selected) {
    return (
      <div className="space-y-4 border-t border-outline-variant/10 pt-6">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant hover:text-on-surface"
        >
          &larr; Back to history
        </button>

        <div className="text-sm text-on-surface-variant">
          <span className="font-semibold text-on-surface">{instanceName(selected.run.instance_id)}</span>
          {' · '}
          <span className="capitalize">{selected.run.difficulty}</span>
          {' · '}
          {new Date(selected.run.created_at).toLocaleString()}
        </div>

        {selected.report ? (
          <RosterReportView report={selected.report} />
        ) : selected.status === 'running' ? (
          <p className="text-sm text-on-surface-variant">
            This report is still running — check the Loot Report tab.
          </p>
        ) : (
          <p className="text-sm text-on-surface-variant">No report available for this run.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 border-t border-outline-variant/10 pt-6">
      <div className="flex items-center justify-between">
        <div className="font-headline text-xs font-bold uppercase tracking-wider text-on-surface-variant">
          Past runs
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loadingRuns}
          className="font-headline text-xs font-bold uppercase tracking-wider text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {loadingRuns ? (
        <p className="text-sm text-on-surface-variant/60">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-on-surface-variant/60">
          No reports yet — generate one from the Loot Report tab.
        </p>
      ) : (
        <div className="space-y-0.5">
          {runs.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => handleSelectRun(run)}
              disabled={loadingRun}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-on-surface">
                  {instanceName(run.instance_id)}
                  <span className="ml-2 capitalize text-on-surface-variant">{run.difficulty}</span>
                </div>
                <div className="text-[11px] text-on-surface-variant/60">
                  {new Date(run.created_at).toLocaleString()}
                </div>
              </div>
              <div className="ml-3 shrink-0">{statusBadge(run.status)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
