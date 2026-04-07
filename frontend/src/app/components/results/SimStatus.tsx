'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import LogConsole from './LogConsole';

interface SimStatusProps {
  status: string;
  progress: number;
  progressStage?: string;
  progressDetail?: string;
  stagesCompleted?: string[];
  jobId?: string;
  onCancelled?: () => void;
  logLines?: string[];
  showLogs?: boolean;
  onToggleLogs?: () => void;
}

function useSmoothedProgress(serverProgress: number): number {
  const [display, setDisplay] = useState(serverProgress);
  useEffect(() => {
    setDisplay((prev) => Math.max(prev, serverProgress));
  }, [serverProgress]);
  return Math.round(display);
}

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
  logLines,
  showLogs,
  onToggleLogs,
}: SimStatusProps) {
  const { t } = useLanguage();
  const isRunning = status === 'running';
  const isPending = status === 'pending';
  const [cancelling, setCancelling] = useState(false);
  const displayProgress = useSmoothedProgress(progress);
  const cpuUsage = useCpuUsage(isRunning);
  const title = progressStage || (isPending ? t('results.queued') : t('results.simulating'));
  const hasStages = stagesCompleted && stagesCompleted.length > 0;

  async function handleCancel() {
    if (!jobId || cancelling) return;
    setCancelling(true);
    try {
      await fetch(`${API_URL}/api/sim/${jobId}/cancel`, { method: 'POST' });
      onCancelled?.();
    } catch {
      // ignore
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center space-y-6 py-16">
      <div className="relative">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-surface-container-highest border-t-primary" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-2 w-2 animate-pulse rounded-full bg-primary/60" />
        </div>
      </div>

      <div className="text-center">
        <p className="text-sm font-semibold text-on-surface">{title}</p>
        {progressDetail && <p className="mt-1 text-[13px] text-on-surface-variant/60">{progressDetail}</p>}
      </div>

      <div className="w-72">
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-container-highest">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary-container to-primary transition-all duration-700"
            style={{ width: `${Math.max(displayProgress, status === 'pending' ? 2 : 5)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="font-mono text-[12px] tabular-nums text-on-surface-variant/60">{displayProgress}%</p>
          {cpuUsage !== null && (
            <p className="font-mono text-[12px] tabular-nums text-on-surface-variant/60">
              CPU {Math.round(cpuUsage)}%
            </p>
          )}
        </div>
      </div>

      {jobId && (isRunning || isPending) && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="rounded-lg px-3 py-1 text-[14px] text-on-surface-variant/60 transition-colors hover:bg-red-500/10 hover:text-error"
          >
            {cancelling ? t('results.cancelling') : t('results.cancelSim')}
          </button>
          {onToggleLogs && (
            <button
              onClick={onToggleLogs}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-[14px] text-on-surface-variant/60 transition-colors hover:bg-white/5 hover:text-on-surface-variant"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="3" width="12" height="10" rx="1.5" />
                <path d="M5 7l2 2 2-2" />
              </svg>
              {showLogs ? t('results.hideLogs') : t('results.showLogs')}
            </button>
          )}
        </div>
      )}

      {hasStages && (
        <div className="w-72 space-y-1 pt-2">
          {stagesCompleted!.map((stage, i) => (
            <div key={i} className="flex items-center gap-2">
              <svg
                className="h-3 w-3 shrink-0 text-emerald-500"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5L6.5 10.5L4 8" />
              </svg>
              <span className="text-[13px] text-on-surface-variant">{stage}</span>
            </div>
          ))}
          {progressStage && (
            <div className="flex items-center gap-2">
              <div className="flex h-3 w-3 shrink-0 items-center justify-center">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              </div>
              <span className="text-[13px] text-on-surface-variant">
                {progressStage}
                {progressDetail && <span className="text-on-surface-variant/60"> · {progressDetail}</span>}
              </span>
            </div>
          )}
        </div>
      )}

      {showLogs && logLines && logLines.length > 0 && <LogConsole lines={logLines} />}
    </div>
  );
}
