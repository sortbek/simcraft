'use client';

import { useProviders, useProviderReady } from '../lib/providers';
import { ComputeChoice } from '../lib/useComputeChoice';

export default function ComputeSelector({
  value,
  onChange,
}: {
  value: ComputeChoice;
  onChange: (v: ComputeChoice) => void;
}) {
  const providers = useProviders();
  const simmitReady = useProviderReady('simmit');

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
        {remote.map((p) => {
          const disabled = p.id === 'simmit' && !simmitReady;
          return (
            <option key={p.id} value={p.id} disabled={disabled}>
              {p.display_name}
              {disabled ? ' (configure in Settings)' : ''}
            </option>
          );
        })}
      </select>
    </label>
  );
}
