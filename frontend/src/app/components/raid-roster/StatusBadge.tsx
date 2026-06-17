const STATUS_STYLES: Record<string, { label: string; className: string; title?: string }> = {
  // Member armory statuses (from RosterEditor)
  ok: {
    label: 'OK',
    className: 'border-green-400/30 bg-green-400/10 text-green-400',
  },
  pending: {
    label: 'Pending',
    className: 'border-outline-variant/30 bg-surface-container-high text-on-surface-variant',
  },
  not_found: {
    label: 'Not found',
    className: 'border-red-500/30 bg-red-500/10 text-red-400',
    title: 'Character could not be found on the armory for this region.',
  },
  armory_failed: {
    label: 'Failed',
    className: 'border-red-500/30 bg-red-500/10 text-red-400',
    title: 'Fetching or converting this character from the armory failed.',
  },
  // Run statuses (from RosterHistory)
  done: {
    label: 'done',
    className: 'border-green-400/30 bg-green-500/20 text-green-400',
  },
  running: {
    label: 'running',
    className: 'border-outline-variant/30 bg-surface-container-high text-on-surface-variant',
  },
  failed: {
    label: 'failed',
    className: 'border-red-500/30 bg-red-500/20 text-red-400',
  },
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? {
    label: status || 'Unknown',
    className: 'border-outline-variant/30 bg-surface-container-high text-on-surface-variant',
  };
  return (
    <span
      title={style.title}
      className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ${style.className}`}
    >
      {style.label}
    </span>
  );
}
