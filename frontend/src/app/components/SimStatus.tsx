"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL } from "../lib/api";

interface SimStatusProps {
  status: string;
  progress: number;
  progressStage?: string;
  progressDetail?: string;
  stagesCompleted?: string[];
  jobId?: string;
  onCancelled?: () => void;
}

/**
 * Tracks server-reported progress. Only advances when the backend
 * reports a higher value (i.e. a profileset or stage actually completed).
 * The CSS transition on the bar handles visual smoothing.
 */
function useSmoothedProgress(serverProgress: number): number {
  const [display, setDisplay] = useState(serverProgress);

  useEffect(() => {
    setDisplay((prev) => Math.max(prev, serverProgress));
  }, [serverProgress]);

  return Math.round(display);
}

/** Poll CPU usage from the desktop backend while a sim is running. */
function useCpuUsage(isRunning: boolean): number | null {
  const [cpu, setCpu] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isDesktop = useRef(false);

  useEffect(() => {
    isDesktop.current = !!window.electronAPI;
  }, []);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (!isRunning || !isDesktop.current) {
      setCpu(null);
      intervalRef.current = null;
      return;
    }

    function fetchCpu() {
      fetch(`${API_URL}/api/system-stats`)
        .then((r) => r.json())
        .then((d) => setCpu(d.cpu_usage ?? null))
        .catch(() => {});
    }

    fetchCpu();
    intervalRef.current = setInterval(fetchCpu, 1500);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning]);

  return cpu;
}

export default function SimStatus({
  status,
  progress,
  progressStage,
  progressDetail,
  stagesCompleted,
  jobId,
  onCancelled,
}: SimStatusProps) {
  const isRunning = status === "running";
  const isPending = status === "pending";
  const [cancelling, setCancelling] = useState(false);
  const displayProgress = useSmoothedProgress(progress);
  const cpuUsage = useCpuUsage(isRunning);
  const title = progressStage || (isPending ? "Queued" : "Simulating");
  const hasStages = stagesCompleted && stagesCompleted.length > 0;

  async function handleCancel() {
    if (!jobId || cancelling) return;
    setCancelling(true);
    try {
      await fetch(`${API_URL}/api/sim/${jobId}/cancel`, { method: "POST" });
      onCancelled?.();
    } catch {
      // ignore
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-6">
      <div className="w-10 h-10 border-2 border-border border-t-gold rounded-full animate-spin" />

      <div className="text-center">
        <p className="text-sm text-white font-medium">{title}</p>
        {progressDetail && (
          <p className="text-[11px] text-gray-400 mt-1">{progressDetail}</p>
        )}
      </div>

      <div className="w-72">
        <div className="w-full bg-surface rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-gold h-full rounded-full transition-all duration-700"
            style={{ width: `${Math.max(displayProgress, status === "pending" ? 2 : 5)}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-[11px] text-gray-400 font-mono tabular-nums">
            {displayProgress}%
          </p>
          {cpuUsage !== null && (
            <p className="text-[11px] text-gray-400 font-mono tabular-nums">
              CPU {Math.round(cpuUsage)}%
            </p>
          )}
        </div>
      </div>

      {jobId && (isRunning || isPending) && (
        <button
          onClick={handleCancel}
          disabled={cancelling}
          className="text-[12px] text-gray-500 hover:text-red-400 transition-colors px-3 py-1 rounded-lg hover:bg-red-500/10"
        >
          {cancelling ? "Cancelling..." : "Cancel Sim"}
        </button>
      )}

      {hasStages && (
        <div className="w-72 space-y-1 pt-2">
          {stagesCompleted!.map((stage, i) => (
            <div key={i} className="flex items-center gap-2">
              <svg className="w-3 h-3 text-emerald-500 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5L6.5 10.5L4 8" />
              </svg>
              <span className="text-[11px] text-gray-400">{stage}</span>
            </div>
          ))}
          {progressStage && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 flex items-center justify-center shrink-0">
                <div className="w-1.5 h-1.5 bg-gold rounded-full animate-pulse" />
              </div>
              <span className="text-[11px] text-gray-400">
                {progressStage}
                {progressDetail && <span className="text-gray-500"> · {progressDetail}</span>}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
