import Pill, { type PillVariant } from '../ui/Pill';

const STATUS_STYLES: Record<string, { label: string; variant: PillVariant; title?: string }> = {
  // Member armory statuses (from RosterEditor)
  ok: {
    label: 'OK',
    variant: 'positive',
  },
  pending: {
    label: 'Pending',
    variant: 'neutral',
  },
  not_found: {
    label: 'Not found',
    variant: 'negative',
    title: 'Character could not be found on the armory for this region.',
  },
  armory_failed: {
    label: 'Failed',
    variant: 'negative',
    title: 'Fetching or converting this character from the armory failed.',
  },
  // Run statuses (from RosterHistory)
  done: {
    label: 'done',
    variant: 'positive',
  },
  running: {
    label: 'running',
    variant: 'neutral',
  },
  failed: {
    label: 'failed',
    variant: 'negative',
  },
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? {
    label: status || 'Unknown',
    variant: 'neutral',
  };
  return (
    <span title={style.title}>
      <Pill variant={style.variant}>{style.label}</Pill>
    </span>
  );
}
