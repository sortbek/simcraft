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

const NAME_LINE = /^(\w+)="(.+)"$/m;
const SPEC_LINE = /^spec=(\w+)/m;
const SERVER_LINE = /^server=(.+)$/m;
const REGION_LINE = /^region=(\w+)/m;

/** Parse a SimC addon export; returns null when no class line is present.
 *  Side effect: when name + realm are present, persists them under
 *  `LAST_CHARACTER_KEY` so navigation doesn't lose character context. Single
 *  write site avoids components fighting over the key. */
export function parseCharacterInfo(input: string): CharacterInfo | null {
  if (!input) return null;
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
