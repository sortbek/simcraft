"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import ResultsChart from "../../components/ResultsChart";
import SimStatus from "../../components/SimStatus";
import StatWeightsTable from "../../components/StatWeightsTable";
import TopGearResults from "../../components/TopGearResults";

import { API_URL } from "../../lib/api";

function SimMetadata({ result: r }: { result: Record<string, unknown> }) {
  return (
    <div className="card p-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
        {typeof r.dps_error === "number" && (
          <div>
            <p className="text-[11px] text-muted uppercase tracking-wider mb-1">Margin of Error</p>
            <p className="text-sm text-white font-medium">
              ~{Math.round(r.dps_error as number)} DPS
              {typeof r.dps_error_pct === "number" && (
                <span className="text-muted ml-1">({r.dps_error_pct as number}%)</span>
              )}
            </p>
          </div>
        )}
        {typeof r.iterations === "number" && (r.iterations as number) > 0 && (
          <div>
            <p className="text-[11px] text-muted uppercase tracking-wider mb-1">Iterations</p>
            <p className="text-sm text-white font-medium">
              {(r.iterations as number).toLocaleString()}
              {typeof r.target_error === "number" && (r.target_error as number) > 0 && (
                <span className="text-muted ml-1">(Smart Sim)</span>
              )}
            </p>
          </div>
        )}
        {typeof r.elapsed_time_seconds === "number" && (
          <div>
            <p className="text-[11px] text-muted uppercase tracking-wider mb-1">Processing Time</p>
            <p className="text-sm text-white font-medium">
              {(r.elapsed_time_seconds as number) >= 60
                ? `${Math.floor((r.elapsed_time_seconds as number) / 60)}:${String(Math.round((r.elapsed_time_seconds as number) % 60)).padStart(2, "0")}`
                : `${(r.elapsed_time_seconds as number).toFixed(1)}s`}
            </p>
          </div>
        )}
        {typeof r.fight_length === "number" && (
          <div>
            <p className="text-[11px] text-muted uppercase tracking-wider mb-1">Fight Length</p>
            <p className="text-sm text-white font-medium">
              {Math.floor((r.fight_length as number) / 60)}:{String(Math.round((r.fight_length as number) % 60)).padStart(2, "0")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

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
  const params = useParams();
  const paramId = params.id as string;

  // In static export, useParams() may initially return "_" (the generateStaticParams
  // placeholder) before the router reconciles with the actual URL. Fall back to the URL.
  let id = paramId;
  if ((!paramId || paramId === "_") && typeof window !== "undefined") {
    const match = window.location.pathname.match(/\/sim\/(.+)/);
    if (match) id = match[1];
  }

  const [job, setJob] = useState<JobData | null>(null);
  const [fetchError, setFetchError] = useState("");

  useEffect(() => {
    if (!id || id === "_") return;
    setFetchError("");
    let active = true;
    async function poll() {
      try {
        const res = await fetch(`${API_URL}/api/sim/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: JobData = await res.json();
        if (active) setJob(data);
        if (data.status === "pending" || data.status === "running") {
          setTimeout(poll, 2000);
        }
      } catch (err) {
        if (active)
          setFetchError(
            err instanceof Error ? err.message : "Failed to fetch status"
          );
      }
    }
    poll();
    return () => { active = false; };
  }, [id]);

  if (fetchError) {
    return (
      <div className="card border-red-500/20 p-6">
        <p className="text-sm font-medium text-red-400 mb-1">Error</p>
        <p className="text-sm text-red-400/70">{fetchError}</p>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-border border-t-gold rounded-full animate-spin" />
      </div>
    );
  }

  if (job.status === "cancelled") {
    return (
      <div className="card border-amber-500/20 p-6 text-center">
        <p className="text-sm font-medium text-amber-400">Simulation Cancelled</p>
      </div>
    );
  }

  if (job.status === "failed") {
    return (
      <div className="card border-red-500/20 p-6">
        <p className="text-sm font-medium text-red-400 mb-2">
          Simulation Failed
        </p>
        <p className="font-mono text-xs text-red-400/60 whitespace-pre-wrap">
          {job.error || "Unknown error"}
        </p>
      </div>
    );
  }

  if (job.status === "pending" || job.status === "running") {
    return (
      <SimStatus
        status={job.status}
        progress={job.progress}
        progressStage={job.progress_stage}
        progressDetail={job.progress_detail}
        stagesCompleted={job.stages_completed}
        jobId={id}
        onCancelled={() => setJob({ ...job, status: "cancelled" })}
      />
    );
  }

  if (!job.result) {
    return <p className="text-sm text-muted">No result data available.</p>;
  }

  const r = job.result;
  const isTopGear = r.type === "top_gear";

  return (
    <div className="space-y-6">
      {isTopGear ? (
        <>
          <TopGearResults
            playerName={r.player_name as string}
            playerClass={r.player_class as string}
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
            equippedGear={r.equipped_gear as Record<string, {
              slot: string;
              item_id: number;
              ilevel: number;
              name: string;
              bonus_ids?: number[];
              enchant_id?: number;
              gem_id?: number;
            }>}
          />
          <SimMetadata result={r} />
        </>
      ) : (
        <>
          <ResultsChart
            dps={r.dps as number}
            dpsError={r.dps_error as number}
            fightLength={r.fight_length as number}
            playerName={r.player_name as string}
            playerClass={r.player_class as string}
            abilities={
              (r.abilities as Array<{
                name: string;
                portion_dps: number;
                school: string;
              }>) || []
            }
          />
          <SimMetadata result={r} />
          {r.stat_weights && (
            <StatWeightsTable
              statWeights={r.stat_weights as Record<string, number>}
            />
          )}
        </>
      )}

      {/* Footer links */}
      <div className="flex items-center justify-center gap-3 text-xs text-muted pb-4">
        {typeof r.simc_version === "string" && (
          <>
            {typeof r.simc_git_revision === "string" && r.simc_git_revision ? (
              <a
                href={`https://github.com/simulationcraft/simc/commit/${r.simc_git_revision}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors"
              >
                {r.simc_version as string}
              </a>
            ) : (
              <span>{r.simc_version as string}</span>
            )}
            <span className="w-px h-3 bg-border" />
          </>
        )}
        <a
          href={`${API_URL}/api/sim/${id}/raw`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white transition-colors"
        >
          Raw JSON
        </a>
        <span className="w-px h-3 bg-border" />
        <a
          href={`${API_URL}/api/sim/${id}/input`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white transition-colors"
        >
          Raw Input
        </a>
        <span className="w-px h-3 bg-border" />
        <a
          href={`${API_URL}/api/sim/${id}/data.csv`}
          className="hover:text-white transition-colors"
        >
          CSV
        </a>
        <span className="w-px h-3 bg-border" />
        <a
          href={`${API_URL}/api/sim/${id}/html`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white transition-colors"
        >
          HTML Report
        </a>
        <span className="w-px h-3 bg-border" />
        <a
          href={`${API_URL}/api/sim/${id}/output.txt`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white transition-colors"
        >
          Text Output
        </a>
      </div>
    </div>
  );
}
