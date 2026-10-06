import { useMemo } from 'react';
import type { JobOverviewSummary } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
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
  const { t } = useLanguage();
  const stats = useMemo(() => computeStats(sims), [sims]);
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
      <section className="card px-6 py-5">
        <span className="lbl">{t('sims.statTotalSims')}</span>
        <b className="mb-1 mt-2.5 block font-headline text-[30px] font-extrabold tracking-[-0.02em] text-on-surface">
          {stats.totalSims.toLocaleString()}
        </b>
        <span className="text-[12.5px] text-outline">
          {t('sims.statCompleted', {
            count: stats.completedSims,
            pct: stats.completionRate.toFixed(0),
          })}
        </span>
      </section>
      <section className="card px-6 py-5">
        <span className="lbl">{t('sims.statCharacters')}</span>
        <b className="mb-1 mt-2.5 block font-headline text-[30px] font-extrabold tracking-[-0.02em] text-on-surface">
          {stats.uniqueCharacters}
        </b>
        <span className="text-[12.5px] text-outline">{t('sims.statCharactersSub')}</span>
      </section>
      <section className="card px-6 py-5">
        <span className="lbl">{t('sims.statBestDps')}</span>
        <b className="mb-1 mt-2.5 block font-headline text-[30px] font-extrabold tracking-[-0.02em] text-gold">
          {stats.bestDps > 0 ? formatDps(stats.bestDps) : '—'}
        </b>
        <span className="text-[12.5px] text-outline">{t('sims.statBestDpsSub')}</span>
      </section>
    </div>
  );
}
