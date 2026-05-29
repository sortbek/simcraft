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

export function useProviders(): ProviderMeta[] | null {
  const [v, setV] = useState<ProviderMeta[] | null>(cache);
  useEffect(() => {
    if (v) return;
    fetchProviders().then(setV).catch(() => setV([]));
  }, [v]);
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

export function setLocalKey(id: string, key: string | null) {
  if (typeof window === 'undefined') return;
  if (key === null || key === '') {
    window.localStorage.removeItem(localKeyName(id));
  } else {
    window.localStorage.setItem(localKeyName(id), key);
  }
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
    return () => window.removeEventListener('storage', handler);
  }, [id]);
  if (id === 'local') return true;
  return !!(meta?.server_configured || localKey);
}
