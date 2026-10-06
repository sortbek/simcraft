import type { JobStatus } from '../../lib/api';
import type { PillVariant } from '../../components/ui/Pill';

/** Table cell shared by the Active and All views. */
export const TD =
  'h-[62px] border-b border-line/[0.06] px-6 group-last:border-b-0 group-hover:bg-overlay/[0.015] group-focus-visible:bg-gold/[0.06]';

export const SIM_TYPE_LABELS: Record<string, string> = {
  quick: 'Quick Sim',
  stat_weights: 'Quick Sim',
  top_gear: 'Top Gear',
  droptimizer: 'Drop Finder',
  upgrade_compare: 'Crest Upgrades',
};

export const SIM_TYPE_PILL: Record<string, PillVariant> = {
  quick: 'gold',
  stat_weights: 'gold',
  top_gear: 'info',
  droptimizer: 'positive',
};

const STATUS_DOT_COLOR: Record<JobStatus, string> = {
  pending: 'bg-fg-4 ring-fg-4/15',
  running: 'bg-quality-rare ring-quality-rare/15 animate-pulse',
  paused: 'bg-gold-fill ring-gold/15',
  done: 'bg-positive ring-positive/15',
  failed: 'bg-negative ring-negative/15',
  cancelled: 'bg-fg-4 ring-fg-4/15',
};

export function StatusDot({ status }: { status: JobStatus }) {
  return (
    <span
      className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ring-[3px] ${STATUS_DOT_COLOR[status]}`}
    />
  );
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
