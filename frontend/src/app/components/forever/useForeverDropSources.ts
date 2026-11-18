'use client';

import { useEffect, useState } from 'react';
import { postJson } from '../../lib/api';
import type { ForeverDropSources } from './types';

/** The Drop Finder's sources for the pasted character, read again when the paste changes. */
export function useForeverDropSources(simcInput: string) {
  const [sources, setSources] = useState<ForeverDropSources | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSources(null);
    setError(null);
    if (!simcInput) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      postJson<ForeverDropSources>('/api/forever/drop-sources', { simc_input: simcInput })
        .then((s) => !cancelled && setSources(s))
        .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [simcInput]);
  return { sources, error };
}
