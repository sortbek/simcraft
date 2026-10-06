import type { JobOverviewSummary } from '../../lib/api';
import { isActiveStatus } from '../../lib/useActiveSims';
import { useLanguage } from '../../lib/i18n';
import Button from '../../components/ui/Button';

interface Props {
  job: JobOverviewSummary;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  /** Smaller text/padding for inline use inside the dense history row. */
  compact?: boolean;
}

/** Pause/Resume/Cancel cluster for an active job, shared by the Active table
 * and the All-view history row so both surfaces stay in sync. */
export function JobActionButtons({
  job,
  busy,
  onPause,
  onResume,
  onCancel,
  compact = false,
}: Props) {
  const { t } = useLanguage();
  const size = compact ? 'sm' : 'default';
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="flex items-center justify-end gap-1">
      {job.status === 'running' && job.simc_input_mode === 'streamed' && (
        <Button
          disabled={busy || job.pause_requested}
          onClick={(e: React.MouseEvent) => {
            stop(e);
            onPause();
          }}
          variant="text"
          size={size}
        >
          {job.pause_requested ? t('sims.pausing') : t('sims.pause')}
        </Button>
      )}
      {job.status === 'paused' && (
        <Button
          disabled={busy}
          onClick={(e: React.MouseEvent) => {
            stop(e);
            onResume();
          }}
          variant="gold"
          size={size}
        >
          {t('sims.resume')}
        </Button>
      )}
      {isActiveStatus(job.status) && (
        <Button
          disabled={busy}
          onClick={(e: React.MouseEvent) => {
            stop(e);
            onCancel();
          }}
          variant="text"
          size={size}
          className="hover:text-negative"
        >
          {t('common.cancel')}
        </Button>
      )}
    </div>
  );
}
