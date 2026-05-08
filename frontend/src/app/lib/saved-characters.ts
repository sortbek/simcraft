import { API_URL, fetchJson } from './api';

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
