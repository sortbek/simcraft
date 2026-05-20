import type { JobOverviewSummary } from '../../lib/api';
import { isActiveStatus } from '../../lib/useActiveSims';

interface Props {
  job: JobOverviewSummary;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  /** Smaller text/padding for inline use inside the dense history row. */
  compact?: boolean;
}

/** Pause / Resume / Cancel cluster for an active job. Shared between the
 * Active table and the All-view history row so the two surfaces stay in
 * sync when affordances change. */
export function JobActionButtons({
  job,
  busy,
  onPause,
  onResume,
  onCancel,
  compact = false,
}: Props) {
  const text = compact ? 'text-[11px]' : 'text-[12px]';
  const pad = compact ? 'px-2 py-0.5' : 'px-2 py-1';
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="flex items-center justify-end gap-1">
      {job.status === 'running' && job.simc_input_mode === 'streamed' && (
        <button
          disabled={busy || job.pause_requested}
          onClick={(e) => {
            stop(e);
            onPause();
          }}
          className={`rounded ${pad} ${text} text-on-surface-variant/60 hover:bg-white/5 hover:text-on-surface disabled:opacity-40`}
        >
          {job.pause_requested ? 'Pausing…' : 'Pause'}
        </button>
      )}
      {job.status === 'paused' && (
        <button
          disabled={busy}
          onClick={(e) => {
            stop(e);
            onResume();
          }}
          className={`rounded ${pad} ${text} text-primary hover:bg-primary/10 disabled:opacity-40`}
        >
          Resume
        </button>
      )}
      {isActiveStatus(job.status) && (
        <button
          disabled={busy}
          onClick={(e) => {
            stop(e);
            onCancel();
          }}
          className={`rounded ${pad} ${text} text-on-surface-variant/60 hover:bg-red-500/10 hover:text-error disabled:opacity-40`}
        >
          Cancel
        </button>
      )}
    </div>
  );
}
