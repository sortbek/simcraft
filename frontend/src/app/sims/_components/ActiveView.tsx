import { useRouter } from 'next/navigation';
import type { JobOverviewSummary } from '../../lib/api';
import { specDisplayName } from '../../lib/types';
import { useLanguage } from '../../lib/i18n';
import { JobActionButtons } from './JobActionButtons';
import { SIM_TYPE_LABELS, StatusDot, timeAgo } from './shared';

interface ActiveRowProps {
  job: JobOverviewSummary;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

function ActiveRow({ job, busy, onPause, onResume, onCancel }: ActiveRowProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const navigate = () => router.push(`/sim/${job.id}`);

  return (
    <tr
      onClick={navigate}
      onKeyDown={(e) => {
        if (e.key === 'Enter') navigate();
      }}
      tabIndex={0}
      className="cursor-pointer border-b border-outline-variant/5 transition-colors hover:bg-surface-container-high/50 focus:bg-surface-container-high/30 focus:outline-none"
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2" title={job.error_message ?? undefined}>
          <StatusDot status={job.status} />
          <span className="text-[13px] capitalize text-on-surface">{job.status}</span>
        </div>
        {job.status === 'failed' && job.error_message && (
          <div className="mt-0.5 max-w-xs truncate text-[11px] text-red-400/70">
            {job.error_message}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-[13px] text-on-surface-variant">
        {SIM_TYPE_LABELS[job.sim_type] ?? job.sim_type}
      </td>
      <td className="px-4 py-3 text-[13px] text-on-surface">
        {job.player_name ?? '—'}
        {job.player_class && (
          <span className="ml-1.5 text-on-surface-variant/60">
            ({specDisplayName(job.player_class)})
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-[13px] text-on-surface-variant">
        <div className="flex items-center gap-2">
          <div className="h-1 w-20 overflow-hidden rounded-full bg-surface-container-highest">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${job.progress_pct}%` }}
            />
          </div>
          <span className="font-mono text-[12px] tabular-nums">{job.progress_pct}%</span>
          {job.progress_stage && (
            <span className="ml-1 text-on-surface-variant/60">· {job.progress_stage}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-[13px] text-on-surface-variant/60">
        {timeAgo(job.created_at, t)}
      </td>
      <td className="px-4 py-3 text-right">
        <JobActionButtons
          job={job}
          busy={busy}
          onPause={onPause}
          onResume={onResume}
          onCancel={onCancel}
        />
      </td>
    </tr>
  );
}

interface Props {
  jobs: JobOverviewSummary[];
  busy: string | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
}

export function ActiveView({ jobs, busy, onPause, onResume, onCancel }: Props) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-12 text-center text-on-surface-variant/60">
        No active sims.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/10 bg-surface-container-low">
      <table className="w-full">
        <thead className="border-b border-outline-variant/10 text-left text-[11px] font-bold uppercase tracking-wider text-on-surface-variant/60">
          <tr>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Character</th>
            <th className="px-4 py-3">Progress</th>
            <th className="px-4 py-3">Started</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <ActiveRow
              key={j.id}
              job={j}
              busy={busy === j.id}
              onPause={() => onPause(j.id)}
              onResume={() => onResume(j.id)}
              onCancel={() => onCancel(j.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
