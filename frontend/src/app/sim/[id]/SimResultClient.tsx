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

import { API_URL } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import {
  getScenarioSiblings,
  formatScenarioLabel,
  type ScenarioSibling,
} from '../../lib/scenario-siblings';

interface JobData {
  id: string;
  status: string;
  progress: number;
  progress_stage?: string;
  progress_detail?: string;
  stages_completed?: string[];
  result: Record<string, unknown> | null;
  error: string | null;
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
        if (active && (data.status === 'pending' || data.status === 'running')) {
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

  const handleToggleLogs = useCallback(() => setShowLogs((v) => !v), []);

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
      <div className="card border-red-500/20 bg-red-500/[0.03] p-6">
        <p className="mb-2 text-sm font-semibold text-red-400">{t('results.simulationFailed')}</p>
        <p className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-red-400/60">
          {job.error || t('results.unknownError')}
        </p>
      </div>
    );
  }

  if (job.status === 'pending' || job.status === 'running') {
    return (
      <SimStatus
        status={job.status}
        progress={job.progress}
        progressStage={job.progress_stage}
        progressDetail={job.progress_detail}
        stagesCompleted={job.stages_completed}
        jobId={id}
        onCancelled={() => setJob({ ...job, status: 'cancelled' })}
        logLines={logLines}
        showLogs={showLogs}
        onToggleLogs={handleToggleLogs}
      />
    );
  }

  if (!job.result) {
    return <p className="text-sm text-muted">{t('results.noResultData')}</p>;
  }

  const r = job.result;
  const isTopGear = r.type === 'top_gear';

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
                      : 'border-border bg-surface-2 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
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
            elapsedTime={r.elapsed_time_seconds as number | undefined}
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
            dps={r.dps as number}
            dpsError={r.dps_error as number}
            dpsErrorPct={r.dps_error_pct as number | undefined}
            fightLength={r.fight_length as number}
            desiredTargets={r.desired_targets as number | undefined}
            iterations={r.iterations as number | undefined}
            targetError={r.target_error as number | undefined}
            elapsedTime={r.elapsed_time_seconds as number | undefined}
            baseDps={r.base_dps as number | undefined}
          />
          {r.equipped_gear &&
            Object.keys(r.equipped_gear as Record<string, unknown>).length > 0 ? (
              <GearOverview
                gear={r.equipped_gear as Record<string, GearItem>}
                characterRenderUrl={
                  r.realm && r.player_name
                    ? `https://simhammer.com/api/blizzard/character/${encodeURIComponent((r.realm as string).toLowerCase())}/${encodeURIComponent((r.player_name as string).toLowerCase())}/media/render`
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
