import { apiDelete, apiUrl, fetchJson, isDesktop, postJson } from './api';
import {
  DEFAULT_EXPANSION_OPTIONS,
  DEFAULT_PROFILE_DATA,
  DEFAULT_RAID_BUFFS,
  normalizeSimcBranch,
  parseRotationMode,
} from './sim-config-defaults';
import { readStoredJson } from './storage';
import type { FightScenario } from './types';

export const PROFILE_SCHEMA_VERSION = 1;

/** Snapshot of the shared sim config. Derived from the defaults so the field
 *  list lives in exactly one place. */
export type SimProfileData = typeof DEFAULT_PROFILE_DATA;

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

/** Consumables only. An empty value means "SimC default", which is exactly what
 *  an absent key means — keeping it would make `{food:''}` and `{}` compare
 *  unequal and light the dirty dot on two identical configs. */
export function stringRecord(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string' && v !== '') out[k] = v;
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

/** The config's own fight setup. A loaded route forces `fightStyle` and clears
 *  `scenarios`, so the config's values are held aside for the route's lifetime
 *  and restored when it's cleared — otherwise the forced values read as profile
 *  drift and a Save writes them over the profile's real setup. */
export interface FightSetup {
  fightStyle: string;
  scenarios: FightScenario[];
}

export function parseFightSetup(raw: unknown): FightSetup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.fightStyle !== 'string') return null;
  return { fightStyle: r.fightStyle, scenarios: sanitizeScenarios(r.scenarios) };
}

const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Positive integer, matching `readStoredPositiveInt` (0 = "not set"). The
 *  reload path re-reads these from localStorage and applies the same rule, so a
 *  blob that disagrees would leave the config permanently unable to read clean. */
const posInt = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback;

/** Non-negative integer — `threads: 0` is a real value ("auto"). */
const countInt = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback;

/** Strictly positive, matching the restore path's `n > 0` check. */
const posNum = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;

/** Fill defaults for missing/invalid fields so applying a profile is
 *  deterministic regardless of blob age. */
export function normalizeProfileData(raw: unknown): SimProfileData {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<SimProfileData>;
  const def = DEFAULT_PROFILE_DATA;
  return {
    // Blobs never carry 'DungeonRoute' (captureProfileData maps it away — a
    // stored one is never honorable), so map it here too for imported blobs.
    fightStyle:
      d.fightStyle === 'DungeonRoute' ? def.fightStyle : str(d.fightStyle, def.fightStyle),
    fightLength: posNum(d.fightLength, def.fightLength),
    targetCount: posInt(d.targetCount, def.targetCount),
    scenarios: sanitizeScenarios(d.scenarios),
    iterations: posInt(d.iterations, def.iterations),
    targetError: posNum(d.targetError, def.targetError),
    threads: countInt(d.threads, def.threads),
    rotationMode: parseRotationMode(d.rotationMode),
    customApl: str(d.customApl, def.customApl),
    // Per-key merge: buffs/expansion options gain entries over seasons, so an
    // old blob gets new keys defaulted instead of dropped; mistyped values
    // (e.g. an imported "false" string) fall back to the default too.
    raidBuffs: booleanRecord(d.raidBuffs, DEFAULT_RAID_BUFFS),
    consumables: stringRecord(d.consumables),
    expansionOptions: booleanRecord(d.expansionOptions, DEFAULT_EXPANSION_OPTIONS),
    // Same normalization the live setter applies, so an applied profile isn't
    // instantly dirty from a pinned branch tag.
    simcBranch: normalizeSimcBranch(str(d.simcBranch, def.simcBranch)),
    simcHeader: str(d.simcHeader, def.simcHeader),
    simcBasePlayer: str(d.simcBasePlayer, def.simcBasePlayer),
    simcRaidActors: str(d.simcRaidActors, def.simcRaidActors),
    simcPostCombos: str(d.simcPostCombos, def.simcPostCombos),
    simcFooter: str(d.simcFooter, def.simcFooter),
    parallelProfilesets: bool(d.parallelProfilesets, def.parallelProfilesets),
    triageMaxBatchProfilesets: posInt(d.triageMaxBatchProfilesets, def.triageMaxBatchProfilesets),
    statWeights: bool(d.statWeights, def.statWeights),
  };
}

