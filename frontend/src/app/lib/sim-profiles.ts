import { API_URL, apiDelete, fetchJson } from './api';
import {
  DEFAULT_EXPANSION_OPTIONS,
  DEFAULT_RAID_BUFFS,
  normalizeSimcBranch,
} from './sim-config-defaults';
import { readStoredJson } from './storage';
import { TRIAGE_BATCH_DEFAULT } from './triageBatch';
import type { FightScenario } from './types';
import type { RotationMode } from '../components/sim-config/SimContext';

export const PROFILE_SCHEMA_VERSION = 1;

/** Snapshot of the shared sim config (spec field list). */
export interface SimProfileData {
  fightStyle: string;
  fightLength: number;
  targetCount: number;
  scenarios: FightScenario[];
  iterations: number;
  targetError: number;
  threads: number;
  rotationMode: RotationMode;
  customApl: string;
  raidBuffs: Record<string, boolean>;
  consumables: Record<string, string>;
  expansionOptions: Record<string, boolean>;
  simcBranch: string;
  simcHeader: string;
  simcBasePlayer: string;
  simcRaidActors: string;
  simcPostCombos: string;
  simcFooter: string;
  parallelProfilesets: boolean;
  triageMaxBatchProfilesets: number;
  statWeights: boolean;
}

export interface SimProfile {
  id: string;
  name: string;
  version: number;
  updated_at: string;
  data: SimProfileData;
}

/** Keep only well-typed entries — profile blobs cross the import boundary, so
 *  nested values can be anything. Defaults merge per-key underneath. Exported:
 *  SimContext's restore uses it too, so the live state and normalized blobs
 *  always agree on default merging (disagreement = phantom dirty dots). */
export function booleanRecord(
  raw: unknown,
  defaults: Record<string, boolean>
): Record<string, boolean> {
  const out = { ...defaults };
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

export function stringRecord(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
  }
  return out;
}

function sanitizeScenarios(raw: unknown): FightScenario[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is FightScenario =>
      !!s &&
      typeof s === 'object' &&
      typeof (s as FightScenario).id === 'string' &&
      typeof (s as FightScenario).fightStyle === 'string' &&
      typeof (s as FightScenario).targetCount === 'number' &&
      typeof (s as FightScenario).fightLength === 'number'
  );
}

/** Fill defaults for missing/invalid fields so applying a profile is
 *  deterministic regardless of blob age. */
export function normalizeProfileData(raw: unknown): SimProfileData {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<SimProfileData>;
  return {
    // Blobs never carry 'DungeonRoute' (captureProfileData maps it away — a
    // stored one is never honorable), so map it here too for imported blobs.
    fightStyle:
      typeof d.fightStyle === 'string' && d.fightStyle !== 'DungeonRoute'
        ? d.fightStyle
        : 'Patchwerk',
    fightLength: typeof d.fightLength === 'number' ? d.fightLength : 300,
    targetCount: typeof d.targetCount === 'number' ? d.targetCount : 1,
    scenarios: sanitizeScenarios(d.scenarios),
    iterations: typeof d.iterations === 'number' ? d.iterations : 100000,
    targetError: typeof d.targetError === 'number' ? d.targetError : 0.1,
    threads: typeof d.threads === 'number' ? d.threads : 0,
    rotationMode:
      d.rotationMode === 'assisted_combat' || d.rotationMode === 'one_button'
        ? d.rotationMode
        : 'default',
    customApl: typeof d.customApl === 'string' ? d.customApl : '',
    // Per-key merge: buffs/expansion options gain entries over seasons, so an
    // old blob gets new keys defaulted instead of dropped; mistyped values
    // (e.g. an imported "false" string) fall back to the default too.
    raidBuffs: booleanRecord(d.raidBuffs, DEFAULT_RAID_BUFFS),
    consumables: stringRecord(d.consumables),
    expansionOptions: booleanRecord(d.expansionOptions, DEFAULT_EXPANSION_OPTIONS),
    // Same normalization the live setter applies, so an applied profile isn't
    // instantly dirty from a pinned branch tag.
    simcBranch: normalizeSimcBranch(typeof d.simcBranch === 'string' ? d.simcBranch : ''),
    simcHeader: typeof d.simcHeader === 'string' ? d.simcHeader : '',
    simcBasePlayer: typeof d.simcBasePlayer === 'string' ? d.simcBasePlayer : '',
    simcRaidActors: typeof d.simcRaidActors === 'string' ? d.simcRaidActors : '',
    simcPostCombos: typeof d.simcPostCombos === 'string' ? d.simcPostCombos : '',
    simcFooter: typeof d.simcFooter === 'string' ? d.simcFooter : '',
    parallelProfilesets: typeof d.parallelProfilesets === 'boolean' ? d.parallelProfilesets : true,
    triageMaxBatchProfilesets:
      typeof d.triageMaxBatchProfilesets === 'number'
        ? d.triageMaxBatchProfilesets
        : TRIAGE_BATCH_DEFAULT,
    statWeights: typeof d.statWeights === 'boolean' ? d.statWeights : false,
  };
}

// ---------- storage backends ----------
// Desktop: SQLite via /api/profiles (rows carry the blob as a JSON string).
// Web: localStorage — per-browser separation on shared instances, no server surface.

