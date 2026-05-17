'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  API_URL,
  deleteJob,
  fetchAllJobs,
  pauseSim,
  resumeSim,
  type JobActiveStatus,
  type JobActiveSummary,
} from '../lib/api';
import { isActiveStatus, useActiveSims } from '../lib/useActiveSims';
import { specDisplayName } from '../lib/types';
import { useLanguage } from '../lib/i18n';
import { useSimContext } from '../components/sim-config/SimContext';

const SIM_TYPE_LABELS: Record<string, string> = {
  quick: 'Quick Sim',
  stat_weights: 'Quick Sim',
  top_gear: 'Top Gear',
  droptimizer: 'Drop Finder',
  enchant_gem: 'Enchant/Gem',
  upgrade_compare: 'Crest Upgrades',
};

const SIM_TYPE_COLORS: Record<string, string> = {
  quick: 'border-primary/20 bg-primary/10 text-primary',
  stat_weights: 'border-primary/20 bg-primary/10 text-primary',
  top_gear: 'border-tertiary/20 bg-tertiary/10 text-tertiary',
  droptimizer: 'border-secondary/20 bg-secondary/10 text-secondary',
};

const STATUS_DOT_COLOR: Record<JobActiveStatus, string> = {
  pending: 'bg-on-surface-variant/40',
  running: 'bg-amber-500 animate-pulse',
  paused: 'bg-sky-400',
  done: 'bg-emerald-500',
  failed: 'bg-red-500',
  cancelled: 'bg-on-surface-variant/40',
};

/* ── Helpers ─────────────────────────────────────────────── */

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDps(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toLocaleString();
}

function extractCharacter(simcInput: string): { name: string; realm: string } | null {
  let name = '';
  let realm = '';
  for (const line of simcInput.split('\n')) {
    const trimmed = line.trim();
    if (!name) {
      const match = trimmed.match(
        /^(?:warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|druid|demon_hunter|demonhunter|evoker)\s*=\s*"(.+)"/
      );
      if (match) name = match[1];
    }
    if (!realm && trimmed.startsWith('server=')) {
      realm = trimmed.slice(7);
    }
    if (name && realm) break;
  }
  if (name && realm) {
    try {
      localStorage.setItem('simhammer_last_character', JSON.stringify({ name, realm }));
    } catch {
      // ignore quota / privacy errors
    }
    return { name, realm };
  }
  return null;
}

