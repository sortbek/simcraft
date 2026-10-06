import { useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { JobOverviewSummary } from '../../lib/api';
import { isActiveStatus } from '../../lib/useActiveSims';
import { specDisplayName } from '../../lib/types';
import { useLanguage } from '../../lib/i18n';
import { formatDps } from '../../lib/format';
import { JobActionButtons } from './JobActionButtons';
import { SIM_TYPE_LABELS, SIM_TYPE_PILL, StatusDot, TD, timeAgo } from './shared';
import Button from '../../components/ui/Button';
import Pill from '../../components/ui/Pill';

type HistoryEntry =
  | { type: 'single'; sim: JobOverviewSummary }
  | { type: 'batch'; batchId: string; sims: JobOverviewSummary[] };

function groupByBatch(sims: JobOverviewSummary[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const batches = new Map<string, JobOverviewSummary[]>();
  for (const sim of sims) {
    if (!sim.batch_id) {
      entries.push({ type: 'single', sim });
      continue;
    }
    let group = batches.get(sim.batch_id);
    if (!group) {
      group = [];
      batches.set(sim.batch_id, group);
      entries.push({ type: 'batch', batchId: sim.batch_id, sims: group });
    }
    group.push(sim);
  }
  return entries;
}

/** History-style row for the All view. `trailing` (delete X or action cluster)
 * is rendered inline beside the timestamp to keep row heights uniform. */
function HistoryRow({ job, trailing }: { job: JobOverviewSummary; trailing: ReactNode }) {
  const router = useRouter();
  const { t } = useLanguage();
  const isFailed = job.status === 'failed';
  const navigate = () => router.push(`/sim/${job.id}`);

  return (
    <tr
      onClick={navigate}
      onKeyDown={(e) => {
        if (e.key === 'Enter') navigate();
      }}
      tabIndex={0}
      className={`group cursor-pointer focus:outline-none ${isFailed ? 'opacity-70' : ''}`}
    >
      <td className={TD}>
        <div className="flex min-w-0 items-center gap-3">
          <StatusDot status={job.status} />
          <div className="min-w-0">
            <p className="truncate font-bold text-on-surface">
              {job.player_name || (isFailed ? t('sims.failedSimulation') : t('sims.simulation'))}
            </p>
            <p className={`truncate text-[12px] ${isFailed ? 'text-negative' : 'text-outline'}`}>
              {isFailed && job.error_message
                ? job.error_message.slice(0, 60)
                : job.player_class
                  ? specDisplayName(job.player_class)
                  : job.sim_type}
            </p>
          </div>
        </div>
      </td>
      <td className={TD}>
        <Pill variant={SIM_TYPE_PILL[job.sim_type] ?? 'neutral'}>
          {SIM_TYPE_LABELS[job.sim_type] || job.sim_type}
        </Pill>
      </td>
      <td className={`${TD} text-right`}>
        {job.dps ? (
          <span className="font-headline text-sm font-extrabold text-on-surface">
            {formatDps(job.dps)}
          </span>
        ) : (
          <span className="text-outline">—</span>
        )}
      </td>
      <td className={TD}>
        <Pill>{job.fight_style}</Pill>
      </td>
      <td className={`${TD} text-right`}>
        <div className="flex items-center justify-end gap-1">
          <span className="text-outline">{timeAgo(job.created_at, t)}</span>
          {trailing}
        </div>
      </td>
    </tr>
  );
}

interface RowProps {
  job: JobOverviewSummary;
  busy: string | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
}

function ActionableHistoryRow({ job, busy, onPause, onResume, onCancel, onDelete }: RowProps) {
  const { t } = useLanguage();
  const trailing = isActiveStatus(job.status) ? (
    <JobActionButtons
      job={job}
      busy={busy === job.id}
      onPause={() => onPause(job.id)}
      onResume={() => onResume(job.id)}
      onCancel={() => onCancel(job.id)}
      compact
    />
  ) : (
    <Button
      disabled={busy === job.id}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete(job.id);
      }}
      title={t('sims.deleteFromHistory')}
      variant="text"
      size="sm"
      className="ml-1 hover:text-negative"
    >
      ✕
    </Button>
  );
  return <HistoryRow job={job} trailing={trailing} />;
}

function BatchGroup({
  entry,
  busy,
  onPause,
  onResume,
  onCancel,
  onDelete,
}: {
  entry: Extract<HistoryEntry, { type: 'batch' }>;
  busy: string | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useLanguage();
  const first = entry.sims[0];
  const simType =
    SIM_TYPE_LABELS[first?.sim_type ?? ''] || first?.sim_type || t('sims.simFallback');
  return (
    <>
      <tr>
        <td
          colSpan={5}
          className="h-11 border-b border-line/[0.06] bg-surface-container-high/50 px-6"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="lbl flex items-center gap-2 text-gold">
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M2 4h12M2 8h12M2 12h12" />
              </svg>
              {t('sims.batchLabel', { simType, count: entry.sims.length })}
              {first?.player_name && (
                <span className="ml-2 font-sans text-[12px] font-semibold normal-case tracking-normal text-on-surface-variant">
                  {first.player_name}
                </span>
              )}
            </span>
            <span className="text-[12px] text-outline">
              {first?.created_at ? timeAgo(first.created_at, t) : ''}
            </span>
          </div>
        </td>
      </tr>
      {entry.sims.map((sim) => (
        <ActionableHistoryRow
          key={sim.id}
          job={sim}
          busy={busy}
          onPause={onPause}
          onResume={onResume}
          onCancel={onCancel}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

interface Props {
  jobs: JobOverviewSummary[];
  loading: boolean;
  isDesktop: boolean | null;
  character: { name: string; realm: string } | null;
  busy: string | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
}

export function AllView({
  jobs,
  loading,
  isDesktop,
  character,
  busy,
  onPause,
  onResume,
  onCancel,
  onDelete,
}: Props) {
  const { t } = useLanguage();
  const entries = useMemo(() => groupByBatch(jobs), [jobs]);

  if (loading) {
    return (
      <div className="py-12 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-surface-container-highest border-t-primary" />
      </div>
    );
  }
  if (isDesktop === false && !character) {
    return <div className="card p-12 text-center text-outline">{t('sims.pasteExport')}</div>;
  }
  if (jobs.length === 0) {
    return <div className="card p-12 text-center text-outline">{t('sims.noSimsYet')}</div>;
  }

  return (
    <section className="card overflow-hidden">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <th className="lbl h-11 border-b border-line/[0.06] px-6">{t('sims.colSimulation')}</th>
            <th className="lbl h-11 border-b border-line/[0.06] px-6">{t('sims.colType')}</th>
            <th className="lbl h-11 border-b border-line/[0.06] px-6 text-right">DPS</th>
            <th className="lbl h-11 border-b border-line/[0.06] px-6">{t('sims.colFight')}</th>
            <th className="lbl h-11 border-b border-line/[0.06] px-6 text-right">
              {t('sims.colTime')}
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            if (entry.type === 'single') {
              return (
                <ActionableHistoryRow
                  key={entry.sim.id}
                  job={entry.sim}
                  busy={busy}
                  onPause={onPause}
                  onResume={onResume}
                  onCancel={onCancel}
                  onDelete={onDelete}
                />
              );
            }
            return (
              <BatchGroup
                key={entry.batchId}
                entry={entry}
                busy={busy}
                onPause={onPause}
                onResume={onResume}
                onCancel={onCancel}
                onDelete={onDelete}
              />
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
