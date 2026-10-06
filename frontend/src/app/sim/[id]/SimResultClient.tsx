'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePollWhileVisible } from '../../lib/usePollWhileVisible';
import SimResultView from '../../components/results/SimResultView';
import SimStatus from '../../components/results/SimStatus';
import ShareButton from '../../components/share/ShareButton';
import Button, { buttonClass } from '../../components/ui/Button';
import ShareComparisonStrip from '../../components/share/ShareComparisonStrip';

import {
  API_URL,
  fetchSimInputPreview,
  pauseSim,
  resumeSim,
  type SimInputPreview,
} from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { useProviderCaps, useProviderMeta } from '../../lib/providers';
import {
  getScenarioSiblings,
  formatScenarioLabel,
  type ScenarioSibling,
} from '../../lib/scenario-siblings';
import { getTopGearState } from '../../lib/topgear-state';
import { EMPTY_LIVE_SIM, reduceSimcLog, type LiveSim } from '../../lib/simcLog';
import { ROUTES } from '../../lib/routes';
import { isGearComparisonResult, type SimResult } from '../../lib/simResultTypes';

interface JobData {
  id: string;
  status: 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
  progress: number;
  progress_stage?: string;
  progress_detail?: string;
  stages_completed?: string[];
  result: SimResult | null;
  error: string | null;
  simc_input_mode?: 'inline' | 'streamed';
  pause_requested?: boolean;
  provider_id: string;
  share_id?: string | null;
  rerun_of?: string | null;
}

// Consecutive status-poll failures tolerated before giving up (~2 min at 2s).
const MAX_POLL_FAILURES = 60;

