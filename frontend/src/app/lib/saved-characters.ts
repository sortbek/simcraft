import { API_URL, fetchJson, postJson } from './api';

export interface SavedCharacter {
  id: string;
  name: string;
  realm: string;
  class: string;
  spec: string;
  simc_input: string;
  updated_at: string;
}

export async function getCharacters(): Promise<SavedCharacter[]> {
  try {
    return await fetchJson<SavedCharacter[]>(`${API_URL}/api/characters`);
  } catch {
    return [];
  }
}

export async function upsertCharacter(simcInput: string): Promise<SavedCharacter | null> {
  try {
    return await fetchJson<SavedCharacter>(`${API_URL}/api/characters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ simc_input: simcInput }),
    });
  } catch {
    return null;
  }
}

export async function deleteCharacter(id: string): Promise<void> {
  await fetch(`${API_URL}/api/characters/${id}`, { method: 'DELETE' });
}

/** Fetch a character from the Blizzard armory and convert it to a SimC profile
 *  string. Throws (via `fetchJson`) on not-found / armory failure so the caller
 *  can surface the error message. Persistence is left to the normal SimC import
 *  path once the user applies the returned string. */
export async function fetchArmoryCharacter(
  region: string,
  realm: string,
  name: string
): Promise<{ simc_input: string }> {
  return postJson<{ simc_input: string }>('/api/armory/import', { region, realm, name });
}

export interface SavedTalentBuild {
  id: string;
  character_id: string;
  spec: string;
  name: string;
  talent_string: string;
}

export async function getTalentBuilds(characterId: string): Promise<SavedTalentBuild[]> {
  try {
    return await fetchJson<SavedTalentBuild[]>(`${API_URL}/api/characters/${characterId}/talents`);
  } catch {
    return [];
  }
}

export async function deleteTalentBuild(id: string): Promise<void> {
  await fetch(`${API_URL}/api/talent-builds/${id}`, { method: 'DELETE' });
}
