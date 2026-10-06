'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '../lib/i18n';
import { API_URL } from '../lib/api';
import {
  useProviders,
  getLocalKey,
  setLocalKey,
  useProviderReady,
  invalidateProviders,
} from '../lib/providers';
import { useIsDesktop } from '../lib/useIsDesktop';
import CardHeader from '../components/ui/CardHeader';
import Button from '../components/ui/Button';
import Pill from '../components/ui/Pill';

interface TestResult {
  ok: boolean;
  credits_available?: number | null;
  detail?: string;
}

function ProviderRow({ providerId, displayName }: { providerId: string; displayName: string }) {
  const { t } = useLanguage();
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
    // Key source priority: 1) text input, 2) localStorage (web), 3) backend-stored
    // secret (desktop, via test-stored) — without #3, desktop's Test would need the key re-typed.
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
        setTest({ ok: false, detail: e?.message ?? t('settings.networkError') });
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
      setTest({ ok: false, detail: e?.message ?? t('settings.networkError') });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-[8px] border border-line/[0.06] bg-surface-container-low p-3">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-on-surface">{displayName}</p>
            <Pill variant={ready ? 'gold' : 'neutral'}>
              {ready ? t('settings.ready') : t('settings.notConfigured')}
            </Pill>
          </div>
          <p className="text-[11px] text-outline">{providerId}</p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          type="password"
          placeholder={
            stored ? t('settings.keyOnFile') : t('settings.pasteApiKey', { displayName })
          }
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="input-field h-7 min-w-0 flex-1 py-0 text-xs"
        />
        <Button size="sm" onClick={save}>
          {t('common.save')}
        </Button>
        <Button size="sm" variant="quiet" onClick={testConn} disabled={testing}>
          {testing ? '...' : t('settings.test')}
        </Button>
        {stored && (
          <Button size="sm" variant="danger" onClick={remove}>
            {t('settings.remove')}
          </Button>
        )}
      </div>

      {test && (
        <p className={`mt-2 text-[11px] ${test.ok ? 'text-positive' : 'text-negative'}`}>
          {test.ok
            ? t('settings.connectedCredits', { n: test.credits_available ?? '—' })
            : t('settings.testFailed', { detail: test.detail ?? t('settings.unknownError') })}
        </p>
      )}
    </div>
  );
}

export default function ComputeProvidersSection() {
  const { t } = useLanguage();
  const providers = useProviders();
  if (!providers) return null;
  const remote = providers.filter((p) => p.id !== 'local');
  return (
    <section className="card">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <svg className="h-4 w-4 text-gold" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
            </svg>
            {t('settings.computeProviders')}
          </span>
        }
      />

      <div className="space-y-3 p-6">
        <p className="text-xs text-on-surface-variant">{t('settings.computeProvidersDesc')}</p>
        <div className="space-y-2">
          {remote.map((p) => (
            <ProviderRow key={p.id} providerId={p.id} displayName={p.display_name} />
          ))}
        </div>
      </div>
    </section>
  );
}