// ---------- storage backends ----------
// Desktop: SQLite via /api/profiles (rows carry the blob as a JSON string).
// Web: localStorage — per-browser separation on shared instances, no server surface.

const STORAGE_KEY = 'simhammer_sim_profiles';

/** A blob written by a newer schema can't be applied faithfully; callers either
 *  disable it in the picker or refuse to restore it. One definition so the
 *  gate can't drift between the picker, apply, restore and import. */
export function isProfileSupported(profile: { version: number }): boolean {
  return profile.version <= PROFILE_SCHEMA_VERSION;
}

/** The built-in "Default" profile: always listed first in the picker, never
 *  stored as a row. The drawer disables save/rename/delete for it — diverge
 *  and "Save as" to turn the current config into a real profile. The UI shows
 *  a localized name keyed off this id; `name` is only a fallback. */
export const DEFAULT_PROFILE_ID = '__default__';

export function isDefaultProfile(p: { id: string }): boolean {
  return p.id === DEFAULT_PROFILE_ID;
}

/** Fresh instance per call — `data` is a normalized copy, so applying it can't
 *  alias the shared DEFAULT_PROFILE_DATA records. */
export function defaultProfile(): SimProfile {
  return {
    id: DEFAULT_PROFILE_ID,
    name: 'Default',
    version: PROFILE_SCHEMA_VERSION,
    updated_at: '',
    data: normalizeProfileData({}),
  };
}

/** Coerce an untrusted stored record into a `SimProfile`, or `null` if it isn't
 *  one. Both the profile list and the persisted active profile cross this
 *  boundary, so they must agree on the shape — a listed entry that the restore
 *  path rejects would silently drop the active profile on reload. */
export function parseStoredProfile(raw: unknown): SimProfile | null {
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.name !== 'string') {
    return null;
  }
  return {
    id: p.id,
    name: p.name,
    version: num(p.version, PROFILE_SCHEMA_VERSION),
    updated_at: str(p.updated_at, ''),
    data: normalizeProfileData(p.data),
  };
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

/** POST the shared create/update endpoint. The response is echoed rather than
 *  re-normalized — normalization merges defaults in, which would make a fresh
 *  save compare dirty against the unmerged live state. */
async function postProfile(
  body: { id?: string; name: string },
  data: SimProfileData
): Promise<SimProfile> {
  const row = await postJson<ApiProfileRow>('/api/profiles', {
    ...body,
    data: JSON.stringify({ version: PROFILE_SCHEMA_VERSION, data }),
  });
  return {
    id: row.id,
    name: row.name,
    version: PROFILE_SCHEMA_VERSION,
    updated_at: row.updated_at,
    data,
  };
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
    .map(parseStoredProfile)
    .filter((p): p is SimProfile => p !== null);
}

// ---------- public API ----------

/** Throws on a desktop backend failure. Deliberately not swallowed: an empty
 *  list renders as "no saved profiles yet", so a transient DB/API error would
 *  invite the user to recreate profiles that still exist and then collide. */
