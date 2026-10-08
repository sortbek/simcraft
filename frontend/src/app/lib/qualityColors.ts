/**
 * Single source of truth for WoW item-quality colors (was defined three times,
 * had drifted; those sites now re-export from here).
 *
 * Quality keys: 0 Poor · 1 Common · 2 Uncommon · 3 Rare · 4 Epic ·
 * 5 Legendary · 6 Artifact · 7 Heirloom.
 */

const q = (name: string) => `rgb(var(--c-q-${name}))`;

/** Inline colors (for `style={{ color }}` / borders); theme-aware via globals.css `--c-q-*`. */
export const QUALITY_HEX: Record<number, string> = {
  0: q('poor'),
  1: q('common'),
  2: q('uncommon'),
  3: q('rare'),
  4: q('epic'),
  5: q('legendary'),
  6: q('artifact'),
  7: q('heirloom'),
};

/** Server-sent quality hex (dark palette), swapped for the themed color where a light theme sets --q-light-N. */
export function serverQualityColor(quality: number, hex: string): string {
  return `var(--q-light-${quality}, ${hex})`;
}

/** Color for the quality, falling back to Common. */
export function qualityHex(quality: number): string {
  return QUALITY_HEX[quality] ?? QUALITY_HEX[1];
}

/** Border-color hex for loot item icons. Default = Poor grey, not white. */
export function qualityBorderColor(quality: number): string {
  return QUALITY_HEX[quality] ?? QUALITY_HEX[0];
}
