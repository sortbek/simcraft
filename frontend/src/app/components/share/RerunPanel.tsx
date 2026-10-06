'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, fetchJson } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import type { SharePayload } from '../../lib/share/api';
import { buildRerunRequest } from '../../lib/share/rerun';
import { useEditShared } from '../../lib/share/useEditShared';
import { getSimTypeLabel } from '../../lib/simTypes';
import Button from '../ui/Button';

function formatDuration(seconds: number | undefined): string {
  if (!seconds) return '?';
  return seconds < 90 ? `${Math.round(seconds)}s` : `${Math.round(seconds / 60)} min`;
}

export default function RerunPanel({
  shareId,
  payload,
}: {
  shareId: string;
  payload: SharePayload;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { edit } = useEditShared();
  const req = buildRerunRequest(payload, shareId);

  if ('error' in req) {
    return (
      <p className="text-center text-[13px] text-on-surface-variant">
        {req.error === 'incompatible' ? t('shared.incompatible') : t('shared.notRerunnable')}
      </p>
    );
  }

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetchJson<{ id: string }>(`${API_URL}${req.endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      router.push(`/sim/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const openInEditor = async () => {
    setBusy(true);
    setError('');
    try {
      await edit(payload, shareId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const r = payload.result;
  return (
    <div className="flex flex-col items-center gap-2">
      {confirming ? (
        <div className="card max-w-md p-4 text-center">
          <p className="mb-3 text-sm">
            {t('shared.rerunConfirm', {
              mode: getSimTypeLabel(payload.mode, t),
              character: r.player_name,
              duration: formatDuration(r.total_elapsed_seconds ?? r.elapsed_time_seconds),
            })}
          </p>
          <div className="flex justify-center gap-2">
            <Button disabled={busy} onClick={start}>
              {t('shared.rerunStart')}
            </Button>
            <Button variant="text" disabled={busy} onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => setConfirming(true)}>{t('shared.rerun')}</Button>
          <Button variant="quiet" disabled={busy} onClick={openInEditor}>
            {t('shared.edit', {
              page: getSimTypeLabel(payload.mode === 'stat_weights' ? 'quick' : payload.mode, t),
            })}
          </Button>
        </div>
      )}
      {error && <p className="text-[13px] text-negative">{error}</p>}
    </div>
  );
}
