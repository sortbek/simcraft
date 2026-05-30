import { useEffect, useState } from 'react';
import { API_URL } from './api';

export interface ProviderCaps {
  cancel: boolean;
  pause: boolean;
  streaming_logs: boolean;
  server_side_multistage: boolean;
}
export interface ProviderMeta {
  id: string;
  display_name: string;
  capabilities: ProviderCaps;
  server_configured: boolean;
}

let cache: ProviderMeta[] | null = null;
let inflight: Promise<ProviderMeta[]> | null = null;
type Listener = (data: ProviderMeta[]) => void;
const providerListeners = new Set<Listener>();

export async function fetchProviders(): Promise<ProviderMeta[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = fetch(`${API_URL}/api/providers`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`providers: ${r.status}`);
      cache = (await r.json()) as ProviderMeta[];
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Force a re-fetch of /api/providers and notify all useProviders subscribers.
 *  Call after saving or removing a provider API key on the server. */
export function invalidateProviders(): void {
  cache = null;
  inflight = null;
  fetchProviders()
    .then((data) => {
      providerListeners.forEach((l) => l(data));
    })
    .catch(() => {
      providerListeners.forEach((l) => l([]));
    });
}

export function useProviders(): ProviderMeta[] | null {
  const [v, setV] = useState<ProviderMeta[] | null>(cache);
  useEffect(() => {
    providerListeners.add(setV);
    if (v === null) {
      fetchProviders()
        .then(setV)
        .catch(() => setV([]));
    }
    return () => {
      providerListeners.delete(setV);
    };
    // setV is stable; cache check happens once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

export function useProviderMeta(id: string | undefined): ProviderMeta | undefined {
  const all = useProviders();
  return all?.find((p) => p.id === id);
}

export function useProviderCaps(id: string | undefined): ProviderCaps {
  const meta = useProviderMeta(id);
  return (
    meta?.capabilities ?? {
      cancel: false,
      pause: false,
      streaming_logs: false,
      server_side_multistage: false,
    }
  );
}

function localKeyName(id: string) {
  return `simhammer.provider.${id}.api_key`;
}

export function getLocalKey(id: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(localKeyName(id));
}

/** Fired by setLocalKey so same-tab consumers re-read; cross-tab uses `storage`. */
const LOCAL_KEY_EVENT = 'simhammer:provider-key-changed';

export function setLocalKey(id: string, key: string | null) {
  if (typeof window === 'undefined') return;
  if (key === null || key === '') {
    window.localStorage.removeItem(localKeyName(id));
  } else {
    window.localStorage.setItem(localKeyName(id), key);
  }
  window.dispatchEvent(new CustomEvent(LOCAL_KEY_EVENT, { detail: { id } }));
}

export function useProviderReady(id: string): boolean {
  const meta = useProviderMeta(id);
  const [localKey, setLk] = useState<string | null>(
    typeof window === 'undefined' ? null : getLocalKey(id)
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setLk(getLocalKey(id));
    window.addEventListener('storage', handler);
    window.addEventListener(LOCAL_KEY_EVENT, handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener(LOCAL_KEY_EVENT, handler);
    };
  }, [id]);
  if (id === 'local') return true;
  return !!(meta?.server_configured || localKey);
}

/** Remote providers (id !== 'local') that are READY — server-configured (desktop)
 *  or holding a localStorage key (web). Used to decide whether the compute picker
 *  is worth showing at all. Recomputes when a provider key is added/removed. */
export function useReadyRemoteProviders(): ProviderMeta[] {
  const all = useProviders();
  const [keyTick, setKeyTick] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setKeyTick((n) => n + 1);
    window.addEventListener('storage', handler);
    window.addEventListener(LOCAL_KEY_EVENT, handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener(LOCAL_KEY_EVENT, handler);
    };
  }, []);
  void keyTick; // referenced so the recompute on key change is intentional
  if (!all) return [];
  return all.filter((p) => p.id !== 'local' && (p.server_configured || !!getLocalKey(p.id)));
}
