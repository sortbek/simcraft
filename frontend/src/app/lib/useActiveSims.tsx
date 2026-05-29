'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { fetchActiveJobs, type JobStatus, type JobOverviewSummary } from './api';

const POLL_INTERVAL_MS = 2500;

/** Job statuses that belong in the Active view and expose management actions.
 * Paused is dormant but still incomplete, so it stays visible there. */
export const ACTIVE_STATUSES: readonly JobStatus[] = ['pending', 'running', 'paused'];
const ACTIVE_STATUS_SET: ReadonlySet<JobStatus> = new Set(ACTIVE_STATUSES);
const RUNNING_STATUS_SET: ReadonlySet<JobStatus> = new Set(['pending', 'running']);

export function isActiveStatus(status: JobStatus): boolean {
  return ACTIVE_STATUS_SET.has(status);
}

interface UseActiveSimsResult {
  jobs: JobOverviewSummary[];
  activeCount: number;
  runningCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  setPauseRequested: (jobId: string, requested: boolean) => void;
}

/** Compare two summaries for the fields the UI actually rerenders on.
 * Returns true if they're effectively identical, so the polling loop can skip
 * the setState and avoid a 2.5s re-render cascade across every page. */
function summariesEqual(a: JobOverviewSummary, b: JobOverviewSummary): boolean {
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.progress_pct === b.progress_pct &&
    a.progress_stage === b.progress_stage &&
    a.progress_detail === b.progress_detail &&
    a.pause_requested === b.pause_requested &&
    a.error_message === b.error_message
  );
}

function jobListsEqual(a: JobOverviewSummary[], b: JobOverviewSummary[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!summariesEqual(a[i], b[i])) return false;
  }
  return true;
}

/** Internal: the actual polling loop. Mounted once by ActiveSimsProvider. */
function usePolledActiveSims(): UseActiveSimsResult {
  const [jobs, setJobs] = useState<JobOverviewSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // poll lives in a ref so `refresh` outside the effect can fire it. Defined
  // once on mount inside the effect — never reassigned per render.
  const pollRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    mountedRef.current = true;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const list = await fetchActiveJobs();
        if (!mountedRef.current) return;
        setJobs((prev) => (jobListsEqual(prev, list) ? prev : list));
        setError(null);
      } catch (e: unknown) {
        if (!mountedRef.current) return;
        setError(e instanceof Error ? e.message : 'Failed to fetch active sims');
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };
    pollRef.current = poll;

    const schedule = () => {
      if (document.visibilityState !== 'visible') return;
      void poll();
      timer = window.setTimeout(schedule, POLL_INTERVAL_MS);
    };

    const onVisibility = () => {
      if (timer) window.clearTimeout(timer);
      schedule();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mountedRef.current = false;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const activeCount = useMemo(
    () => jobs.filter((j) => ACTIVE_STATUS_SET.has(j.status)).length,
    [jobs]
  );
  const runningCount = useMemo(
    () => jobs.filter((j) => RUNNING_STATUS_SET.has(j.status)).length,
    [jobs]
  );

  return useMemo(
    () => ({
      jobs,
      activeCount,
      runningCount,
      loading,
      error,
      refresh: () => {
        void pollRef.current();
      },
      setPauseRequested: (jobId: string, requested: boolean) => {
        setJobs((prev) =>
          prev.map((job) => (job.id === jobId ? { ...job, pause_requested: requested } : job))
        );
      },
    }),
    [jobs, activeCount, runningCount, loading, error]
  );
}

const ActiveSimsContext = createContext<UseActiveSimsResult | null>(null);

/**
 * Mount once near the root of the app. Runs a single polling loop and
 * exposes the latest snapshot to all descendants via `useActiveSims()`.
 */
export function ActiveSimsProvider({ children }: { children: ReactNode }) {
  const value = usePolledActiveSims();
  return <ActiveSimsContext.Provider value={value}>{children}</ActiveSimsContext.Provider>;
}

/**
 * Read the shared active-sims snapshot. Must be called inside an
 * `ActiveSimsProvider`. The `/sims` page and the header indicator both
 * call this; they share one polling loop instead of running their own.
 */
export function useActiveSims(): UseActiveSimsResult {
  const ctx = useContext(ActiveSimsContext);
  if (!ctx) {
    throw new Error('useActiveSims must be used inside an ActiveSimsProvider');
  }
  return ctx;
}
