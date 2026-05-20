/**
 * Parse the standard "class=NAME" / "spec=" / "server=" / "region=" lines
 * out of a SimC export. Returns null if no class line is present.
 *
 * When both name and realm are found, the result is also persisted to
 * localStorage under `simhammer_last_character` so the History/Sims views
 * can scope to the most-recently-seen character even before the user has
 * pasted an export this session.
 *
 * Consolidates a helper that previously lived in four files
 * (TopBar, SidebarCharacter, /quick-sim, /sims).
 */
export interface CharacterInfo {
  className: string;
  name: string;
  spec: string;
  realm: string | null;
  region: string;
}

export const LAST_CHARACTER_KEY = 'simhammer_last_character';

export function parseCharacterInfo(input: string): CharacterInfo | null {
  if (!input) return null;
  const nameMatch = input.match(/^(\w+)="(.+)"$/m);
  if (!nameMatch) return null;
  const specMatch = input.match(/^spec=(\w+)/m);
  const realmMatch = input.match(/^server=(.+)$/m);
  const regionMatch = input.match(/^region=(\w+)/m);

  const info: CharacterInfo = {
    className: nameMatch[1],
    name: nameMatch[2],
    spec: specMatch?.[1] || 'unknown',
    realm: realmMatch?.[1] || null,
    region: regionMatch?.[1] || 'eu',
  };

  if (info.name && info.realm) {
    try {
      localStorage.setItem(
        LAST_CHARACTER_KEY,
        JSON.stringify({ name: info.name, realm: info.realm }),
      );
    } catch {
      // ignore quota / privacy errors
    }
  }
  return info;
}

/** Read the persisted last character (name + realm). Returns null if absent
 * or unparseable. */
export function loadLastCharacter(): { name: string; realm: string } | null {
  try {
    const stored = localStorage.getItem(LAST_CHARACTER_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (typeof parsed?.name === 'string' && typeof parsed?.realm === 'string') {
      return { name: parsed.name, realm: parsed.realm };
    }
  } catch {
    // ignore
  }
  return null;
}
