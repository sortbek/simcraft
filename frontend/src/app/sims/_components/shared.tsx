import type { JobStatus } from '../../lib/api';

export const SIM_TYPE_LABELS: Record<string, string> = {
  quick: 'Quick Sim',
  stat_weights: 'Quick Sim',
  top_gear: 'Top Gear',
  droptimizer: 'Drop Finder',
  enchant_gem: 'Enchant/Gem',
  upgrade_compare: 'Crest Upgrades',
};

export const SIM_TYPE_COLORS: Record<string, string> = {
  quick: 'border-primary/20 bg-primary/10 text-primary',
  stat_weights: 'border-primary/20 bg-primary/10 text-primary',
  top_gear: 'border-tertiary/20 bg-tertiary/10 text-tertiary',
  droptimizer: 'border-secondary/20 bg-secondary/10 text-secondary',
};

const STATUS_DOT_COLOR: Record<JobStatus, string> = {
  pending: 'bg-on-surface-variant/40',
  running: 'bg-amber-500 animate-pulse',
  paused: 'bg-sky-400',
  done: 'bg-emerald-500',
  failed: 'bg-red-500',
  cancelled: 'bg-on-surface-variant/40',
};

export function StatusDot({ status }: { status: JobStatus }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT_COLOR[status]}`} />;
}

export function timeAgo(
  iso: string,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return t('time.justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('time.minutesAgo', { m: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { h: hours });
  return t('time.daysAgo', { d: Math.floor(hours / 24) });
}