export async function listProfiles(): Promise<SimProfile[]> {
  if (isDesktop()) {
    const rows = await fetchJson<ApiProfileRow[]>(apiUrl('/api/profiles'));
    return rows.map(fromApiRow);
  }
  return readWebProfiles().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function createProfile(name: string, data: SimProfileData): Promise<SimProfile> {
  if (isDesktop()) return postProfile({ name }, data);
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
    return postProfile({ id: profile.id, name: profile.name }, profile.data);
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

// ---------- export / import strings ----------
// Profiles travel as copy/paste strings (the SimC/MDT idiom): a prefix carrying
// the wire-format version, then base64url of the JSON payload — deflated when
// CompressionStream exists (everywhere modern; keeps expert-field-heavy
// profiles under Discord's message limit), raw otherwise. Import accepts both.

const EXPORT_PREFIX_DEFLATE = 'SHP1.';
const EXPORT_PREFIX_RAW = 'SHP1U.';

interface ProfileExport {
  name: string;
  version: number;
  updated_at: string;
  data: SimProfileData;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  // atob's forgiving-base64 accepts unpadded input.
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Profile strings are pasted from chat, so the encoded side is untrusted input.
 *  A few hundred KB of crafted deflate expands to gigabytes, so the inflated
 *  size is capped *while streaming* — buffering first and checking after is
 *  exactly the allocation we need to avoid. A real export is far below this. */
const MAX_ENCODED_CHARS = 512 * 1024;
const MAX_DECODED_BYTES = 1024 * 1024;

/** Thrown for input that blows the cap, so the UI can say so rather than
 *  reporting a generic parse failure. */
class ProfileTooLargeError extends Error {}

async function pipeBytes(
  bytes: Uint8Array<ArrayBuffer>,
  transform: CompressionStream | DecompressionStream,
  limit?: number
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  if (limit === undefined) return new Uint8Array(await new Response(stream).arrayBuffer());

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw new ProfileTooLargeError('inflated profile exceeds cap');
      chunks.push(value);
    }
  } finally {
    // Releases the decompressor: on the throw path this stops it inflating the
    // rest of the payload in the background.
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Encode the profile minus its id (import mints a new one) as a paste string. */
export async function encodeProfileString(profile: SimProfile): Promise<string> {
  const payload: ProfileExport = {
    name: profile.name,
    version: profile.version,
    updated_at: profile.updated_at,
    data: profile.data,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === 'undefined') {
    return EXPORT_PREFIX_RAW + bytesToBase64Url(bytes);
  }
  return (
    EXPORT_PREFIX_DEFLATE +
    bytesToBase64Url(await pipeBytes(bytes, new CompressionStream('deflate-raw')))
  );
}

/** Why a paste couldn't be imported. Distinct cases so the UI doesn't tell a
 *  user with a newer-schema string that their paste was malformed — they'd retry
 *  the paste instead of updating SimHammer. */
export type ProfileDecodeError = 'invalid' | 'unsupported' | 'tooLarge';

export type ProfileDecodeResult =
  | { ok: true; name: string; data: SimProfileData }
  | { ok: false; error: ProfileDecodeError };

/** Decode a pasted export string. */
export async function decodeProfileString(text: string): Promise<ProfileDecodeResult> {
  try {
    const trimmed = text.trim();
    if (trimmed.length > MAX_ENCODED_CHARS) return { ok: false, error: 'tooLarge' };
    let bytes: Uint8Array;
    if (trimmed.startsWith(EXPORT_PREFIX_DEFLATE)) {
      bytes = await pipeBytes(
        base64UrlToBytes(trimmed.slice(EXPORT_PREFIX_DEFLATE.length)),
        new DecompressionStream('deflate-raw'),
        MAX_DECODED_BYTES
      );
    } else if (trimmed.startsWith(EXPORT_PREFIX_RAW)) {
      bytes = base64UrlToBytes(trimmed.slice(EXPORT_PREFIX_RAW.length));
    } else {
      return { ok: false, error: 'invalid' };
    }
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ProfileExport>;
    if (typeof raw.name !== 'string' || !raw.name.trim()) return { ok: false, error: 'invalid' };
    if (typeof raw.version !== 'number') return { ok: false, error: 'invalid' };
    if (!isProfileSupported({ version: raw.version })) return { ok: false, error: 'unsupported' };
    if (!raw.data || typeof raw.data !== 'object') return { ok: false, error: 'invalid' };
    return { ok: true, name: raw.name.trim(), data: normalizeProfileData(raw.data) };
  } catch (e) {
    return { ok: false, error: e instanceof ProfileTooLargeError ? 'tooLarge' : 'invalid' };
  }
}
