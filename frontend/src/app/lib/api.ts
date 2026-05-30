// API URL detection: in Electron, the backend serves the frontend on the
// same origin, so window.location.origin always points at the right backend
// (matters when the Electron main process falls back to an ephemeral port
// because 17384 was already in use — see desktop/src/main/backend.js).
export const API_URL =
  typeof window !== 'undefined' && window.electronAPI
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_API_URL ?? '');

/** Build provider key headers from localStorage, scoped by the user's
 *  Compute selection so we don't leak unrelated provider keys to the backend.
 *
 *  - `"local"`: no remote keys ever sent.
 *  - `"auto"` / `undefined`: all configured remote keys (backend chooses).
 *  - specific remote id (`"simmit"`, ...): just that one key.
 *
 *  Scans `simhammer.provider.<id>.api_key` so adding a new remote provider
 *  needs zero changes here. */
export function providerKeyHeaders(computeChoice?: string): Record<string, string> {
  if (typeof window === 'undefined') return {};
  if (computeChoice === 'local') return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const storageKey = window.localStorage.key(i);
    if (!storageKey) continue;
    const m = storageKey.match(/^simhammer\.provider\.(.+)\.api_key$/);
    if (!m) continue;
    const id = m[1];
    if (id === 'local') continue;
    // Specific remote selection: only that id's key.
    if (computeChoice && computeChoice !== 'auto' && computeChoice !== id) continue;
    const value = window.localStorage.getItem(storageKey);
    if (value) out[`X-Provider-${id}-Key`] = value;
  }
  return out;
}

/** Fetch JSON with consistent error handling. Throws on non-ok responses. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Server error ${res.status}`);
  }
  return res.json();
}

/** Prefix a path with the resolved API base. Centralizes the `${API_URL}${path}`
 *  pattern so call sites stop hand-concatenating. */
export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

/** POST a JSON body and parse a JSON response, with the shared `fetchJson`
 *  error handling (throws `Error(detail || 'Server error N')` on non-ok). */
export function postJson<T>(
  path: string,
  body: unknown,
  init?: Omit<RequestInit, 'method' | 'body'>
): Promise<T> {
  return fetchJson<T>(apiUrl(path), {
    ...init,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    body: JSON.stringify(body),
  });
}

/** The shape returned by GET /api/sim/:id/input/preview */
export type SimInputPreview =
  | { mode: 'inline'; input: string }
  | {
      mode: 'streamed';
      base_profile: string;
      survivor_count: number;
      preview_profilesets: string[];
      note: string;
    };

/** Fetch the SimC input preview for a job (works for both inline and streamed jobs). */
export async function fetchSimInputPreview(jobId: string): Promise<SimInputPreview> {
  const res = await fetch(`${API_URL}/api/sim/${jobId}/input/preview`);
  if (!res.ok) throw new Error(`Failed to fetch input preview: ${res.status}`);
  return res.json();
}

/** Request that a running streamed-mode sim pause at the next checkpoint. */
export async function pauseSim(jobId: string): Promise<void> {
  await fetchJson<unknown>(`${API_URL}/api/sim/${jobId}/pause`, { method: 'POST' });
}

/** Resume a paused sim. Delegates to backend resume_job which dispatches by phase.
 *  Attaches all configured provider keys (resume doesn't know the user's original
 *  compute choice, so 'auto' sends every key — same behavior the submit path uses)
 *  so a BYO-key web user can resume a cloud run. */
export async function resumeSim(jobId: string): Promise<void> {
  await fetchJson<unknown>(`${API_URL}/api/sim/${jobId}/resume`, {
    method: 'POST',
    headers: providerKeyHeaders(),
  });
}

/** Re-run a single Top Gear result row as a high-precision Quick Sim.
 * `sourceJobId` is the parent Top Gear job; `comboId` is the integer
 * from the row's "Combo N" name. Returns the new sim's job_id. */
export async function simRow(sourceJobId: string, comboId: number): Promise<string> {
  const data = await fetchJson<{ id: string }>(`${API_URL}/api/sim/${sourceJobId}/sim-row`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ combo_id: comboId }),
  });
  return data.id;
}

export type JobStatus = 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

export interface JobOverviewSummary {
  id: string;
  status: JobStatus;
  sim_type: string;
  created_at: string;
  progress_pct: number;
  progress_stage: string | null;
  progress_detail: string | null;
  player_name: string | null;
  player_class: string | null;
  fight_style: string;
  simc_input_mode: 'inline' | 'streamed';
  pause_requested: boolean;
  error_message: string | null;
  iterations: number;
  realm: string | null;
  region: string | null;
  dps: number | null;
  batch_id: string | null;
  provider_id: string;
}

/** Active sims (pending/running/paused) + up to 20 most recent terminal jobs. */
export async function fetchActiveJobs(): Promise<JobOverviewSummary[]> {
  return fetchJson<JobOverviewSummary[]>(`${API_URL}/api/jobs?status=active`);
}

/** Full job list for the /sims overview's All / By-character views.
 * Optional player+realm filter. Returns up to ~200 jobs. */
export async function fetchAllJobs(opts?: {
  player?: string;
  realm?: string;
  limit?: number;
}): Promise<JobOverviewSummary[]> {
  const params = new URLSearchParams({ status: 'all' });
  if (opts?.player) params.set('player', opts.player);
  if (opts?.realm) params.set('realm', opts.realm);
  if (opts?.limit) params.set('limit', String(opts.limit));
  return fetchJson<JobOverviewSummary[]>(`${API_URL}/api/jobs?${params}`);
}

/** Delete a terminal-state job (Done/Failed/Cancelled). Active jobs must
 * be cancelled first. Also removes per-job rows in combo_metadata,
 * combo_dedup, and triage_batches. */
export async function deleteJob(jobId: string): Promise<void> {
  await fetchJson<unknown>(`${API_URL}/api/jobs/${jobId}`, { method: 'DELETE' });
}
