'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { API_URL } from '../lib/api';
import { pauseSim, resumeSim, type JobActiveSummary } from '../lib/api';
import { useActiveSims } from '../lib/useActiveSims';

const SIM_TYPE_LABELS: Record<string, string> = {
  quick: 'Quick Sim',
  stat_weights: 'Quick Sim',
  top_gear: 'Top Gear',
  droptimizer: 'Drop Finder',
  enchant_gem: 'Enchant/Gem',
  upgrade_compare: 'Crest Upgrades',
};

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatusDot({ status }: { status: JobActiveSummary['status'] }) {
  const color =
    status === 'running'
      ? 'bg-amber-500 animate-pulse'
      : status === 'paused'
        ? 'bg-sky-400'
        : status === 'done'
          ? 'bg-emerald-500'
          : status === 'failed'
            ? 'bg-red-500'
            : 'bg-on-surface-variant/40';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

type Filter = 'active' | 'all';

export default function SimsPage() {
  const router = useRouter();
  const { jobs, error, refresh } = useActiveSims();
  const [filter, setFilter] = useState<Filter>('active');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = jobs.filter((j) =>
    filter === 'all' ? true : ['pending', 'running', 'paused'].includes(j.status)
  );

  const handlePause = async (id: string) => {
    setBusy(id);
    setActionError(null);
    try {
      await pauseSim(id);
      refresh();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to pause sim');
    } finally {
      setBusy(null);
    }
  };

  const handleResume = async (id: string) => {
    setBusy(id);
    setActionError(null);
    try {
      await resumeSim(id);
      refresh();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to resume sim');
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async (id: string) => {
    if (!window.confirm('Cancel this sim? This cannot be undone.')) return;
    setBusy(id);
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/api/sim/${id}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || `Cancel failed (${res.status})`);
      }
      refresh();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to cancel sim');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="mb-2 font-headline text-4xl font-black uppercase tracking-tighter text-on-surface">
            Sims
          </h1>
          <p className="max-w-2xl text-sm text-on-surface-variant">
            Active sims and recent runs. Click any row to open results.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-outline-variant/10 bg-surface-container-low p-1">
          <button
            onClick={() => setFilter('active')}
            className={`rounded-md px-3 py-1 text-[12px] font-medium uppercase tracking-wider transition-colors ${
              filter === 'active'
                ? 'bg-primary-container/20 text-primary'
                : 'text-on-surface-variant/60 hover:text-on-surface'
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`rounded-md px-3 py-1 text-[12px] font-medium uppercase tracking-wider transition-colors ${
              filter === 'all'
                ? 'bg-primary-container/20 text-primary'
                : 'text-on-surface-variant/60 hover:text-on-surface'
            }`}
          >
            All
          </button>
        </div>
      </div>

      {(error || actionError) && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-[13px] text-red-400">
          {actionError ?? error}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-12 text-center text-on-surface-variant/60">
          {filter === 'active' ? 'No active sims.' : 'No sims yet.'}
        </div>
      ) : (
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
              {filtered.map((j) => (
                <tr
                  key={j.id}
                  onClick={() => router.push(`/sim/${j.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') router.push(`/sim/${j.id}`);
                  }}
                  tabIndex={0}
                  className="cursor-pointer border-b border-outline-variant/5 transition-colors hover:bg-surface-container-high/50 focus:bg-surface-container-high/30 focus:outline-none"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusDot status={j.status} />
                      <span className="text-[13px] capitalize text-on-surface">{j.status}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-on-surface-variant">
                    {SIM_TYPE_LABELS[j.sim_type] ?? j.sim_type}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-on-surface">
                    {j.player_name ?? '—'}
                    {j.player_class && (
                      <span className="ml-1.5 text-on-surface-variant/60">
                        ({j.player_class})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-on-surface-variant">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-20 overflow-hidden rounded-full bg-surface-container-highest">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${j.progress_pct}%` }}
                        />
                      </div>
                      <span className="font-mono text-[12px] tabular-nums">{j.progress_pct}%</span>
                      {j.progress_stage && (
                        <span className="ml-1 text-on-surface-variant/60">· {j.progress_stage}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-on-surface-variant/60">
                    {timeAgo(j.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {j.status === 'running' && j.simc_input_mode === 'streamed' && (
                        <button
                          disabled={busy === j.id || j.pause_requested}
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePause(j.id);
                          }}
                          className="rounded px-2 py-1 text-[12px] text-on-surface-variant/60 hover:bg-white/5 hover:text-on-surface disabled:opacity-40"
                        >
                          {j.pause_requested ? 'Pausing…' : 'Pause'}
                        </button>
                      )}
                      {j.status === 'paused' && (
                        <button
                          disabled={busy === j.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleResume(j.id);
                          }}
                          className="rounded px-2 py-1 text-[12px] text-primary hover:bg-primary/10 disabled:opacity-40"
                        >
                          Resume
                        </button>
                      )}
                      {['pending', 'running', 'paused'].includes(j.status) && (
                        <button
                          disabled={busy === j.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancel(j.id);
                          }}
                          className="rounded px-2 py-1 text-[12px] text-on-surface-variant/60 hover:bg-red-500/10 hover:text-error disabled:opacity-40"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
