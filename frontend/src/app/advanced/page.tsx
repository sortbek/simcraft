'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import ErrorAlert from '../components/ui/ErrorAlert';
import SimcDownloadBanner from '../components/ui/SimcDownloadBanner';
import Button from '../components/ui/Button';
import CardHeader from '../components/ui/CardHeader';
import PageHeader from '../components/ui/PageHeader';
import { API_URL, providerKeyHeaders } from '../lib/api';
import { useLanguage } from '../lib/i18n';

export default function AdvancedPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [rawInput, setRawInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = useCallback(async () => {
    if (rawInput.trim().length < 10) {
      setError(t('validation.simcTooShort'));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/sim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...providerKeyHeaders() },
        body: JSON.stringify({
          simc_input: rawInput,
          sim_type: 'quick',
          raw: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || t('validation.serverError', { status: res.status }));
        return;
      }
      const data = await res.json();
      router.push(`/sim/${data.id}`);
    } catch {
      setError(t('validation.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [rawInput, router, t]);

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        eyebrow={t('nav.simTools')}
        title={t('nav.advancedSim')}
        subtitle={t('advanced.description')}
      />
      <div className="card">
        <CardHeader title={t('advanced.title')} />
        <div className="space-y-4 px-6 py-[22px]">
          <textarea
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder={t('advanced.placeholder')}
            className="input-field h-[50vh] resize-y font-mono text-xs leading-relaxed"
            spellCheck={false}
          />
        </div>
      </div>

      <SimcDownloadBanner />
      <ErrorAlert message={error} />

      <div className="flex justify-end">
        <Button
          variant="solid"
          size="lg"
          onClick={submit}
          disabled={submitting || rawInput.trim().length < 10}
        >
          {submitting ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                <path
                  d="M14 8a6 6 0 00-6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              {t('config.running')}
            </>
          ) : (
            t('button.runSimulation')
          )}
        </Button>
      </div>
    </div>
  );
}
