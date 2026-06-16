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

export async function refreshRoster(rosterId: string): Promise<RosterMember[]> {
  try {
    return await fetchJson<RosterMember[]>(`${API_URL}/api/rosters/${rosterId}/refresh`, { method: 'POST' });
  } catch {
    return [];
  }
}

export async function refreshMember(rosterId: string, memberId: string): Promise<RosterMember[]> {
  try {
    return await fetchJson<RosterMember[]>(`${API_URL}/api/rosters/${rosterId}/members/${memberId}/refresh`, { method: 'POST' });
  } catch {
    return [];
  }
}

export interface ReportPlayer {
  member_id: string;
  name: string;
  class: string;
  spec: string;
  base_dps: number;
  status: string;
}

export interface ReportItemResult {
  member_id: string;
  dps: number;
  upgrade_pct: number;
  abs_gain: number;
  is_downgrade: boolean;
}

export interface ReportItem {
  boss: string;
  item_id: number;
  name: string;
  slot: string;
  ilevel: number;
  results: ReportItemResult[];
}

export interface RosterReport {
  roster_id: string;
  instance_id: number;
  difficulty: string;
  players: ReportPlayer[];
  items: ReportItem[];
}

export interface RunStatus {
  status: string;
  progress_pct?: number;
  done?: number;
  total?: number;
  report?: RosterReport;
}

export async function startQuickSim(simcInput: string): Promise<{ id: string } | null> {
  try {
    return await fetchJson(`${API_URL}/api/sim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ simc_input: simcInput, sim_type: 'quick' }),
    });
  } catch {
    return null;
  }
}

export interface RunOptions {
  target_error?: number;
  iterations?: number;
  fight_style?: string;
  upgrade_level?: number;
  encounters?: number[];
}

export async function startRun(
  rosterId: string,
  instanceId: number,
  difficulty: string,
  opts: RunOptions = {}
): Promise<{ run_id: string } | null> {
  try {
    return await fetchJson(`${API_URL}/api/rosters/${rosterId}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance_id: instanceId, difficulty, ...opts }),
    });
  } catch {
    return null;
  }
}

export async function getRun(runId: string): Promise<RunStatus | null> {
  try {
    return await fetchJson(`${API_URL}/api/rosters/runs/${runId}`);
  } catch {
    return null;
  }
}
