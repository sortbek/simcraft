'use client';

import { useEffect, useState } from 'react';
import SimResultView from '../components/results/SimResultView';
import RerunPanel from '../components/share/RerunPanel';
import ShareErrorBoundary from '../components/share/ShareErrorBoundary';
import { VIEWER_BUILD } from '../lib/featureFlags';
import { useLanguage } from '../lib/i18n';
import { fetchShare, ShareNotFoundError, type FetchedShare } from '../lib/share/api';
import { checkPayloadVersion, checkResultShape } from '../lib/share/rerun';
import { parseShareInput } from '../lib/share/link';
import { primeShareLookups } from '../lib/share/lookups';

type State =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'too_new' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; id: string; share: FetchedShare };

export default function SharedResultClient() {
  const { t } = useLanguage();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!VIEWER_BUILD) return;
    const target = document.documentElement;
    let raf = 0;
    const post = () => {
      raf = 0;
      window.parent.postMessage(
        { type: 'simhammer-viewer-height', height: target.scrollHeight },
        window.location.origin
      );
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(post);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(target);
    schedule();
    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    const id = parseShareInput(new URLSearchParams(window.location.search).get('id') ?? '');
    if (!id) {
      setState({ kind: 'not_found' });
      return;
    }
    fetchShare(id)
      .then((share) => {
        if (checkPayloadVersion(share.payload) === 'too_new') return setState({ kind: 'too_new' });
        const bad = checkResultShape(share.payload.result);
        if (VIEWER_BUILD) primeShareLookups(share.payload.lookups ?? {});
        setState(bad ? { kind: 'error', message: bad } : { kind: 'ok', id, share });
      })
      .catch((e) =>
        setState(
          e instanceof ShareNotFoundError
            ? { kind: 'not_found' }
            : { kind: 'error', message: e instanceof Error ? e.message : String(e) }
        )
      );
  }, []);

  if (state.kind === 'loading')
    return (
      <div className="flex justify-center py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-surface-container-highest border-t-gold" />
      </div>
    );
  if (state.kind !== 'ok') {
    const msg =
      state.kind === 'not_found'
        ? t('shared.notFound')
        : state.kind === 'too_new'
          ? t('shared.tooNew')
          : t('shared.loadFailed', { reason: state.message });
    return (
      <div className="card border-warning/20 bg-warning/[0.03] p-6 text-center">
        <p className="text-sm font-semibold text-warning">{msg}</p>
      </div>
    );
  }

  const { meta, payload } = state.share;
  const date = new Date(meta.simmedAt).toLocaleDateString();
  return (
    <div className="space-y-6">
      {!VIEWER_BUILD && (
        <div className="card p-4">
          <p className="lbl text-gold">{t('shared.title')}</p>
          <p className="mt-2 text-[13px] text-on-surface-variant">
            {t('shared.provenance', {
              appVersion: meta.appVersion,
              simc: meta.simcBuild ?? 'SimC',
              date,
            })}
          </p>
        </div>
      )}
      {!VIEWER_BUILD && <RerunPanel shareId={state.id} payload={payload} />}
      <ShareErrorBoundary
        fallback={
          <div className="card border-warning/20 bg-warning/[0.03] p-6 text-center">
            <p className="text-sm font-semibold text-warning">
              {t('shared.loadFailed', { reason: 'malformed result' })}
            </p>
          </div>
        }
      >
        <SimResultView result={payload.result} />
      </ShareErrorBoundary>
    </div>
  );
}
