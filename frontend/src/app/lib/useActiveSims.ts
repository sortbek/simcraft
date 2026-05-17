'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchActiveJobs, type JobActiveSummary } from './api';

const POLL_INTERVAL_MS = 2500;

const ACTIVE_STATUSES = new Set(['pending', 'running', 'paused']);

interface UseActiveSimsResult {
  jobs: JobActiveSummary[];
  activeCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Shared polling hook for the sims overview and the header indicator.
 * Stops polling when the tab is hidden (visibilitychange) to avoid wasted
 * backend traffic. Resumes on visibility.
 */
export function useActiveSims(): UseActiveSimsResult {
  const [jobs, setJobs] = useState<JobActiveSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const list = await fetchActiveJobs();
      if (!mountedRef.current) return;
      setJobs(list);
      setError(null);
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to fetch active sims');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let timer: number | undefined;

    const schedule = () => {
      if (document.visibilityState === 'visible') {
        poll();
        timer = window.setTimeout(schedule, POLL_INTERVAL_MS);
      }
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
  }, [poll]);

  const activeCount = jobs.filter((j) => ACTIVE_STATUSES.has(j.status)).length;

  return {
    jobs,
    activeCount,
    loading,
    error,
    refresh: () => {
      void poll();
    },
  };
}
