'use client';

import { useEffect, useState } from 'react';
import { API_URL } from '../lib/api';
import {
  useProviders,
  getLocalKey,
  setLocalKey,
  useProviderReady,
  invalidateProviders,
} from '../lib/providers';
import { useIsDesktop } from '../lib/useIsDesktop';

interface TestResult {
  ok: boolean;
  credits_available?: number | null;
  detail?: string;
}

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
      invalidateProviders();
    } else {
      setLocalKey(providerId, key);
    }
    setStored(true);
    setKey('');
  }

  async function remove() {
    if (isDesktop) {
      await fetch(`${API_URL}/api/settings/provider/${providerId}`, { method: 'DELETE' });
      invalidateProviders();
    } else {
      setLocalKey(providerId, null);
    }
    setStored(false);
    setTest(null);
  }

  async function testConn() {
    // Three sources for the key, in priority order:
    //   1. text input (`key`) — user is replacing or testing before save
    //   2. localStorage (web only)
    //   3. backend-stored secret (desktop) — fetched via /api/providers/{id}/test-stored
    // Without #3, desktop's "Test" required re-typing the stored key, which
    // defeats the purpose of "Ready".
    const trimmed = key.trim();
    if (trimmed) {
      await postTest(trimmed);
      return;
    }
    if (!isDesktop) {
      const localK = getLocalKey(providerId) ?? '';
      if (localK) {
        await postTest(localK);
      }
      return;
    }
    if (stored) {
      // Desktop with a saved key — ask the backend to test what it has on file.
      setTesting(true);
      try {
        const res = await fetch(`${API_URL}/api/providers/${providerId}/test-stored`, {
          method: 'POST',
        });
        setTest(await res.json());
      } catch (e: any) {
        setTest({ ok: false, detail: e?.message ?? 'network error' });
      } finally {
        setTesting(false);
      }
    }
  }

  async function postTest(api_key: string) {
    setTesting(true);
    try {
      const res = await fetch(`${API_URL}/api/providers/${providerId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key }),
      });
      setTest(await res.json());
    } catch (e: any) {
      setTest({ ok: false, detail: e?.message ?? 'network error' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-lg border border-outline-variant/10 bg-surface-container p-3">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{displayName}</p>
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                ready
                  ? 'bg-primary/10 text-primary'
                  : 'bg-outline-variant/10 text-on-surface-variant/70'
              }`}
            >
              {ready ? 'Ready' : 'Not configured'}
            </span>
          </div>
          <p className="text-[10px] text-on-surface-variant/70">{providerId}</p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          type="password"
          placeholder={
            stored
              ? 'Key on file — paste a new key to replace'
              : `Paste your ${displayName} API key`
          }
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="flex-1 rounded border border-outline-variant/20 bg-surface-container-lowest px-3 py-1.5 text-xs placeholder:text-on-surface-variant/50 focus:border-primary/40 focus:outline-none"
        />
        <button
          onClick={save}
          className="rounded bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary transition-all hover:bg-primary/20"
        >
          Save
        </button>
        <button
          onClick={testConn}
          disabled={testing}
          className="rounded bg-surface-container-highest px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-on-surface transition-colors hover:bg-surface-bright disabled:opacity-50"
        >
          {testing ? '...' : 'Test'}
        </button>
        {stored && (
          <button
            onClick={remove}
            className="rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-error/60 transition-all hover:bg-error/10 hover:text-error"
          >
            Remove
          </button>
        )}
      </div>

      {test && (
        <p className={`mt-2 text-[10px] ${test.ok ? 'text-primary' : 'text-error'}`}>
          {test.ok
            ? `Connected · ${test.credits_available ?? '—'} credits available`
            : `Failed: ${test.detail ?? 'unknown error'}`}
        </p>
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
      <div className="text-primary-fixed-dim flex items-center gap-2">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
        </svg>
        <h2 className="text-sm font-bold uppercase tracking-[0.2em]">Compute Providers</h2>
      </div>

      <div className="space-y-3 rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
        <p className="text-xs text-on-surface-variant">
          Cloud SimC providers. Configure once; pick per sim with the Compute selector.
        </p>
        <div className="space-y-2">
          {remote.map((p) => (
            <ProviderRow key={p.id} providerId={p.id} displayName={p.display_name} />
          ))}
        </div>
      </div>
    </section>
  );
}
