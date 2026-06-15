import { API_URL, fetchJson } from './api';

export interface Roster {
  id: string;
  name: string;
  region: string;
  created_at: string;
  updated_at: string;
}

export interface RosterMember {
  id: string;
  roster_id: string;
  name: string;
  realm: string;
  class: string;
  spec: string;
  source_simc: string;
  armory_status: string;
  item_level: number;
  updated_at: string;
}

export async function getRosters(): Promise<Roster[]> {
  try {
    return await fetchJson<Roster[]>(`${API_URL}/api/rosters`);
  } catch {
    return [];
  }
}

export async function createRoster(name: string, region: string): Promise<Roster | null> {
  try {
    return await fetchJson<Roster>(`${API_URL}/api/rosters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, region }),
    });
  } catch {
    return null;
  }
}

export async function deleteRoster(id: string): Promise<void> {
  await fetch(`${API_URL}/api/rosters/${id}`, { method: 'DELETE' });
}

export async function getMembers(id: string): Promise<RosterMember[]> {
  try {
    return await fetchJson<RosterMember[]>(`${API_URL}/api/rosters/${id}/members`);
  } catch {
    return [];
  }
}

export async function importMembers(id: string, text: string): Promise<RosterMember[]> {
  try {
    return await fetchJson<RosterMember[]>(`${API_URL}/api/rosters/${id}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch {
    return [];
  }
}

export async function deleteMember(rosterId: string, memberId: string): Promise<void> {
  await fetch(`${API_URL}/api/rosters/${rosterId}/members/${memberId}`, { method: 'DELETE' });
}