const STORAGE_KEY = 'simhammer_sim_profiles';

function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI;
}

interface ApiProfileRow {
  id: string;
  name: string;
  data: string;
  created_at: string;
  updated_at: string;
}

function fromApiRow(row: ApiProfileRow): SimProfile {
  let version = PROFILE_SCHEMA_VERSION;
  let data: unknown = {};
  try {
    const blob = JSON.parse(row.data) as { version?: number; data?: unknown };
    if (typeof blob.version === 'number') version = blob.version;
    data = blob.data;
  } catch {}
  return {
    id: row.id,
    name: row.name,
    version,
    updated_at: row.updated_at,
    data: normalizeProfileData(data),
  };
}

function toApiBlob(profile: { version: number; data: SimProfileData }): string {
  return JSON.stringify({ version: profile.version, data: profile.data });
}

/** Raw stored array. Mutations operate on this — never on the normalized view —
 *  so entries this app version doesn't fully understand (newer schema) are
 *  passed through byte-for-byte instead of being rewritten with stripped data. */
function readWebRaw(): unknown[] {
  const raw = readStoredJson<unknown>(STORAGE_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

function writeWebRaw(entries: unknown[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function entryId(e: unknown): string | null {
  return e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string'
    ? (e as { id: string }).id
    : null;
}

/** Normalized read view of the store (listing and lookups only). */
function readWebProfiles(): SimProfile[] {
  return readWebRaw()
    .filter(
      (p): p is Record<string, unknown> =>
        entryId(p) !== null && typeof (p as { name?: unknown }).name === 'string'
    )
    .map((p) => ({
      id: p.id as string,
      name: p.name as string,
      version: typeof p.version === 'number' ? p.version : PROFILE_SCHEMA_VERSION,
      updated_at: typeof p.updated_at === 'string' ? p.updated_at : '',
      data: normalizeProfileData(p.data),
    }));
}

// ---------- public API ----------

export async function listProfiles(): Promise<SimProfile[]> {
  try {
    if (isDesktop()) {
      const rows = await fetchJson<ApiProfileRow[]>(`${API_URL}/api/profiles`);
      return rows.map(fromApiRow);
    }
    return readWebProfiles().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  } catch {
    return [];
  }
}

export async function createProfile(name: string, data: SimProfileData): Promise<SimProfile> {
  if (isDesktop()) {
    const row = await fetchJson<ApiProfileRow>(`${API_URL}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        data: toApiBlob({ version: PROFILE_SCHEMA_VERSION, data }),
      }),
    });
    // Echo the data we sent rather than re-normalizing the server row —
    // normalization merges defaults in, which would make a fresh save compare
    // dirty against the unmerged live state.
    return {
      id: row.id,
      name: row.name,
      version: PROFILE_SCHEMA_VERSION,
      updated_at: row.updated_at,
      data,
    };
  }
  const profile: SimProfile = {
    id: crypto.randomUUID(),
    name,
    version: PROFILE_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    data,
  };
  writeWebRaw([...readWebRaw(), profile]);
  return profile;
}

/** Save-over and rename both land here; the stored blob is always rewritten at
 *  the current schema version. */
export async function updateProfile(profile: SimProfile): Promise<SimProfile> {
  if (isDesktop()) {
    const row = await fetchJson<ApiProfileRow>(`${API_URL}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: profile.id,
        name: profile.name,
        data: toApiBlob({ version: PROFILE_SCHEMA_VERSION, data: profile.data }),
      }),
    });
    // Echo, don't re-normalize — see createProfile.
    return {
      id: row.id,
      name: row.name,
      version: PROFILE_SCHEMA_VERSION,
      updated_at: row.updated_at,
      data: profile.data,
    };
  }
  const entries = readWebRaw();
  if (!entries.some((e) => entryId(e) === profile.id)) {
    throw new Error('Profile not found');
  }
  const next: SimProfile = {
    ...profile,
    version: PROFILE_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
  };
  writeWebRaw(entries.map((e) => (entryId(e) === profile.id ? next : e)));
  return next;
}

export async function deleteProfile(id: string): Promise<void> {
  if (isDesktop()) {
    await apiDelete(`/api/profiles/${id}`);
    return;
  }
  writeWebRaw(readWebRaw().filter((e) => entryId(e) !== id));
}

// ---------- export / import ----------

interface ProfileExport {
  name: string;
  version: number;
  updated_at: string;
  data: SimProfileData;
}

/** Pretty-printed export payload — the profile minus its id (import mints a new one). */
export function exportProfileJson(profile: SimProfile): string {
  const payload: ProfileExport = {
    name: profile.name,
    version: profile.version,
    updated_at: profile.updated_at,
    data: profile.data,
  };
  return JSON.stringify(payload, null, 2);
}

/** Parse an exported profile file. `null` when the payload isn't a profile
 *  export or was written by a newer schema. */
export function parseProfileExport(text: string): { name: string; data: SimProfileData } | null {
  try {
    const raw = JSON.parse(text) as Partial<ProfileExport>;
    if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
    if (typeof raw.version !== 'number' || raw.version > PROFILE_SCHEMA_VERSION) return null;
    if (!raw.data || typeof raw.data !== 'object') return null;
    return { name: raw.name.trim(), data: normalizeProfileData(raw.data) };
  } catch {
    return null;
  }
}
