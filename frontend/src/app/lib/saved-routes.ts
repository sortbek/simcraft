import { API_URL, fetchJson } from './api';

export interface SavedRoute {
  id: string;
  name: string;
  mdt_string: string;
  /** Regenerated SimC fight definition for edited routes (null for legacy bookmarks). */
  simc?: string | null;
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
  mdtString: string,
  simc?: string
): Promise<SavedRoute> {
  return fetchJson<SavedRoute>(`${API_URL}/api/routes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mdt_string: mdtString, simc }),
  });
}

export async function deleteSavedRoute(id: string): Promise<void> {
  await fetch(`${API_URL}/api/routes/${id}`, { method: 'DELETE' });
}
