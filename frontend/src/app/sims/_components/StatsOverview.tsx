import { useMemo } from 'react';
import type { JobOverviewSummary } from '../../lib/api';
import { formatDps } from '../../lib/format';

interface Stats {
  totalSims: number;
  completedSims: number;
  completionRate: number;
  bestDps: number;
  uniqueCharacters: number;
}

function computeStats(sims: JobOverviewSummary[]): Stats {
  const totalSims = sims.length;
  let completed = 0;
  let bestDps = 0;
  const characters = new Set<string>();
  for (const s of sims) {
    if (s.status === 'done') {
      completed += 1;
      if (s.dps && s.dps > bestDps) bestDps = s.dps;
    }
    if (s.player_name) characters.add(`${s.player_name}-${s.realm ?? ''}`);
  }
  return {
    totalSims,
    completedSims: completed,
    completionRate: totalSims > 0 ? (completed / totalSims) * 100 : 0,
    bestDps,
    uniqueCharacters: characters.size,
  };
}

export function StatsOverview({ sims }: { sims: JobOverviewSummary[] }) {
  const stats = useMemo(() => computeStats(sims), [sims]);
  return (
    <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
        <p className="mb-1 font-headline text-[11px] uppercase tracking-widest text-on-surface-variant">
          Total sims
        </p>
        <p className="font-headline text-3xl font-black text-primary">
          {stats.totalSims.toLocaleString()}
        </p>
        <p className="mt-2 text-[10px] text-outline">
          {stats.completedSims} completed · {stats.completionRate.toFixed(0)}%
        </p>
      </div>
      <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
        <p className="mb-1 font-headline text-[11px] uppercase tracking-widest text-on-surface-variant">
          Characters
        </p>
        <p className="font-headline text-3xl font-black text-tertiary">{stats.uniqueCharacters}</p>
        <p className="mt-2 text-[10px] text-outline">unique character / realm pairs</p>
      </div>
      <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
        <p className="mb-1 font-headline text-[11px] uppercase tracking-widest text-on-surface-variant">
          Best DPS
        </p>
        <p className="font-headline text-3xl font-black text-on-surface">
          {stats.bestDps > 0 ? formatDps(stats.bestDps) : '—'}
        </p>
        <p className="mt-2 text-[10px] text-outline">highest completed result</p>
      </div>
    </div>
  );
}
