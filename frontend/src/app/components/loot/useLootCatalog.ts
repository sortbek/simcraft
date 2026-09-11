import { useCallback, useEffect, useState } from 'react';
import { apiUrl, fetchJson } from '../../lib/api';
import type { LootCatalog } from './lootConfiguration';
export type LoadState<T> =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; error: string }
  | { status: 'success'; data: T };
export function useLootCatalog() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState<LootCatalog>>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    const init = { signal: controller.signal };
    Promise.all([
      fetchJson<LootCatalog['instances']>(apiUrl('/api/instances'), init),
      fetchJson<LootCatalog['seasonConfig']>(apiUrl('/api/season-config'), init),
      fetchJson<LootCatalog['upgradeTracks']>(apiUrl('/api/upgrade-tracks'), init),
    ])
      .then(([instances, seasonConfig, upgradeTracks]) => {
        if (!controller.signal.aborted)
          setState({ status: 'success', data: { instances, seasonConfig, upgradeTracks } });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ status: 'error', error: String(error.message ?? error) });
      });
    return () => controller.abort();
  }, [attempt]);
  return { ...state, retry: useCallback(() => setAttempt((value) => value + 1), []) };
}
