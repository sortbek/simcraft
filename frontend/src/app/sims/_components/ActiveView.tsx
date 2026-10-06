import { useRouter } from 'next/navigation';
import type { JobOverviewSummary } from '../../lib/api';
import { specDisplayName } from '../../lib/types';
import { useLanguage } from '../../lib/i18n';
import { JobActionButtons } from './JobActionButtons';
import { SIM_TYPE_LABELS, StatusDot, TD, timeAgo } from './shared';

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
      className="group cursor-pointer focus:outline-none"
    >
      <td className={TD}>
        <div className="flex items-center gap-3" title={job.error_message ?? undefined}>
          <StatusDot status={job.status} />
          <span className="text-sm font-bold capitalize text-on-surface">{job.status}</span>
        </div>
        {job.status === 'failed' && job.error_message && (
          <div className="mt-0.5 max-w-xs truncate text-[12px] text-negative/70">
            {job.error_message}
          </div>
        )}
      </td>
      <td className={`${TD} text-[13px] text-on-surface-variant`}>
        {SIM_TYPE_LABELS[job.sim_type] ?? job.sim_type}
      </td>
      <td className={`${TD} text-[13px] text-on-surface`}>
        {job.player_name ?? '—'}
        {job.player_class && (
          <span className="ml-1.5 text-outline">({specDisplayName(job.player_class)})</span>
        )}
      </td>
      <td className={`${TD} text-[13px] text-on-surface-variant`}>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-container-highest">
            <div
              className="h-full bg-gradient-to-r from-gold-dark to-gold-fill transition-all"
              style={{ width: `${job.progress_pct}%` }}
            />
          </div>
          <span className="font-mono text-[12px] tabular-nums">{job.progress_pct}%</span>
          {job.progress_stage && <span className="ml-1 text-outline">· {job.progress_stage}</span>}
        </div>
      </td>
      <td className={`${TD} text-[13px] text-outline`}>{timeAgo(job.created_at, t)}</td>
      <td className={`${TD} text-right`}>
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
  const { t } = useLanguage();
  if (jobs.length === 0) {
    return <div className="card p-12 text-center text-outline">{t('sims.noActiveSims')}</div>;
  }
  return (
    <div className="card overflow-hidden">
      <table className="w-full border-collapse">
        <thead className="text-left">
          <tr>
            <th className="lbl h-11 border-b border-line/[0.06] px-6">{t('sims.colStatus')}</th>
            <th className="lbl h-11 border-b border-line/[0.06] px-6">{t('sims.colType')}</th>
            <th className="lbl h-11 border-b border-line/[0.06] px-6">{t('sims.colCharacter')}</th>
            <th className="lbl h-11 border-b border-line/[0.06] px-6">{t('sims.colProgress')}</th>
            <th className="lbl h-11 border-b border-line/[0.06] px-6">{t('sims.colStarted')}</th>
            <th className="lbl h-11 border-b border-line/[0.06] px-6 text-right">
              {t('sims.colActions')}
            </th>
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
