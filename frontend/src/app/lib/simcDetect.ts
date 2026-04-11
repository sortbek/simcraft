/** Adler-32 checksum matching the SimC addon's implementation.
 *  The Lua addon processes raw UTF-8 bytes, so we must do the same. */
function adler32(s: string): number {
  const prime = 65521;
  let s1 = 1;
  let s2 = 0;
  const bytes = new TextEncoder().encode(s);
  for (let i = 0; i < bytes.length; i++) {
    s1 = (s1 + bytes[i]) % prime;
    s2 = (s2 + s1) % prime;
  }
  return ((s2 << 16) | s1) >>> 0;
}

/** Validate the SimC addon checksum. Returns null if no checksum present. */
export function validateChecksum(input: string): 'valid' | 'invalid' | null {
  const match = input.match(/^#\s*Checksum:\s*([0-9a-fA-F]+)\s*$/m);
  if (!match) return null;
  const expected = parseInt(match[1], 16);
  // The checksum covers everything before the checksum line.
  const idx = input.indexOf(match[0]);
  let body = input.substring(0, idx);
  // Normalize to \n first, then try both \n and \r\n
  body = body.replace(/\r\n/g, '\n');
  if (adler32(body) === expected) return 'valid';
  if (adler32(body.replace(/\n/g, '\r\n')) === expected) return 'valid';
  return 'invalid';
}

/**
 * Check if text looks like a valid SimC addon export.
 * Requires a class line, spec, level, and a valid checksum.
 */
export function isValidSimcExport(text: string): boolean {
  if (!text || text.length < 50) return false;
  const hasClass = /^\w+="[^"]+"/m.test(text);
  const hasSpec = /^spec=\w+/m.test(text);
  const hasLevel = /^level=\d+/m.test(text);
  const checksum = validateChecksum(text);
  return hasClass && hasSpec && hasLevel && checksum === 'valid';
}

const GEAR_SLOT_RE =
  /^#?\s*(head|neck|shoulder|back|chest|wrist|hands|waist|legs|feet|finger1|finger2|trinket1|trinket2|main_hand|off_hand)=(.+)/i;

interface BagItem {
  slot: string;
  line: string;
}

/**
 * Parse bag items from a SimC export.
 * Bag items are commented-out gear lines (starting with #).
 * Equipped items are uncommented gear lines.
 */
function parseBagItems(simcInput: string): BagItem[] {
  const items: BagItem[] = [];
  for (const rawLine of simcInput.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('#')) continue;
    const clean = line.replace(/^#+\s*/, '');
    const match = clean.match(GEAR_SLOT_RE);
    if (match) {
      items.push({ slot: match[1].toLowerCase(), line: clean });
    }
  }
  return items;
}

/**
 * Diff bag items between two SimC exports.
 * Returns items present in the new export but not in the old one.
 */
export function diffBagItems(
  oldSimc: string,
  newSimc: string
): { added: string[]; removed: string[] } {
  const oldItems = new Set(parseBagItems(oldSimc).map((i) => i.line));
  const newItems = new Set(parseBagItems(newSimc).map((i) => i.line));

  const added: string[] = [];
  const removed: string[] = [];

  for (const line of newItems) {
    if (!oldItems.has(line)) added.push(line);
  }
  for (const line of oldItems) {
    if (!newItems.has(line)) removed.push(line);
  }

  return { added, removed };
}

/**
 * Extract an item name from a SimC item line.
 * e.g. "head=,id=12345,..." -> tries to find a readable name, falls back to slot.
 */
export function itemNameFromLine(line: string): string {
  const slotMatch = line.match(/^(\w+)=/);
  const nameMatch = line.match(/name=([^,]+)/);
  if (nameMatch) return nameMatch[1].replace(/_/g, ' ');
  return slotMatch?.[1]?.replace(/_/g, ' ') ?? 'Unknown item';
}

/**
 * Check if the meaningful content of two SimC exports differs.
 * Ignores comment-only lines and whitespace differences.
 */
export function hasSimcChanged(oldSimc: string, newSimc: string): boolean {
  if (!oldSimc && !newSimc) return false;
  if (!oldSimc || !newSimc) return true;

  const normalize = (s: string) =>
    s
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .sort()
      .join('\n');

  return normalize(oldSimc) !== normalize(newSimc);
}
