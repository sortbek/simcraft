'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { fetchShare, type FetchedShare } from '../../lib/share/api';
import { compareShared } from '../../lib/share/compare';
import { simcBuildOf } from '../../lib/share/summary';
import type { SimResult } from '../../lib/simResultTypes';
import CardHeader from '../ui/CardHeader';

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

export default function ShareComparisonStrip({
  shareId,
  local,
}: {
  shareId: string;
  local: SimResult;
}) {
  const { t } = useLanguage();
  const [share, setShare] = useState<FetchedShare | null | 'gone'>(null);

  useEffect(() => {
    let live = true;
    fetchShare(shareId)
      .then((got) => live && setShare(got))
      .catch(() => live && setShare('gone'));
    return () => {
      live = false;
    };
  }, [shareId]);

  if (share === null) return null;
  const c = share === 'gone' ? null : compareShared(share.payload.result, local);
  if (share === 'gone' || !c)
    return (
      <p className="text-center text-[13px] text-on-surface-variant">{t('compare.unavailable')}</p>
    );

  const localBuild = simcBuildOf(local);
  return (
    <div className="card">
      <CardHeader title={t('compare.title')} />
      {c.kind === 'single' ? (
        <p className={`px-6 py-4 text-sm ${c.flagged ? 'text-warning' : 'text-on-surface'}`}>
          {t('compare.shared')}: {Math.round(c.sharedDps).toLocaleString()} · {t('compare.local')}:{' '}
          {Math.round(c.localDps).toLocaleString()} ({pct(c.deltaPct)})
          {c.flagged && ` — ${t('compare.flagged')}`}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="h-11 border-b border-line/[0.06] px-6" />
              <th className="lbl h-11 border-b border-line/[0.06] px-6">{t('compare.shared')}</th>
              <th className="lbl h-11 border-b border-line/[0.06] px-6">{t('compare.local')}</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((row, i) => (
              <tr
                key={i}
                className={`border-b border-line/[0.06] last:border-b-0 hover:bg-overlay/[0.015] ${
                  row.flagged ? 'text-warning' : 'text-on-surface'
                }`}
                title={row.flagged ? t('compare.flagged') : undefined}
              >
                <td className="h-[62px] px-6">
                  {row.label}
                  {row.flagged && (
                    <span className="ml-2 text-xs font-semibold">
                      · {t('compare.flaggedShort')}
                    </span>
                  )}
                </td>
                <td className="h-[62px] px-6 tabular-nums">{pct(row.sharedGainPct)}</td>
                <td className="h-[62px] px-6 tabular-nums">
                  {row.localGainPct === null ? t('compare.missing') : pct(row.localGainPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {share.meta.simcBuild && localBuild && share.meta.simcBuild !== localBuild && (
        <p className="border-t border-line/[0.06] px-6 py-3 text-[12px] text-on-surface-variant/60">
          {t('compare.simcDiffers')}
        </p>
      )}
    </div>
  );
}
