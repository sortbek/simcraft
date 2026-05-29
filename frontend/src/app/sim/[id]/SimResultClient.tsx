'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import DpsHeroCard from '../../components/results/DpsHeroCard';
import GearOverview from '../../components/gear/GearOverview';
import type { GearItem } from '../../components/gear/GearOverview';
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
import {
  getScenarioSiblings,
  formatScenarioLabel,
  type ScenarioSibling,
} from '../../lib/scenario-siblings';
import { getTopGearState } from '../../lib/topgear-state';
import { ROUTES } from '../../lib/routes';

interface JobData {
  id: string;
  status: 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
  progress: number;
  progress_stage?: string;
  progress_detail?: string;
  stages_completed?: string[];
  result: Record<string, unknown> | null;
  error: string | null;
  simc_input_mode?: 'inline' | 'streamed';
  pause_requested?: boolean;
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
  const [fetchError, setFetchError] = useState('');
  const [logLines, setLogLines] = useState<string[]>([]);
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

  useEffect(() => {
    if (!id || id === '_') return;
    setFetchError('');
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch(`${API_URL}/api/sim/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: JobData = await res.json();
        if (active) setJob(data);
        if (
          active &&
          (data.status === 'pending' || data.status === 'running' || data.status === 'paused')
        ) {
          timer = setTimeout(poll, 2000);
        }
      } catch (err) {
        if (active) setFetchError(err instanceof Error ? err.message : 'Failed to fetch status');
      }
    }
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id]);

  // Poll logs only when the log console is expanded and the sim is active
  useEffect(() => {
    if (!showLogs || !id || id === '_') return;
    if (job?.status !== 'pending' && job?.status !== 'running') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function pollLogs() {
      try {
        const res = await fetch(`${API_URL}/api/sim/${id}/logs?after=${logCursorRef.current}`);
        if (!res.ok || !active) return;
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
      if (active) timer = setTimeout(pollLogs, 1000);
    }
    pollLogs();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [showLogs, id, job?.status]);

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
            canPause={job.status === 'running' && job.simc_input_mode === 'streamed'}
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
  const isTopGear = r.type === 'top_gear' || r.type === 'enchant_gem';
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

      {isTopGear ? (
        <>
          <TopGearResults
            playerName={r.player_name as string}
            playerClass={r.player_class as string}
            playerRealm={r.realm as string | undefined}
            playerRegion={r.region as string | undefined}
            baseDps={r.base_dps as number}
            results={
              r.results as Array<{
                name: string;
                items: Array<{
                  slot: string;
                  item_id: number;
                  ilevel: number;
                  name: string;
                  bonus_ids?: number[];
                  enchant_id?: number;
                  gem_id?: number;
                  is_kept?: boolean;
                  encounter?: string;
                }>;
                dps: number;
                delta: number;
              }>
            }
            equippedGear={
              r.equipped_gear as Record<
                string,
                {
                  slot: string;
                  item_id: number;
                  ilevel: number;
                  name: string;
                  bonus_ids?: number[];
                  enchant_id?: number;
                  gem_id?: number;
                }
              >
            }
            dpsError={r.dps_error as number | undefined}
            dpsErrorPct={r.dps_error_pct as number | undefined}
            fightLength={r.fight_length as number | undefined}
            desiredTargets={r.desired_targets as number | undefined}
            iterations={r.iterations as number | undefined}
            targetError={r.target_error as number | undefined}
            elapsedTime={(r.total_elapsed_seconds ?? r.elapsed_time_seconds) as number | undefined}
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
          {typeof r.talent_string === 'string' && r.talent_string && (
            <TalentTree talentString={r.talent_string as string} />
          )}
        </>
      ) : (
        <>
          <DpsHeroCard
            playerName={r.player_name as string}
            playerClass={r.player_class as string}
            playerRealm={r.realm as string | undefined}
            playerRegion={r.region as string | undefined}
            dps={r.dps as number}
            dpsError={r.dps_error as number}
            dpsErrorPct={r.dps_error_pct as number | undefined}
            fightLength={r.fight_length as number}
            desiredTargets={r.desired_targets as number | undefined}
            iterations={r.iterations as number | undefined}
            targetError={r.target_error as number | undefined}
            elapsedTime={(r.total_elapsed_seconds ?? r.elapsed_time_seconds) as number | undefined}
            baseDps={r.base_dps as number | undefined}
          />
          {r.equipped_gear && Object.keys(r.equipped_gear as Record<string, unknown>).length > 0 ? (
            <GearOverview
              gear={r.equipped_gear as Record<string, GearItem>}
              characterRenderUrl={
                r.realm && r.player_name
                  ? `https://simhammer.com/api/blizzard/character/${(r.region as string) || 'eu'}/${encodeURIComponent((r.realm as string).toLowerCase())}/${encodeURIComponent((r.player_name as string).toLowerCase())}/media/render`
                  : null
              }
            />
          ) : null}
          {r.stat_weights ? (
            <StatWeightsTable statWeights={r.stat_weights as Record<string, number>} />
          ) : null}
          {typeof r.talent_string === 'string' && r.talent_string && (
            <TalentTree talentString={r.talent_string as string} />
          )}
          <ResultsChart
            dps={r.dps as number}
            abilities={
              (r.abilities as Array<{
                name: string;
                portion_dps: number;
                school: string;
              }>) || []
            }
          />
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
        {typeof r.simc_version === 'string' && (
          <>
            {typeof r.simc_git_revision === 'string' && r.simc_git_revision ? (
              <a
                href={`https://github.com/simulationcraft/simc/commit/${r.simc_git_revision}`}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-white"
              >
                {r.simc_version as string}
              </a>
            ) : (
              <span>{r.simc_version as string}</span>
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
    </div>
  );
}
