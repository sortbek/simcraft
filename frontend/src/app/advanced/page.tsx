'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import ErrorAlert from '../components/ui/ErrorAlert';
import SimcDownloadBanner from '../components/ui/SimcDownloadBanner';
import { API_URL } from '../lib/api';
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
        headers: { 'Content-Type': 'application/json' },
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
      <div className="card space-y-4 p-6">
        <div>
          <h2 className="mb-1 font-headline text-sm font-bold uppercase tracking-widest text-on-surface-variant">
            {t('advanced.title')}
          </h2>
          <p className="text-[13px] text-on-surface-variant/50">{t('advanced.description')}</p>
        </div>
        <textarea
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          placeholder={t('advanced.placeholder')}
          className="input-field h-[50vh] resize-y font-mono text-xs leading-relaxed"
          spellCheck={false}
        />
      </div>

      <SimcDownloadBanner />
      <ErrorAlert message={error} />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || rawInput.trim().length < 10}
          className="flex items-center gap-3 rounded-lg bg-gradient-to-r from-primary to-primary-container px-12 py-4 font-headline text-sm font-black uppercase tracking-widest text-on-primary shadow-[0_4px_20px_rgba(200,153,42,0.3)] transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
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
        </button>
      </div>
    </div>
  );
}
