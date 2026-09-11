import { useCallback, useEffect, useState } from 'react';
import { apiUrl, fetchJson } from '../../lib/api';
import type { DropItem } from './types';
import type { LoadState } from './useLootCatalog';
export interface DropQuery {
  source: string;
  className: string | null;
  specs: string[];
  voidForge: boolean;
  catalyst: boolean;
}
export function dropQueryUrl(query: DropQuery): string {
  if (!query.source) return '';
  const params = new URLSearchParams();
  if (query.className) params.set('class_name', query.className);
  if (query.specs.length) params.set('spec', query.specs.join(','));
  params.set('void_forge', String(query.voidForge));
  params.set('catalyst', String(query.catalyst));
  const path = query.source.startsWith('type:')
    ? '/api/instances/type/' + query.source.slice(5) + '/drops'
    : '/api/instances/' + query.source + '/drops';
  return apiUrl(path) + '?' + params;
}
export function useDropFinderData(query: DropQuery) {
  const url = dropQueryUrl(query);
  const [attempt, setAttempt] = useState(0);
  const key = url + ':' + attempt;
  const [result, setResult] = useState<{
    key: string;
    state: LoadState<Record<string, DropItem[]>>;
  }>({ key: '', state: { status: 'idle' } });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setResult({ key, state: { status: 'loading' } });
    fetchJson<Record<string, DropItem[]> | { detail: string }>(url, { signal: controller.signal })
      .then((data) => {
        if ('detail' in data) throw new Error(String(data.detail));
        if (!controller.signal.aborted) setResult({ key, state: { status: 'success', data } });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ key, state: { status: 'error', error: String(error.message ?? error) } });
      });
    return () => controller.abort();
  }, [url, key]);
  const state: LoadState<Record<string, DropItem[]>> = !url
    ? { status: 'idle' }
    : result.key === key
      ? result.state
      : { status: 'loading' };
  return {
    ...state,
    datasetId: key,
    retry: useCallback(() => setAttempt((value) => value + 1), []),
  };
}
