import type { JobOverviewSummary } from '../../lib/api';

type Job = Pick<JobOverviewSummary, 'id' | 'sim_type' | 'created_at' | 'status' | 'dps'>;

const newestFirst = <T extends Job>(jobs: T[]) =>
  [...jobs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

/** The most recent finished run of each sim type. */
export function lastDoneBySimType<T extends Job>(jobs: T[]): Record<string, T> {
  const last: Record<string, T> = {};
  for (const job of newestFirst(jobs)) {
    if (job.status === 'done' && !last[job.sim_type]) last[job.sim_type] = job;
  }
  return last;
}

/** DPS of the last `count` finished Quick Sims, oldest first, for a sparkline. */
export function quickSimTrend(jobs: Job[], count = 8): number[] {
  return newestFirst(jobs)
    .filter((j) => j.sim_type === 'quick' && j.status === 'done' && j.dps != null && j.dps > 0)
    .slice(0, count)
    .map((j) => j.dps as number)
    .reverse();
}

/** Relative change from the oldest to the newest point; null without two points. */
export function trendChange(values: number[]): number | null {
  if (values.length < 2 || values[0] <= 0) return null;
  return (values[values.length - 1] - values[0]) / values[0];
}

/** The newest runs that have an outcome (finished or failed). */
export function recentJobs<T extends Job>(jobs: T[], count = 5): T[] {
  return newestFirst(jobs)
    .filter((j) => j.status === 'done' || j.status === 'failed')
    .slice(0, count);
}
