'use client';

import { useEffect, useState } from 'react';
import { postJson } from '../../lib/api';
import type { ForeverImport } from './types';

let shared: { key: string; request: Promise<ForeverImport> } | null = null;

/** One import per paste, shared by the page and the top bar; a failed one is not kept. */
function importOnce(simcInput: string, talents: string | null): Promise<ForeverImport> {
  const key = `${talents ?? ''}\n${simcInput}`;
  if (shared?.key !== key) {
    const request = postJson<ForeverImport>('/api/forever/import', {
      simc_input: simcInput,
      talents_string: talents ?? undefined,
    });
    shared = { key, request };
    request.catch(() => {
      if (shared?.request === request) shared = null;
    });
  }
  return shared.request;
}

/** `talents`: the calculator's edit, read back with its trees, points and spec. */
export function useForeverImport(simcInput: string, talents: string | null = null) {
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
      importOnce(simcInput, talents)
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
  }, [simcInput, talents]);
  return { summary, error };
}
