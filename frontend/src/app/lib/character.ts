/** Shared helpers for parsing the SimC export "name line" and persisting the
 * last-seen character to localStorage. */

export const LAST_CHARACTER_KEY = 'simhammer_last_character';

export interface CharacterInfo {
  /** Class identifier from the addon export (`hunter`, `paladin`, etc.). */
  className: string;
  /** Character name. */
  name: string;
  /** Spec identifier from the `spec=` line, or `"unknown"` when absent. */
  spec: string;
  /** Realm slug from `server=`, or `null` when absent. */
  realm: string | null;
  /** Region from `region=`, defaulting to `"eu"` when absent. */
  region: string;
}

/** SimC writes `server=grim_batol`; Blizzard's API wants `grim-batol` (apostrophes dropped). */
export function blizzardRealmSlug(realm: string): string {
  return realm
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[\s_]+/g, '-');
}

const NAME_LINE = /^(\w+)="(.+)"$/m;
const SPEC_LINE = /^spec=(\w+)/m;
const SERVER_LINE = /^server=(.+)$/m;
const REGION_LINE = /^region=(\w+)/m;

/** Parse a SimC addon export; returns null when no class line is present.
 *  Side effect: when name + realm are present, persists them under
 *  `LAST_CHARACTER_KEY` so navigation doesn't lose character context. Single
 *  write site avoids components fighting over the key. */
/** The MythicSim addon's JSON export, or null for anything else (SimC text, broken JSON). */
function mythicSimExport(input: string): Record<string, unknown> | null {
  if (!/^\s*\{/.test(input) || !input.includes('"mythicsim"')) return null;
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** A Forever character can have a second name, which the MythicSim addon writes as the realm.
 *  A real realm reads like "camwow eu5 realm 6 pvp": more than one word, or with digits. */
export function mythicSimName(name: unknown, realm: unknown): string {
  const first = typeof name === 'string' ? name.trim() : '';
  const second = typeof realm === 'string' ? realm.trim() : '';
  return second && /^[^\s\d_]+$/.test(second) ? `${first} ${second}` : first;
}

/** What the top bar shows of the pasted export: its first line, or the MythicSim character. */
export function exportPreview(input: string): string {
  const mythic = mythicSimExport(input);
  if (mythic) return `MythicSim · ${mythicSimName(mythic.name, mythic.realm)}`;
  return input.split('\n')[0].slice(0, 40) + (input.length > 40 ? '...' : '');
}

export function parseCharacterInfo(input: string): CharacterInfo | null {
  if (!input) return null;
  const mythic = mythicSimExport(input);
  if (mythic) {
    const extra = (mythic.mythicsim ?? {}) as Record<string, unknown>;
    const name = mythicSimName(mythic.name, mythic.realm);
    if (!name || typeof mythic.class !== 'string') return null;
    return {
      className: mythic.class.toLowerCase(),
      name,
      spec: 'unknown',
      realm: null,
      region: typeof extra.region === 'string' ? extra.region : 'eu',
    };
  }
  const nameMatch = input.match(NAME_LINE);
  if (!nameMatch) return null;
  const realm = input.match(SERVER_LINE)?.[1] ?? null;
  const name = nameMatch[2];
  if (name && realm) {
    try {
      localStorage.setItem(LAST_CHARACTER_KEY, JSON.stringify({ name, realm }));
    } catch {
      // localStorage may be unavailable (private mode, quota); not load-bearing.
    }
  }
  return {
    className: nameMatch[1],
    name,
    spec: input.match(SPEC_LINE)?.[1] ?? 'unknown',
    realm,
    region: input.match(REGION_LINE)?.[1] ?? 'eu',
  };
}

/** Read the most recently seen character from localStorage, if any. */
export function loadLastCharacter(): { name: string; realm: string } | null {
  try {
    const raw = localStorage.getItem(LAST_CHARACTER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.name === 'string' && typeof parsed?.realm === 'string') {
      return { name: parsed.name, realm: parsed.realm };
    }
  } catch {
    // corrupt JSON / quota errors — treat as no stored character
  }
  return null;
}
