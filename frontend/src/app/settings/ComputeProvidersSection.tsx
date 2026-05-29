'use client';

import { useEffect, useState } from 'react';
import { API_URL } from '../lib/api';
import { useProviders, getLocalKey, setLocalKey, useProviderReady } from '../lib/providers';
import { useIsDesktop } from '../lib/useIsDesktop';

interface TestResult { ok: boolean; credits_available?: number | null; detail?: string; }

function ProviderRow({ providerId, displayName }: { providerId: string; displayName: string }) {
  const isDesktop = useIsDesktop();
  const [key, setKey] = useState<string>('');
  const [stored, setStored] = useState<boolean>(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const ready = useProviderReady(providerId);

  useEffect(() => {
    if (!isDesktop) {
      const existing = getLocalKey(providerId);
      setStored(!!existing);
    } else {
      // For desktop the key lives in SettingsRepo; rely on `ready` from useProviderReady
      setStored(ready);
    }
  }, [providerId, isDesktop, ready]);

  async function save() {
    if (!key.trim()) return;
    if (isDesktop) {
      await fetch(`${API_URL}/api/settings/provider/${providerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key }),
      });
    } else {
      setLocalKey(providerId, key);
    }
    setStored(true);
    setKey('');
  }

  async function remove() {
    if (isDesktop) {
      await fetch(`${API_URL}/api/settings/provider/${providerId}`, { method: 'DELETE' });
    } else {
      setLocalKey(providerId, null);
    }
    setStored(false);
    setTest(null);
  }

  async function testConn() {
    const k = key || (isDesktop ? '' : getLocalKey(providerId) || '');
    if (!k && !stored) return;
    setTesting(true);
    try {
      const res = await fetch(`${API_URL}/api/providers/${providerId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: k || (getLocalKey(providerId) ?? '') }),
      });
      setTest(await res.json());
    } catch (e: any) {
      setTest({ ok: false, detail: e?.message ?? 'network error' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-lg border border-outline/30 bg-surface p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-headline text-lg font-bold">{displayName}</div>
          <div className="text-xs text-on-surface-variant">{providerId}</div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${ready ? 'bg-primary/20 text-primary' : 'bg-outline/20 text-on-surface-variant'}`}>
          {ready ? 'Ready' : 'Not configured'}
        </span>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          type="password"
          placeholder={stored ? 'Key on file — paste a new key to replace' : 'Paste your Simmit API key'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="flex-1 rounded border border-outline/40 bg-surface-container px-3 py-2 text-sm"
        />
        <button onClick={save} className="rounded bg-primary px-4 py-2 text-sm font-bold text-on-primary">Save</button>
        <button onClick={testConn} disabled={testing} className="rounded border border-outline px-4 py-2 text-sm">
          {testing ? '...' : 'Test'}
        </button>
        {stored && (
          <button onClick={remove} className="rounded border border-error/40 px-4 py-2 text-sm text-error">Remove</button>
        )}
      </div>

      {test && (
        <div className={`mt-2 text-xs ${test.ok ? 'text-primary' : 'text-error'}`}>
          {test.ok
            ? `Connected · ${test.credits_available ?? '—'} credits available`
            : `Failed: ${test.detail ?? 'unknown error'}`}
        </div>
      )}
    </div>
  );
}

export default function ComputeProvidersSection() {
  const providers = useProviders();
  if (!providers) return null;
  const remote = providers.filter((p) => p.id !== 'local');
  return (
    <section className="space-y-4">
      <h2 className="font-headline text-xl font-bold">Compute Providers</h2>
      <p className="text-sm text-on-surface-variant">
        Cloud SimC providers. Configure once; pick per sim with the Compute selector.
      </p>
      <div className="space-y-3">
        {remote.map((p) => (
          <ProviderRow key={p.id} providerId={p.id} displayName={p.display_name} />
        ))}
      </div>
    </section>
  );
}