export default function SimResultClient() {
  const { t } = useLanguage();
  const params = useParams();
  const paramId = params.id as string;

  // In static export, useParams() may initially return "_" (the generateStaticParams
  // placeholder) before the router reconciles with the actual URL. Fall back to the URL.
  let id = paramId;
  if ((!paramId || paramId === '_') && typeof window !== 'undefined') {
    const match = window.location.pathname.match(/\/sim\/(.+)/);
    if (match) id = match[1];
  }

  const [job, setJob] = useState<JobData | null>(null);
  const caps = useProviderCaps(job?.provider_id ?? '');
  const providerMeta = useProviderMeta(job?.provider_id ?? '');
  const [fetchError, setFetchError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const pollFailuresRef = useRef(0);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [live, setLive] = useState<LiveSim>(EMPTY_LIVE_SIM);
  const [showLogs, setShowLogs] = useState(true);
  const logCursorRef = useRef(0);
  const [siblings, setSiblings] = useState<ScenarioSibling[] | null>(null);
  const [inputPreview, setInputPreview] = useState<SimInputPreview | null>(null);
  const [inputPreviewError, setInputPreviewError] = useState('');
  const [showInputPreview, setShowInputPreview] = useState(false);
  const inputPreviewFetchedRef = useRef(false);

  useEffect(() => {
    setSiblings(getScenarioSiblings());
  }, []);

  usePollWhileVisible(
    async () => {
      try {
        const res = await fetch(`${API_URL}/api/sim/${id}`);
        if (res.status === 404) {
          setNotFound(true);
          return null;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: JobData = await res.json();
        pollFailuresRef.current = 0;
        setFetchError(''); // preserve the original per-poll error reset on success
        setJob(data);
        return data.status === 'pending' || data.status === 'running' || data.status === 'paused'
          ? 2000
          : null;
      } catch (err) {
        // Transient failures (network, 5xx) keep polling so the page recovers.
        pollFailuresRef.current += 1;
        setFetchError(err instanceof Error ? err.message : t('simResult.failedToFetchStatus'));
        return pollFailuresRef.current >= MAX_POLL_FAILURES ? null : 2000;
      }
    },
    !!id && id !== '_',
    [id]
  );

  // Poll logs while the sim is active: the live view is built from them.
  usePollWhileVisible(
    async () => {
      try {
        const res = await fetch(`${API_URL}/api/sim/${id}/logs?after=${logCursorRef.current}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.lines.length > 0) {
          setLogLines((prev) => {
            const merged = [...prev, ...data.lines];
            return merged.length > 1000 ? merged.slice(-1000) : merged;
          });
          setLive((prev) => reduceSimcLog(prev, data.lines));
          logCursorRef.current = data.next;
        }
      } catch {
        /* ignore */
      }
      return 1000;
    },
    // Local sims feed the live view; others only need logs while the console is open.
    !!id &&
      id !== '_' &&
      !notFound &&
      (job?.status === 'pending' || job?.status === 'running') &&
      (job?.provider_id === 'local' || showLogs),
    [id, job?.status, job?.provider_id, notFound, showLogs]
  );

  // Final flush: the log poll stops on terminal status, so fetch any trailing
  // lines (e.g. a sub-1s Final stage) that arrived after the last poll.
  useEffect(() => {
    if (!id || id === '_') return;
    if (job?.status !== 'done' && job?.status !== 'failed' && job?.status !== 'cancelled') return;
    const cursor = logCursorRef.current;
    fetch(`${API_URL}/api/sim/${id}/logs?after=${cursor}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !data.lines || data.lines.length === 0) return;
        setLogLines((prev) => {
          const merged = [...prev, ...data.lines];
          return merged.length > 1000 ? merged.slice(-1000) : merged;
        });
        setLive((prev) => reduceSimcLog(prev, data.lines));
        logCursorRef.current = data.next;
      })
      .catch(() => {
        /* ignore */
      });
  }, [id, job?.status]);

  const handleToggleLogs = useCallback(() => setShowLogs((v) => !v), []);

  const handlePause = useCallback(async () => {
    setJob((current) =>
      current && current.id === id ? { ...current, pause_requested: true } : current
    );
    try {
      await pauseSim(id);
    } catch (e) {
      setJob((current) =>
        current && current.id === id ? { ...current, pause_requested: false } : current
      );
      console.error('Pause failed:', e);
    }
  }, [id]);

  const handleToggleInputPreview = useCallback(() => {
    setShowInputPreview((v) => {
      const next = !v;
      if (next && !inputPreviewFetchedRef.current) {
        inputPreviewFetchedRef.current = true;
        fetchSimInputPreview(id)
          .then((data) => setInputPreview(data))
          .catch((err) =>
            setInputPreviewError(
              err instanceof Error ? err.message : t('simResult.failedToLoadInput')
            )
          );
      }
      return next;
    });
  }, [id, t]);

  if (notFound) {
    return (
      <div className="card border-warning/20 bg-warning/[0.03] p-6 text-center">
        <p className="mb-1 text-sm font-semibold text-warning">{t('simResult.notFoundTitle')}</p>
        <p className="mb-4 text-sm text-on-surface-variant/60">{t('simResult.notFoundBody')}</p>
        <Button href={ROUTES.sims}>{t('simResult.backToSims')}</Button>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="card border-negative/20 bg-negative/[0.03] p-6">
        <p className="mb-1 text-sm font-semibold text-negative">{t('common.error')}</p>
        <p className="text-sm text-negative/60">{fetchError}</p>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-surface-container-highest border-t-gold" />
      </div>
    );
  }

  if (job.status === 'cancelled') {
    return (
      <div className="card border-warning/20 bg-warning/[0.03] p-6 text-center">
        <p className="text-sm font-semibold text-warning">{t('results.simulationCancelled')}</p>
      </div>
    );
  }

  if (job.status === 'failed') {
    return (
      <div className="space-y-3">
        <div className="card border-negative/20 bg-negative/[0.03] p-6">
          <p className="mb-2 text-sm font-semibold text-negative">
            {t('results.simulationFailed')}
          </p>
          <p className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-negative/60">
            {job.error || t('results.unknownError')}
          </p>
        </div>
        <div className="flex items-center justify-center text-[11px] uppercase tracking-wider text-on-surface-variant/40">
          <a
            href={`${API_URL}/api/sim/${id}/input`}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-on-surface"
          >
            {t('results.rawInput')}
          </a>
        </div>
      </div>
    );
  }

  if (job.status === 'pending' || job.status === 'running' || job.status === 'paused') {
    const canCancel = (job.status === 'pending' || job.status === 'running') && caps.cancel;
    const canPause = job.status === 'running' && caps.pause && job.simc_input_mode === 'streamed';

    return (
      <div className="space-y-3">
        {job.status === 'paused' ? (
          <div className="flex flex-col items-center justify-center space-y-6 py-16">
            <div className="w-72 rounded-[10px] border border-warning/20 bg-warning/5 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="h-card text-warning">{t('simResult.paused')}</p>
                  {job.progress_stage && (
                    <p className="mt-0.5 text-xs text-on-surface-variant">
                      {t('simResult.atStage', { stage: job.progress_stage })}
                      {job.progress_detail ? ` · ${job.progress_detail}` : ''}
                    </p>
                  )}
                </div>
                <span className="font-headline text-xl font-extrabold text-warning">
                  {job.progress}%
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={async () => {
                  try {
                    await resumeSim(id);
                  } catch (e) {
                    console.error('Resume failed:', e);
                  }
                }}
              >
                {t('simResult.resume')}
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  try {
                    await fetch(`${API_URL}/api/sim/${id}/cancel`, { method: 'POST' });
                  } catch (e) {
                    console.error('Cancel failed:', e);
                  }
                }}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <SimStatus
            status={job.status}
            progress={job.progress}
            progressStage={job.progress_stage}
            progressDetail={job.progress_detail}
            stagesCompleted={job.stages_completed}
            jobId={id}
            onCancelled={() => setJob({ ...job, status: 'cancelled' })}
            canCancel={canCancel}
            canPause={canPause}
            pauseRequested={!!job.pause_requested}
            onPause={handlePause}
            logLines={logLines}
            showLogs={showLogs}
            onToggleLogs={handleToggleLogs}
            live={live}
            liveExpected={job.provider_id === 'local'}
          />
        )}
        <div className="flex items-center justify-center text-[11px] uppercase tracking-wider text-on-surface-variant/40">
          <a
            href={`${API_URL}/api/sim/${id}/input`}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-on-surface"
          >
            {t('results.rawInput')}
          </a>
        </div>
      </div>
    );
  }

  if (!job.result) {
    return <p className="text-sm text-outline">{t('results.noResultData')}</p>;
  }

  const r = job.result;
  const isTopGear = isGearComparisonResult(r);
  const hasTopGearState = isTopGear && getTopGearState() !== null;

  return (
    <div className="space-y-6">
      {siblings && siblings.length > 1 && (
        <div className="card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="lbl shrink-0">{t('results.scenarios')}</span>
            <span className="h-4 w-px shrink-0 bg-overlay/[0.11]" />
            {siblings.map((s) => {
              const isCurrent = s.id === id;
              return (
                <a
                  key={s.id}
                  href={`/sim/${s.id}`}
                  className={`chip ${isCurrent ? 'chip-on' : ''}`}
                >
                  {formatScenarioLabel(s)}
                </a>
              );
            })}
          </div>
        </div>
      )}

      {job.rerun_of && <ShareComparisonStrip shareId={job.rerun_of} local={r} />}

      <SimResultView
        result={r}
        sourceJobId={id}
        backLink={
          hasTopGearState ? (
            <a href={ROUTES.topGear} className={buttonClass('quiet')}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-3.5 w-3.5"
              >
                <path
                  fillRule="evenodd"
                  d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z"
                  clipRule="evenodd"
                />
              </svg>
              {t('results.backToTopGear')}
            </a>
          ) : undefined
        }
        actions={
          <ShareButton
            jobId={id}
            result={r}
            shareId={job.share_id ?? null}
            onChange={(shareId) => setJob((cur) => (cur ? { ...cur, share_id: shareId } : cur))}
          />
        }
      />

      {/* Input preview (lazy-loaded on demand) */}
      <div className="card overflow-hidden">
        <button
          onClick={handleToggleInputPreview}
          className="flex w-full items-center justify-between px-6 py-3 text-left transition-colors hover:bg-overlay/[0.015]"
        >
          <span className="lbl">SimC Input</span>
          <svg
            className={`h-3.5 w-3.5 text-outline transition-transform ${showInputPreview ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
        {showInputPreview && (
          <div className="border-t border-line/[0.06] bg-surface-container-low p-4">
            {inputPreviewError ? (
              <p className="text-[13px] text-negative/70">{inputPreviewError}</p>
            ) : !inputPreview ? (
              <p className="text-[13px] text-on-surface-variant/40">{t('common.loading')}</p>
            ) : inputPreview.mode === 'inline' ? (
              <pre className="max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-[1.7] text-on-surface-variant/60">
                {inputPreview.input}
              </pre>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="lbl mb-2">{t('simResult.baseProfile')}</p>
                  <pre className="max-h-[300px] overflow-y-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-[1.7] text-on-surface-variant/60">
                    {inputPreview.base_profile}
                  </pre>
                </div>
                <div>
                  <p className="lbl mb-2">
                    {t('simResult.profilesetsPreview', {
                      a: inputPreview.preview_profilesets.length,
                      b: inputPreview.survivor_count,
                    })}
                  </p>
                  <pre className="max-h-[300px] overflow-y-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-[1.7] text-on-surface-variant/60">
                    {inputPreview.preview_profilesets.join('\n')}
                  </pre>
                </div>
                <p className="text-[12px] text-on-surface-variant/40">{inputPreview.note}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer links */}
      <div className="flex items-center justify-center gap-3 pb-4 text-[11px] uppercase tracking-wider text-on-surface-variant/40">
        {r.simc_version && (
          <>
            {r.simc_git_revision ? (
              <a
                href={`https://github.com/simulationcraft/simc/commit/${r.simc_git_revision}`}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-on-surface"
              >
                {r.simc_version}
              </a>
            ) : (
              <span>{r.simc_version}</span>
            )}
            <span className="h-3 w-px bg-overlay/[0.11]" />
          </>
        )}
        <a
          href={`${API_URL}/api/sim/${id}/raw`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-on-surface"
        >
          {t('results.rawJson')}
        </a>
        <span className="h-3 w-px bg-overlay/[0.11]" />
        <a
          href={`${API_URL}/api/sim/${id}/input`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-on-surface"
        >
          {t('results.rawInput')}
        </a>
        <span className="h-3 w-px bg-overlay/[0.11]" />
        <a
          href={`${API_URL}/api/sim/${id}/data.csv`}
          className="transition-colors hover:text-on-surface"
        >
          {t('results.csv')}
        </a>
        <span className="h-3 w-px bg-overlay/[0.11]" />
        <a
          href={`${API_URL}/api/sim/${id}/html`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-on-surface"
        >
          {t('results.htmlReport')}
        </a>
        <span className="h-3 w-px bg-overlay/[0.11]" />
        <a
          href={`${API_URL}/api/sim/${id}/output.txt`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-on-surface"
        >
          {t('results.textOutput')}
        </a>
      </div>

      {/* Provider footer (non-local jobs only) */}
      {job.provider_id !== 'local' && (
        <div className="mt-4 text-center text-[11px] uppercase tracking-wider text-on-surface-variant/50">
          {(() => {
            const sim = job.result?.simmit;
            const credits = sim?.credits_consumed;
            const commit = sim?.build_commit;
            return (
              <>
                {t('simResult.ranOn', {
                  provider: providerMeta?.display_name ?? job.provider_id,
                })}
                {credits != null &&
                  ` · ${t('simResult.credits', { n: Number(credits).toLocaleString() })}`}
                {commit && ` · ${t('simResult.build', { commit: String(commit).slice(0, 7) })}`}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
