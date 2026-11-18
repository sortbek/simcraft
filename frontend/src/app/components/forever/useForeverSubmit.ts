'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { postJson } from '../../lib/api';

/** Forever's submit path: only the Forever fields, one job, then the result page. */
export function useForeverSubmit(
  endpoint: string,
  buildPayload: () => Record<string, unknown> | null
) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submit = useCallback(async () => {
    const payload = buildPayload();
    if (!payload) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await postJson<{ id: string }>(endpoint, payload);
      router.push(`/sim/${res.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [endpoint, buildPayload, router]);
  return { submit, submitting, error };
}