function StatusDot({ status }: { status: JobActiveStatus }) {
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT_COLOR[status]}`} />
  );
}

/* ── Stats Overview ──────────────────────────────────────── */

function StatsOverview({ sims }: { sims: JobActiveSummary[] }) {
  const totalSims = sims.length;
  const completedSims = sims.filter((s) => s.status === 'done');
  const completionRate = totalSims > 0 ? (completedSims.length / totalSims) * 100 : 0;
  const bestDps = Math.max(0, ...completedSims.map((s) => s.dps ?? 0));
  const uniqueCharacters = new Set(
    sims.filter((s) => s.player_name).map((s) => `${s.player_name}-${s.realm ?? ''}`),
  ).size;

  return (
    <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
        <p className="mb-1 font-headline text-[11px] uppercase tracking-widest text-on-surface-variant">
          Total sims
        </p>
        <p className="font-headline text-3xl font-black text-primary">
          {totalSims.toLocaleString()}
        </p>
        <p className="mt-2 text-[10px] text-outline">
          {completedSims.length} completed · {completionRate.toFixed(0)}%
        </p>
      </div>
      <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
        <p className="mb-1 font-headline text-[11px] uppercase tracking-widest text-on-surface-variant">
          Characters
        </p>
        <p className="font-headline text-3xl font-black text-tertiary">{uniqueCharacters}</p>
        <p className="mt-2 text-[10px] text-outline">unique character / realm pairs</p>
      </div>
      <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
        <p className="mb-1 font-headline text-[11px] uppercase tracking-widest text-on-surface-variant">
          Best DPS
        </p>
        <p className="font-headline text-3xl font-black text-on-surface">
          {bestDps > 0 ? formatDps(bestDps) : '—'}
        </p>
        <p className="mt-2 text-[10px] text-outline">highest completed result</p>
      </div>
    </div>
  );
}

/* ── Active row (table style) ────────────────────────────── */

function ActiveRow({
  job,
  busy,
  onPause,
  onResume,
  onCancel,
}: {
  job: JobActiveSummary;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
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
        <div
          className="flex items-center gap-2"
          title={job.error_message ?? undefined}
        >
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
        {timeAgo(job.created_at)}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          {job.status === 'running' && job.simc_input_mode === 'streamed' && (
            <button
              disabled={busy || job.pause_requested}
              onClick={(e) => {
                e.stopPropagation();
                onPause();
              }}
              className="rounded px-2 py-1 text-[12px] text-on-surface-variant/60 hover:bg-white/5 hover:text-on-surface disabled:opacity-40"
            >
              {job.pause_requested ? 'Pausing…' : 'Pause'}
            </button>
          )}
          {job.status === 'paused' && (
            <button
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                onResume();
              }}
              className="rounded px-2 py-1 text-[12px] text-primary hover:bg-primary/10 disabled:opacity-40"
            >
              Resume
            </button>
          )}
          {isActiveStatus(job.status) && (
            <button
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="rounded px-2 py-1 text-[12px] text-on-surface-variant/60 hover:bg-red-500/10 hover:text-error disabled:opacity-40"
            >
              Cancel
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ── History row (richer card style with DPS + delete) ──── */

function HistoryRow({
  job,
  busy,
  onDelete,
}: {
  job: JobActiveSummary;
  busy: boolean;
  onDelete: () => void;
}) {
  const router = useRouter();
  const isTerminal = !isActiveStatus(job.status);
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
        <span className="text-[11px] text-on-surface-variant/60">{timeAgo(job.created_at)}</span>
        {isTerminal && (
          <button
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete from history"
            className="ml-1 rounded px-1.5 py-0.5 text-[11px] text-on-surface-variant/40 hover:bg-red-500/10 hover:text-error disabled:opacity-40"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Batch grouping ──────────────────────────────────────── */

type HistoryEntry =
  | { type: 'single'; sim: JobActiveSummary }
  | { type: 'batch'; batchId: string; sims: JobActiveSummary[] };

function groupByBatch(sims: JobActiveSummary[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const batches = new Map<string, JobActiveSummary[]>();
  const seen = new Set<string>();
  for (const sim of sims) {
    if (sim.batch_id) {
      let group = batches.get(sim.batch_id);
      if (!group) {
        group = [];
        batches.set(sim.batch_id, group);
        if (!seen.has(sim.batch_id)) {
          seen.add(sim.batch_id);
          entries.push({ type: 'batch', batchId: sim.batch_id, sims: group });
        }
      }
      group.push(sim);
    } else {
      entries.push({ type: 'single', sim });
    }
  }
  return entries;
}

/* ── Page ────────────────────────────────────────────────── */

type ViewMode = 'active' | 'all';

export default function SimsPage() {
  const { jobs: activeSnapshot, error: pollError, refresh: refreshActive } = useActiveSims();
  const { simcInput } = useSimContext();
  const [allJobs, setAllJobs] = useState<JobActiveSummary[]>([]);
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
    let char = extractCharacter(simcInput);
    if (!char) {
      try {
        const stored = localStorage.getItem('simhammer_last_character');
        if (stored) char = JSON.parse(stored);
      } catch {
        // ignore
      }
    }
    setCharacter(char);
  }, [isDesktop, simcInput]);

  // Fetch full history (used by stats and the All view).
  useEffect(() => {
    if (isDesktop === null) return;
    if (isDesktop === false && !character) {
      setAllJobs([]);
      setAllLoading(false);
      return;
    }
    setAllLoading(true);
    setAllError(null);
    fetchAllJobs(
      isDesktop ? {} : { player: character!.name, realm: character!.realm },
    )
      .then((data) => setAllJobs(Array.isArray(data) ? data : []))
      .catch((e) => {
        setAllJobs([]);
        setAllError(e instanceof Error ? e.message : 'Failed to load history');
      })
      .finally(() => setAllLoading(false));
  }, [isDesktop, character]);

  // Merge live polling data over the snapshot so active rows in the All view
  // reflect progress updates without requiring a manual refresh.
  const mergedJobs = useMemo(() => {
    const liveById = new Map(activeSnapshot.map((j) => [j.id, j]));
    const merged = allJobs.map((j) => liveById.get(j.id) ?? j);
    // Splice in any active jobs not yet in the snapshot (newly-started jobs).
    for (const live of activeSnapshot) {
      if (!merged.some((j) => j.id === live.id)) {
        merged.unshift(live);
      }
    }
    return merged;
  }, [activeSnapshot, allJobs]);

  const activeList = useMemo(
    () => activeSnapshot.filter((j) => isActiveStatus(j.status)),
    [activeSnapshot],
  );

  const refreshAll = () => {
    refreshActive();
    if (isDesktop === false && !character) return;
    setAllLoading(true);
    fetchAllJobs(
      isDesktop ? {} : { player: character!.name, realm: character!.realm },
    )
      .then((data) => setAllJobs(Array.isArray(data) ? data : []))
      .catch(() => undefined)
      .finally(() => setAllLoading(false));
  };

  const wrapAction = async (id: string, fn: () => Promise<void>, errorPrefix: string) => {
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
  };

  const handlePause = (id: string) => wrapAction(id, () => pauseSim(id), 'Failed to pause sim');
  const handleResume = (id: string) =>
    wrapAction(id, () => resumeSim(id), 'Failed to resume sim');
  const handleCancel = (id: string) => {
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
      'Failed to cancel sim',
    );
  };
  const handleDelete = (id: string) => {
    if (!window.confirm('Delete this sim from history? This cannot be undone.')) return;
    wrapAction(id, () => deleteJob(id), 'Failed to delete sim');
  };

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
          jobs={activeSnapshot}
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

/* ── Views ──────────────────────────────────────────────── */

function ActiveView({
  jobs,
  busy,
  onPause,
  onResume,
  onCancel,
}: {
  jobs: JobActiveSummary[];
  busy: string | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
}) {
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

function AllView({
  jobs,
  loading,
  isDesktop,
  character,
  busy,
  onPause,
  onResume,
  onCancel,
  onDelete,
}: {
  jobs: JobActiveSummary[];
  loading: boolean;
  isDesktop: boolean | null;
  character: { name: string; realm: string } | null;
  busy: string | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
}) {
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
        Paste a SimC export to load this character's sim history.
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

  const entries = groupByBatch(jobs);

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

function ActionableHistoryRow({
  job,
  busy,
  onPause,
  onResume,
  onCancel,
  onDelete,
}: {
  job: JobActiveSummary;
  busy: string | null;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const active = isActiveStatus(job.status);
  // For active rows in the All view we still want pause/resume/cancel, but
  // the row layout is the history one — wrap with the same affordances.
  if (active) {
    return (
      <div className="border-b border-outline-variant/5">
        <HistoryRow job={job} busy={busy === job.id} onDelete={() => undefined} />
        <div className="flex items-center justify-end gap-1 border-t border-outline-variant/5 bg-surface-container-lowest/40 px-6 py-2">
          {job.status === 'running' && job.simc_input_mode === 'streamed' && (
            <button
              disabled={busy === job.id || job.pause_requested}
              onClick={() => onPause(job.id)}
              className="rounded px-2 py-0.5 text-[11px] text-on-surface-variant/60 hover:bg-white/5 hover:text-on-surface disabled:opacity-40"
            >
              {job.pause_requested ? 'Pausing…' : 'Pause'}
            </button>
          )}
          {job.status === 'paused' && (
            <button
              disabled={busy === job.id}
              onClick={() => onResume(job.id)}
              className="rounded px-2 py-0.5 text-[11px] text-primary hover:bg-primary/10 disabled:opacity-40"
            >
              Resume
            </button>
          )}
          <button
            disabled={busy === job.id}
            onClick={() => onCancel(job.id)}
            className="rounded px-2 py-0.5 text-[11px] text-on-surface-variant/60 hover:bg-red-500/10 hover:text-error disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="border-b border-outline-variant/5">
      <HistoryRow job={job} busy={busy === job.id} onDelete={() => onDelete(job.id)} />
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
          {timeAgo(first?.created_at)}
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
