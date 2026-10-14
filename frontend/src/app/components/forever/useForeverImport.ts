'use client';

import { useEffect, useState } from 'react';
import { postJson } from '../../lib/api';
import type { ForeverImport } from './types';

let shared: { input: string; request: Promise<ForeverImport> } | null = null;

/** One import per paste, shared by the page and the top bar; a failed one is not kept. */
function importOnce(simcInput: string): Promise<ForeverImport> {
  if (shared?.input !== simcInput) {
    const request = postJson<ForeverImport>('/api/forever/import', { simc_input: simcInput });
    shared = { input: simcInput, request };
    request.catch(() => {
      if (shared?.request === request) shared = null;
    });
  }
  return shared.request;
}

export function useForeverImport(simcInput: string) {
  const [summary, setSummary] = useState<ForeverImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!simcInput) {
      setSummary(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      importOnce(simcInput)
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
