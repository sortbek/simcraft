// API URL detection: in Electron, the backend serves the frontend on the
// same origin, so window.location.origin always points at the right backend
// (matters when the Electron main process falls back to an ephemeral port
// because 17384 was already in use — see desktop/src/main/backend.js).
export const API_URL =
  typeof window !== 'undefined' && window.electronAPI
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_API_URL ?? '');

/** Fetch JSON with consistent error handling. Throws on non-ok responses. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Server error ${res.status}`);
  }
  return res.json();
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

/** Resume a paused sim. Delegates to backend resume_job which dispatches by phase. */
export async function resumeSim(jobId: string): Promise<void> {
  await fetchJson<unknown>(`${API_URL}/api/sim/${jobId}/resume`, { method: 'POST' });
}

export type JobActiveStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface JobActiveSummary {
  id: string;
  status: JobActiveStatus;
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
}

/** Active sims (pending/running/paused) + up to 20 most recent terminal jobs. */
export async function fetchActiveJobs(): Promise<JobActiveSummary[]> {
  return fetchJson<JobActiveSummary[]>(`${API_URL}/api/jobs/active`);
}
