import { API_URL, fetchJson } from './api';

export interface SavedRoute {
  id: string;
  name: string;
  mdt_string: string;
  /** Baked SimC (legacy rows). Newer rows regenerate from dungeon_idx + pulls. */
  simc?: string | null;
  /** Level-agnostic route: MDT dungeon index. */
  dungeon_idx?: number | null;
  /** Pull assignment as JSON `[[{enemy_idx, clone_idx}, ...], ...]`. */
  pulls?: string | null;
  created_at: string;
}

export async function getSavedRoutes(): Promise<SavedRoute[]> {
  try {
    return await fetchJson<SavedRoute[]>(`${API_URL}/api/routes`);
  } catch {
    return [];
  }
}

export async function saveRoute(
  name: string,
  opts: { mdtString?: string; simc?: string; dungeonIdx?: number; pulls?: string }
): Promise<SavedRoute> {
  return fetchJson<SavedRoute>(`${API_URL}/api/routes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mdt_string: opts.mdtString ?? '',
      simc: opts.simc,
      dungeon_idx: opts.dungeonIdx,
      pulls: opts.pulls,
    }),
  });
}

export async function deleteSavedRoute(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/routes/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Server error ${res.status}`);
  }
}
