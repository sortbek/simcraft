'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  API_URL,
  deleteJob,
  fetchAllJobs,
  pauseSim,
  resumeSim,
  type JobOverviewSummary,
} from '../lib/api';
import { isActiveStatus, useActiveSims } from '../lib/useActiveSims';
import { useSimContext } from '../components/sim-config/SimContext';
import { loadLastCharacter, parseCharacterInfo } from '../lib/character';
import { ActiveView } from './_components/ActiveView';
import { AllView } from './_components/AllView';
import { StatsOverview } from './_components/StatsOverview';

type ViewMode = 'active' | 'all';

export default function SimsPage() {
  const {
    jobs: activeSnapshot,
    error: pollError,
    refresh: refreshActive,
    setPauseRequested,
  } = useActiveSims();
  const { simcInput } = useSimContext();
  const [allJobs, setAllJobs] = useState<JobOverviewSummary[]>([]);
  const [allLoading, setAllLoading] = useState(true);
  const [allError, setAllError] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const [character, setCharacter] = useState<{ name: string; realm: string } | null>(null);
  const [view, setView] = useState<ViewMode>('active');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setIsDesktop(!!window.electronAPI);
  }, []);

  // Web mode picks up the current character from simc input / localStorage
  // so the history list scopes to that user. Desktop sees everything.
  useEffect(() => {
    if (isDesktop !== false) return;
    const info = parseCharacterInfo(simcInput);
    if (info?.name && info.realm) {
      setCharacter({ name: info.name, realm: info.realm });
    } else {
      setCharacter(loadLastCharacter());
    }
  }, [isDesktop, simcInput]);

  // Fetch full history (used by stats and the All view).
  const loadAllJobs = useCallback(() => {
    if (isDesktop === null) return;
    if (isDesktop === false && !character) {
      setAllJobs([]);
      setAllLoading(false);
      return;
    }
    setAllLoading(true);
    setAllError(null);
    fetchAllJobs(isDesktop ? {} : { player: character!.name, realm: character!.realm })
      .then((data) => setAllJobs(Array.isArray(data) ? data : []))
      .catch((e) => {
        setAllJobs([]);
        setAllError(e instanceof Error ? e.message : 'Failed to load history');
      })
      .finally(() => setAllLoading(false));
  }, [isDesktop, character]);

  useEffect(() => {
    loadAllJobs();
  }, [loadAllJobs]);

  // Merge live polling data over the snapshot so active rows in the All view
  // reflect progress updates without requiring a manual refresh.
  const mergedJobs = useMemo(() => {
    const liveById = new Map(activeSnapshot.map((j) => [j.id, j]));
    const merged = allJobs.map((j) => liveById.get(j.id) ?? j);
    for (const live of activeSnapshot) {
      if (!merged.some((j) => j.id === live.id)) {
        merged.unshift(live);
      }
    }
    return merged;
  }, [activeSnapshot, allJobs]);

  const activeList = useMemo(
    () => activeSnapshot.filter((j) => isActiveStatus(j.status)),
    [activeSnapshot]
  );

  const refreshAll = useCallback(() => {
    refreshActive();
    loadAllJobs();
  }, [refreshActive, loadAllJobs]);

  const wrapAction = useCallback(
    async (id: string, fn: () => Promise<void>, errorPrefix: string) => {
      setBusy(id);
      setActionError(null);
      try {
        await fn();
        refreshAll();
      } catch (e: unknown) {
        setActionError(e instanceof Error ? e.message : errorPrefix);
      } finally {
        setBusy(null);
      }
    },
    [refreshAll]
  );

  const handlePause = useCallback(
    async (id: string) => {
      setPauseRequested(id, true);
      setBusy(id);
      setActionError(null);
      try {
        await pauseSim(id);
        refreshAll();
      } catch (e: unknown) {
        setPauseRequested(id, false);
        setActionError(e instanceof Error ? e.message : 'Failed to pause sim');
      } finally {
        setBusy(null);
      }
    },
    [refreshAll, setPauseRequested]
  );
  const handleResume = useCallback(
    (id: string) => wrapAction(id, () => resumeSim(id), 'Failed to resume sim'),
    [wrapAction]
  );
  const handleCancel = useCallback(
    (id: string) => {
      if (!window.confirm('Cancel this sim? This cannot be undone.')) return;
      wrapAction(
        id,
        async () => {
          const res = await fetch(`${API_URL}/api/sim/${id}/cancel`, { method: 'POST' });
          if (!res.ok) {
            const detail = await res.json().catch(() => ({}));
            throw new Error(detail.detail || `Cancel failed (${res.status})`);
          }
        },
        'Failed to cancel sim'
      );
    },
    [wrapAction]
  );
  const handleDelete = useCallback(
    (id: string) => {
      if (!window.confirm('Delete this sim from history? This cannot be undone.')) return;
      wrapAction(id, () => deleteJob(id), 'Failed to delete sim');
    },
    [wrapAction]
  );

  const error = actionError ?? pollError ?? allError;

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="mb-2 font-headline text-4xl font-black uppercase tracking-tighter text-on-surface">
            Sims
          </h1>
          <p className="max-w-2xl text-sm text-on-surface-variant">
            Live status of in-flight sims and the full history of recent runs.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-outline-variant/10 bg-surface-container-low p-1">
          <button
            onClick={() => setView('active')}
            className={`rounded-md px-3 py-1 text-[12px] font-medium uppercase tracking-wider transition-colors ${
              view === 'active'
                ? 'bg-primary-container/20 text-primary'
                : 'text-on-surface-variant/60 hover:text-on-surface'
            }`}
          >
            Active ({activeList.length})
          </button>
          <button
            onClick={() => setView('all')}
            className={`rounded-md px-3 py-1 text-[12px] font-medium uppercase tracking-wider transition-colors ${
              view === 'all'
                ? 'bg-primary-container/20 text-primary'
                : 'text-on-surface-variant/60 hover:text-on-surface'
            }`}
          >
            All ({mergedJobs.length})
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-[13px] text-red-400">
          {error}
        </div>
      )}

      <StatsOverview sims={mergedJobs} />

      {view === 'active' ? (
        <ActiveView
          jobs={activeList}
          busy={busy}
          onPause={handlePause}
          onResume={handleResume}
          onCancel={handleCancel}
        />
      ) : (
        <AllView
          jobs={mergedJobs}
          loading={allLoading}
          isDesktop={isDesktop}
          character={character}
          busy={busy}
          onPause={handlePause}
          onResume={handleResume}
          onCancel={handleCancel}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
