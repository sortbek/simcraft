import { useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { JobOverviewSummary } from '../../lib/api';
import { isActiveStatus } from '../../lib/useActiveSims';
import { specDisplayName } from '../../lib/types';
import { useLanguage } from '../../lib/i18n';
import { formatDps } from '../../lib/format';
import { JobActionButtons } from './JobActionButtons';
import { SIM_TYPE_COLORS, SIM_TYPE_LABELS, StatusDot, timeAgo } from './shared';

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

/** History-style row used in the All view. `trailing` is rendered to the
 * right of the timestamp — either the delete X for terminal rows or the
 * Pause/Resume/Cancel cluster for active ones. Keeping the slot inline
 * (rather than stacking a second row) keeps row heights uniform. */
function HistoryRow({ job, trailing }: { job: JobOverviewSummary; trailing: ReactNode }) {
  const router = useRouter();
  const { t } = useLanguage();
  const isFailed = job.status === 'failed';
  const simTypeColor =
    SIM_TYPE_COLORS[job.sim_type] ||
    'border-outline-variant/10 bg-surface-container-highest text-on-surface-variant';
  const navigate = () => router.push(`/sim/${job.id}`);

  return (
    <div
      onClick={navigate}
      onKeyDown={(e) => {
        if (e.key === 'Enter') navigate();
      }}
      tabIndex={0}
      className={`group grid cursor-pointer grid-cols-12 items-center gap-2 px-6 py-4 transition-colors hover:bg-surface-container-high/40 focus:bg-surface-container-high/30 focus:outline-none ${isFailed ? 'opacity-70' : ''}`}
    >
      <div className="col-span-1 flex items-center">
        <StatusDot status={job.status} />
      </div>
      <div className="col-span-3 min-w-0">
        <p className="truncate text-sm font-bold text-on-surface">
          {job.player_name || (isFailed ? 'Failed simulation' : 'Simulation')}
        </p>
        <p
          className={`truncate text-[11px] font-medium ${isFailed ? 'text-error' : 'text-on-surface-variant/70'}`}
        >
          {isFailed && job.error_message
            ? job.error_message.slice(0, 60)
            : job.player_class
              ? specDisplayName(job.player_class)
              : job.sim_type}
        </p>
      </div>
      <div className="col-span-2 text-center">
        <span
          className={`inline-block rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${simTypeColor}`}
        >
          {SIM_TYPE_LABELS[job.sim_type] || job.sim_type}
        </span>
      </div>
      <div className="col-span-2 text-right">
        <p className="font-headline text-lg font-black leading-none text-on-surface">
          {job.dps ? formatDps(job.dps) : '---'}
        </p>
      </div>
      <div className="col-span-2 text-center">
        <span className="rounded border border-outline-variant/10 bg-surface-container-highest px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
          {job.fight_style}
        </span>
      </div>
      <div className="col-span-2 flex items-center justify-end gap-1">
        <span className="text-[11px] text-on-surface-variant/60">{timeAgo(job.created_at, t)}</span>
        {trailing}
      </div>
    </div>
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
    <button
      disabled={busy === job.id}
      onClick={(e) => {
        e.stopPropagation();
        onDelete(job.id);
      }}
      title="Delete from history"
      className="ml-1 rounded px-1.5 py-0.5 text-[11px] text-on-surface-variant/40 hover:bg-red-500/10 hover:text-error disabled:opacity-40"
    >
      ✕
    </button>
  );
  return (
    <div className="border-b border-outline-variant/5">
      <HistoryRow job={job} trailing={trailing} />
    </div>
  );
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
  const simType = SIM_TYPE_LABELS[first?.sim_type ?? ''] || first?.sim_type || 'Sim';
  return (
    <div className="border-b border-outline-variant/10">
      <div className="flex items-center justify-between border-b border-outline-variant/5 bg-surface-container/50 px-6 py-2">
        <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-primary">
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
          {simType} batch · {entry.sims.length} scenarios
          {first?.player_name && (
            <span className="ml-2 normal-case tracking-normal text-on-surface-variant/60">
              {first.player_name}
            </span>
          )}
        </span>
        <span className="text-[10px] text-on-surface-variant/60">
          {first?.created_at ? timeAgo(first.created_at, t) : ''}
        </span>
      </div>
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
    </div>
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
  const entries = useMemo(() => groupByBatch(jobs), [jobs]);

  if (loading) {
    return (
      <div className="py-12 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-surface-container-highest border-t-primary" />
      </div>
    );
  }
  if (isDesktop === false && !character) {
    return (
      <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-12 text-center text-on-surface-variant/60">
        Paste a SimC export to load this character&apos;s sim history.
      </div>
    );
  }
  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-12 text-center text-on-surface-variant/60">
        No sims yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/10 bg-surface-container-low">
      <div className="grid grid-cols-12 gap-2 border-b border-outline-variant/10 bg-surface-container-lowest px-6 py-3 font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/60">
        <div className="col-span-1"></div>
        <div className="col-span-3">Simulation</div>
        <div className="col-span-2 text-center">Type</div>
        <div className="col-span-2 text-right">DPS</div>
        <div className="col-span-2 text-center">Fight</div>
        <div className="col-span-2 text-right">Time</div>
      </div>
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
    </div>
  );
}
