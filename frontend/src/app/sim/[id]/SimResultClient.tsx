'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePollWhileVisible } from '../../lib/usePollWhileVisible';
import DpsHeroCard from '../../components/results/DpsHeroCard';
import GearOverview from '../../components/gear/GearOverview';
import ResultsChart from '../../components/results/ResultsChart';
import SimStatus from '../../components/results/SimStatus';
import StatWeightsTable from '../../components/results/StatWeightsTable';
import TalentTree from '../../components/talents/TalentTree';
import TopGearResults from '../../components/gear/TopGearResults';

import {
  API_URL,
  fetchSimInputPreview,
  pauseSim,
  resumeSim,
  type SimInputPreview,
} from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { useEnchantInfo, useGemInfo, useItemInfo } from '../../lib/useItemInfo';
import { useProviderCaps, useProviderMeta } from '../../lib/providers';
import {
  getScenarioSiblings,
  formatScenarioLabel,
  type ScenarioSibling,
} from '../../lib/scenario-siblings';
import { getTopGearState } from '../../lib/topgear-state';
import { ROUTES } from '../../lib/routes';
import { isGearComparisonResult, type SimResult } from '../../lib/simResultTypes';
import {
  collectEnchantIds,
  collectGemIds,
  collectItemQueries,
} from '../../components/gear/gearOverviewUtils';

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
}

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
  const [logLines, setLogLines] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(true);
  const logCursorRef = useRef(0);
  const [siblings, setSiblings] = useState<ScenarioSibling[] | null>(null);
  const [inputPreview, setInputPreview] = useState<SimInputPreview | null>(null);
  const [inputPreviewError, setInputPreviewError] = useState('');
  const [showInputPreview, setShowInputPreview] = useState(false);
  const inputPreviewFetchedRef = useRef(false);

  // Info maps for the non-TopGear GearOverview. Hooks must be unconditional,
  // so we derive safe empty inputs when the result is absent or is a TopGear result.
  const nonTgGear = useMemo(
    () =>
      job?.result && !isGearComparisonResult(job.result) ? (job.result.equipped_gear ?? {}) : {},
    [job?.result]
  );
  const goItemQueries = useMemo(() => collectItemQueries(nonTgGear), [nonTgGear]);
  const goEnchantIds = useMemo(() => collectEnchantIds(nonTgGear), [nonTgGear]);
  const goGemIds = useMemo(() => collectGemIds(nonTgGear), [nonTgGear]);
  const goItemInfo = useItemInfo(goItemQueries);
  const goEnchantInfo = useEnchantInfo(goEnchantIds);
  const goGemInfo = useGemInfo(goGemIds);

  useEffect(() => {
    setSiblings(getScenarioSiblings());
  }, []);

  usePollWhileVisible(
    async () => {
      try {
        const res = await fetch(`${API_URL}/api/sim/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: JobData = await res.json();
        setFetchError(''); // preserve the original per-poll error reset on success
        setJob(data);
        return data.status === 'pending' || data.status === 'running' || data.status === 'paused'
          ? 2000
          : null;
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : 'Failed to fetch status');
        return null;
      }
    },
    !!id && id !== '_',
    [id]
  );

  // Poll logs only when the log console is expanded and the sim is active
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
          logCursorRef.current = data.next;
        }
      } catch {
        /* ignore */
      }
      return 1000;
    },
    showLogs && !!id && id !== '_' && (job?.status === 'pending' || job?.status === 'running'),
    [showLogs, id, job?.status]
  );

  // Final flush: when the job transitions to a terminal state, fetch any
  // log lines that arrived between the last successful poll and the status
  // change. The polling effect above stops on terminal status, so without
  // this the trailing output (e.g. a Final stage that ran in under 1s) is
  // lost from the UI even though it's still in the backend ring buffer.
  useEffect(() => {
    if (!showLogs || !id || id === '_') return;
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
        logCursorRef.current = data.next;
      })
      .catch(() => {
        /* ignore */
      });
  }, [showLogs, id, job?.status]);

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
            setInputPreviewError(err instanceof Error ? err.message : 'Failed to load input')
          );
      }
      return next;
    });
  }, [id]);

  if (fetchError) {
    return (
      <div className="card border-red-500/20 bg-red-500/[0.03] p-6">
        <p className="mb-1 text-sm font-semibold text-red-400">{t('common.error')}</p>
        <p className="text-sm text-red-400/60">{fetchError}</p>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-800 border-t-gold" />
      </div>
    );
  }

  if (job.status === 'cancelled') {
    return (
      <div className="card border-amber-500/20 bg-amber-500/[0.03] p-6 text-center">
        <p className="text-sm font-semibold text-amber-400">{t('results.simulationCancelled')}</p>
      </div>
    );
  }

  if (job.status === 'failed') {
    return (
      <div className="space-y-3">
        <div className="card border-red-500/20 bg-red-500/[0.03] p-6">
          <p className="mb-2 text-sm font-semibold text-red-400">{t('results.simulationFailed')}</p>
          <p className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-red-400/60">
            {job.error || t('results.unknownError')}
          </p>
        </div>
        <div className="flex items-center justify-center text-[10px] uppercase tracking-wider text-on-surface-variant/40">
          <a
            href={`${API_URL}/api/sim/${id}/input`}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-white"
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
            <div className="w-72 rounded-xl border border-amber-500/20 bg-amber-500/5 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold uppercase tracking-wider text-amber-400">
                    Paused
                  </p>
                  {job.progress_stage && (
                    <p className="mt-0.5 text-xs text-on-surface-variant">
                      at {job.progress_stage}
                      {job.progress_detail ? ` · ${job.progress_detail}` : ''}
                    </p>
                  )}
                </div>
                <span className="text-xl font-black text-amber-400">{job.progress}%</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  try {
                    await resumeSim(id);
                  } catch (e) {
                    console.error('Resume failed:', e);
                  }
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-bold text-primary transition-colors hover:border-primary/50 hover:bg-primary/20"
              >
                Resume
              </button>
              <button
                onClick={async () => {
                  try {
                    await fetch(`${API_URL}/api/sim/${id}/cancel`, { method: 'POST' });
                  } catch (e) {
                    console.error('Cancel failed:', e);
                  }
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-400 transition-colors hover:border-red-500/50 hover:bg-red-500/20"
              >
                Cancel
              </button>
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
          />
        )}
        <div className="flex items-center justify-center text-[10px] uppercase tracking-wider text-on-surface-variant/40">
          <a
            href={`${API_URL}/api/sim/${id}/input`}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-white"
          >
            {t('results.rawInput')}
          </a>
        </div>
      </div>
    );
  }

  if (!job.result) {
    return <p className="text-sm text-muted">{t('results.noResultData')}</p>;
  }

  const r = job.result;
  const isTopGear = isGearComparisonResult(r);
  const hasTopGearState = isTopGear && getTopGearState() !== null;

  return (
    <div className="space-y-6">
      {siblings && siblings.length > 1 && (
        <div className="card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 text-[13px] uppercase tracking-wider text-muted">
              {t('results.scenarios')}
            </span>
            <span className="h-4 w-px shrink-0 bg-border" />
            {siblings.map((s) => {
              const isCurrent = s.id === id;
              return (
                <a
                  key={s.id}
                  href={`/sim/${s.id}`}
                  className={`rounded-lg border px-2.5 py-1 text-[14px] font-medium transition-all ${
                    isCurrent
                      ? 'border-gold/40 bg-gold/[0.08] text-gold'
                      : 'bg-surface-2 border-border text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                  }`}
                >
                  {formatScenarioLabel(s)}
                </a>
              );
            })}
          </div>
        </div>
      )}

      {isGearComparisonResult(r) ? (
        <>
          <TopGearResults
            playerName={r.player_name}
            playerClass={r.player_class}
            playerRealm={r.realm}
            playerRegion={r.region}
            baseDps={r.base_dps}
            results={r.results}
            equippedGear={r.equipped_gear}
            fightLength={r.fight_length}
            desiredTargets={r.desired_targets}
            iterations={r.iterations}
            targetError={r.target_error}
            elapsedTime={r.total_elapsed_seconds ?? r.elapsed_time_seconds}
            sourceJobId={typeof id === 'string' ? id : undefined}
            sourceIsStreamed={job?.simc_input_mode === 'streamed'}
            backLink={
              hasTopGearState ? (
                <a
                  href={ROUTES.topGear}
                  className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-bold text-primary transition-colors hover:border-primary/50 hover:bg-primary/20"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-4 w-4"
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
          />
          {r.talent_string && <TalentTree talentString={r.talent_string} />}
        </>
      ) : (
        <>
          <DpsHeroCard
            playerName={r.player_name}
            playerClass={r.player_class}
            playerRealm={r.realm}
            playerRegion={r.region}
            dps={r.dps}
            fightLength={r.fight_length}
            desiredTargets={r.desired_targets}
            iterations={r.iterations}
            targetError={r.target_error}
            elapsedTime={r.total_elapsed_seconds ?? r.elapsed_time_seconds}
            baseDps={r.base_dps}
          />
          {r.equipped_gear && Object.keys(r.equipped_gear).length > 0 ? (
            <GearOverview
              gear={r.equipped_gear}
              characterRenderUrl={
                r.realm && r.player_name
                  ? `https://simhammer.com/api/blizzard/character/${r.region || 'eu'}/${encodeURIComponent(r.realm.toLowerCase())}/${encodeURIComponent(r.player_name.toLowerCase())}/media/render`
                  : null
              }
              itemInfoMap={goItemInfo}
              enchantInfoMap={goEnchantInfo}
              gemInfoMap={goGemInfo}
            />
          ) : null}
          {r.stat_weights ? <StatWeightsTable statWeights={r.stat_weights} /> : null}
          {r.talent_string && <TalentTree talentString={r.talent_string} />}
          <ResultsChart dps={r.dps} abilities={r.abilities ?? []} />
        </>
      )}

      {/* Input preview (lazy-loaded on demand) */}
      <div className="overflow-hidden rounded-xl border border-outline-variant/10">
        <button
          onClick={handleToggleInputPreview}
          className="flex w-full items-center justify-between bg-surface-container-high px-4 py-2 text-left transition-colors hover:bg-surface-container-highest"
        >
          <span className="text-[12px] font-medium uppercase tracking-wider text-on-surface-variant/60">
            SimC Input
          </span>
          <svg
            className={`h-3.5 w-3.5 text-on-surface-variant/40 transition-transform ${showInputPreview ? 'rotate-180' : ''}`}
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
          <div className="bg-surface-container-low p-4">
            {inputPreviewError ? (
              <p className="text-[13px] text-red-400/70">{inputPreviewError}</p>
            ) : !inputPreview ? (
              <p className="text-[13px] text-on-surface-variant/40">Loading…</p>
            ) : inputPreview.mode === 'inline' ? (
              <pre className="max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-[1.7] text-on-surface-variant/60">
                {inputPreview.input}
              </pre>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-on-surface-variant/40">
                    Base Profile
                  </p>
                  <pre className="max-h-[300px] overflow-y-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-[1.7] text-on-surface-variant/60">
                    {inputPreview.base_profile}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-on-surface-variant/40">
                    Profilesets (preview of {inputPreview.preview_profilesets.length} of{' '}
                    {inputPreview.survivor_count})
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
      <div className="flex items-center justify-center gap-3 pb-4 text-[10px] uppercase tracking-wider text-on-surface-variant/40">
        {r.simc_version && (
          <>
            {r.simc_git_revision ? (
              <a
                href={`https://github.com/simulationcraft/simc/commit/${r.simc_git_revision}`}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-white"
              >
                {r.simc_version}
              </a>
            ) : (
              <span>{r.simc_version}</span>
            )}
            <span className="h-3 w-px bg-border" />
          </>
        )}
        <a
          href={`${API_URL}/api/sim/${id}/raw`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-white"
        >
          {t('results.rawJson')}
        </a>
        <span className="h-3 w-px bg-border" />
        <a
          href={`${API_URL}/api/sim/${id}/input`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-white"
        >
          {t('results.rawInput')}
        </a>
        <span className="h-3 w-px bg-border" />
        <a
          href={`${API_URL}/api/sim/${id}/data.csv`}
          className="transition-colors hover:text-white"
        >
          {t('results.csv')}
        </a>
        <span className="h-3 w-px bg-border" />
        <a
          href={`${API_URL}/api/sim/${id}/html`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-white"
        >
          {t('results.htmlReport')}
        </a>
        <span className="h-3 w-px bg-border" />
        <a
          href={`${API_URL}/api/sim/${id}/output.txt`}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-white"
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
                Ran on {providerMeta?.display_name ?? job.provider_id}
                {credits != null && ` · ${Number(credits).toLocaleString()} credits`}
                {commit && ` · build ${String(commit).slice(0, 7)}`}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
