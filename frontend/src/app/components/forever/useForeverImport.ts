'use client';

import { useEffect, useState } from 'react';
import { postJson } from '../../lib/api';
import type { ForeverImport } from './types';

export function useForeverImport(simcInput: string) {
  const [summary, setSummary] = useState<ForeverImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      postJson<ForeverImport>('/api/forever/import', { simc_input: simcInput })
        .then((s) => {
          if (cancelled) return;
          setSummary(s);
          setError(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setSummary(null);
          setError(e instanceof Error ? e.message : String(e));
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [simcInput]);
  return { summary, error };
}
