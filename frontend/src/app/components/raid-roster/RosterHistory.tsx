'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { StatusBadge } from './StatusBadge';
import Button from '../ui/Button';

interface Selected {
  run: RosterRun;
  report: RosterReport | null;
  status: string;
}

export default function RosterHistory({ roster }: { roster: Roster }) {
  const [runs, setRuns] = useState<RosterRun[]>([]);
  const [instanceNames, setInstanceNames] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Selected | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingRun, setLoadingRun] = useState(false);

  const loadRuns = useCallback(() => {
    setLoadingRuns(true);
    listRuns(roster.id).then((r) => {
      setRuns(r);
      setLoadingRuns(false);
    });
  }, [roster.id]);

  useEffect(() => {
    setSelected(null);
    loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    fetchJson<Instance[]>(`${API_URL}/api/instances`)
      .then((instances) => {
        const map: Record<number, string> = {};
        for (const inst of instances) map[inst.id] = inst.name;
        setInstanceNames(map);
      })
      .catch(() => {});
  }, []);

  const handleRefresh = loadRuns;

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
      <div className="space-y-4 border-t border-line/[0.06] pt-6">
        <Button variant="text" onClick={() => setSelected(null)}>
          &larr; Back to history
        </Button>

        <div className="text-sm text-on-surface-variant">
          <span className="font-semibold text-on-surface">
            {instanceName(selected.run.instance_id)}
          </span>
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
    <div className="space-y-4 border-t border-line/[0.06] pt-6">
      <div className="flex items-center justify-between">
        <div className="lbl">Past runs</div>
        <Button variant="quiet" size="sm" onClick={handleRefresh} disabled={loadingRuns}>
          Refresh
        </Button>
      </div>

      {loadingRuns ? (
        <p className="text-sm text-outline">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-outline">
          No reports yet — generate one from the Loot Report tab.
        </p>
      ) : (
        <div className="card divide-y divide-line/[0.06] overflow-hidden">
          {runs.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => handleSelectRun(run)}
              disabled={loadingRun}
              className="flex min-h-[62px] w-full items-center justify-between px-6 py-3 text-left transition-colors hover:bg-overlay/[0.015] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-on-surface">
                  {instanceName(run.instance_id)}
                  <span className="ml-2 font-normal capitalize text-on-surface-variant">
                    {run.difficulty}
                  </span>
                </div>
                <div className="text-[12px] text-outline">
                  {new Date(run.created_at).toLocaleString()}
                </div>
              </div>
              <div className="ml-3 shrink-0">
                <StatusBadge status={run.status} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
