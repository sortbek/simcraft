'use client';

import { useCallback, useState } from 'react';
import ErrorAlert from '../components/ui/ErrorAlert';
import { API_URL } from '../lib/api';
import { useLanguage } from '../lib/i18n';

export default function AdvancedPage() {
  const { t } = useLanguage();
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
      window.location.href = `/sim/${data.id}`;
    } catch {
      setError(t('validation.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [rawInput, t]);

  return (
    <div className="space-y-6 pb-8">
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="font-headline font-bold text-sm uppercase tracking-widest text-on-surface-variant mb-1">
            {t('advanced.title')}
          </h2>
          <p className="text-[13px] text-on-surface-variant/50">
            {t('advanced.description')}
          </p>
        </div>
        <textarea
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          placeholder={t('advanced.placeholder')}
          className="input-field h-[50vh] resize-y font-mono text-xs leading-relaxed"
          spellCheck={false}
        />
      </div>

      <ErrorAlert message={error} />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || rawInput.trim().length < 10}
          className="bg-gradient-to-r from-primary to-primary-container px-12 py-4 rounded-lg text-on-primary font-headline font-black text-sm uppercase tracking-widest shadow-[0_4px_20px_rgba(200,153,42,0.3)] hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center gap-3"
        >
          {submitting ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
