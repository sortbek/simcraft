'use client';

import { ProviderMeta, useProviders, useProviderReady } from '../lib/providers';
import { ComputeChoice } from '../lib/useComputeChoice';

function RemoteOption({ p }: { p: ProviderMeta }) {
  const ready = useProviderReady(p.id);
  const disabled = !ready;
  return (
    <option value={p.id} disabled={disabled}>
      {p.display_name}
      {disabled ? ' (configure in Settings)' : ''}
    </option>
  );
}

export default function ComputeSelector({
  value,
  onChange,
}: {
  value: ComputeChoice;
  onChange: (v: ComputeChoice) => void;
}) {
  const providers = useProviders();

  if (!providers) return null;
  const remote = providers.filter((p) => p.id !== 'local');

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-bold uppercase tracking-wider text-on-surface-variant">Compute</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ComputeChoice)}
        className="rounded border border-outline/40 bg-surface-container px-2 py-1 text-sm"
      >
        <option value="auto">Auto</option>
        <option value="local">Local SimC</option>
        {remote.map((p) => (
          <RemoteOption key={p.id} p={p} />
        ))}
      </select>
    </label>
  );
}
