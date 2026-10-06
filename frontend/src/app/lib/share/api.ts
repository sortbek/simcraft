import packageJson from '../../../../package.json';
import { API_URL, fetchJson } from '../api';
import type { SimResult } from '../simResultTypes';
import { SHARE_ORIGIN } from './link';
import type { ShareLookups } from './lookups';
import type { ShareSummary } from './summary';

export interface ShareMeta {
  appVersion: string;
  simcBuild: string | null;
  mode: string;
  simmedAt: string;
}
export interface SharePayload {
  v: number;
  requestVersion: number;
  mode: string;
  result: SimResult;
  request: Record<string, unknown> | null;
  simcInput: string;
  lookups?: ShareLookups;
}
export interface FetchedShare {
  meta: ShareMeta;
  summary: ShareSummary;
  payload: SharePayload;
}
export class ShareNotFoundError extends Error {}

export async function shareSim(
  jobId: string,
  summary: ShareSummary,
  simcBuild: string | null,
  lookups: ShareLookups
): Promise<string> {
  const data = await fetchJson<{ share_id: string }>(`${API_URL}/api/sim/${jobId}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary, appVersion: packageJson.version, simcBuild, lookups }),
  });
  return data.share_id;
}

export async function unshareSim(jobId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/sim/${jobId}/share`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Server error ${res.status}`);
  }
}

const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;

export async function gunzipBase64(
  b64: string,
  maxBytes = MAX_DECOMPRESSED_BYTES
): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Shared result is too large to open');
    }
    text += decoder.decode(value, { stream: true });
  }
}

export async function fetchShare(id: string): Promise<FetchedShare> {
  const res = await fetch(`${SHARE_ORIGIN}/api/share/${id}`);
  if (res.status === 404) throw new ShareNotFoundError();
  if (!res.ok) throw new Error(`simhammer.com returned ${res.status}`);
  const data = await res.json();
  return {
    meta: data.meta,
    summary: data.summary,
    payload: JSON.parse(await gunzipBase64(data.payload)),
  };
}
