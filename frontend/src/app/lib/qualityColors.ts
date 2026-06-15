/**
 * Single source of truth for WoW item-quality colors (was defined three times,
 * had drifted; those sites now re-export from here).
 *
 * Quality keys: 0 Poor · 1 Common · 2 Uncommon · 3 Rare · 4 Epic ·
 * 5 Legendary · 6 Artifact · 7 Heirloom.
 */

/** Inline hex colors (for `style={{ color }}` / borders). */
export const QUALITY_HEX: Record<number, string> = {
  0: '#9d9d9d',
  1: '#ffffff',
  2: '#1eff00',
  3: '#0070dd',
  4: '#a335ee',
  5: '#ff8000',
  6: '#e6cc80',
  7: '#00ccff',
};

/** Tailwind text-color classes (for class-based rendering, e.g. loot table). */
export const QUALITY_TEXT_CLASS: Record<number, string> = {
  1: 'text-gray-400',
  2: 'text-green-400',
  3: 'text-blue-400',
  4: 'text-purple-400',
  5: 'text-orange-400',
  6: 'text-amber-300',
};

/** Hex for the quality, falling back to white (Common). */
export function qualityHex(quality: number): string {
  return QUALITY_HEX[quality] ?? '#ffffff';
}

/** Border-color hex for loot item icons. Default = Poor grey, not white. */
export function qualityBorderColor(quality: number): string {
  return QUALITY_HEX[quality] ?? QUALITY_HEX[0];
}
