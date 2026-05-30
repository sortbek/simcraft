/**
 * Semantic status styling for gear rows. Centralizes the vault/loot/catalyst/
 * voidForge color families that GearItemRow previously inlined as a 5-way
 * nested ternary (icon ring + row background, ×2 for checked/unchecked).
 * Values are the exact Tailwind classes already in use — no visual change.
 */
export type GearStatus = 'vault' | 'loot' | 'catalyst' | 'voidForge';

interface GearStatusStyle {
  /** Ring on the item icon. */
  iconRing: string;
  /** Row background + ring when the row is selected (checked). */
  rowChecked: string;
  /** Row background + ring when not selected. */
  rowUnchecked: string;
}

export const GEAR_STATUS_STYLES: Record<GearStatus, GearStatusStyle> = {
  vault: {
    iconRing: 'ring-2 ring-amber-400/70',
    rowChecked: 'bg-amber-400/[0.12] ring-2 ring-amber-400/50',
    rowUnchecked:
      'bg-amber-400/[0.04] ring-1 ring-amber-400/30 hover:bg-amber-400/[0.08] hover:ring-amber-400/50',
  },
  loot: {
    iconRing: 'ring-2 ring-sky-400/70',
    rowChecked: 'bg-sky-400/[0.12] ring-2 ring-sky-400/50',
    rowUnchecked:
      'bg-sky-400/[0.04] ring-1 ring-sky-400/30 hover:bg-sky-400/[0.08] hover:ring-sky-400/50',
  },
  catalyst: {
    iconRing: 'ring-2 ring-purple-400/70',
    rowChecked: 'bg-purple-400/[0.12] ring-2 ring-purple-400/50',
    rowUnchecked:
      'bg-purple-400/[0.04] ring-1 ring-purple-400/30 hover:bg-purple-400/[0.08] hover:ring-purple-400/50',
  },
  voidForge: {
    iconRing: 'ring-2 ring-violet-400/70',
    rowChecked: 'bg-violet-400/[0.12] ring-2 ring-violet-400/50',
    rowUnchecked:
      'bg-violet-400/[0.04] ring-1 ring-violet-400/30 hover:bg-violet-400/[0.08] hover:ring-violet-400/50',
  },
};

/** Pick the first matching status from the boolean flags (priority order
 *  matches the legacy ternary: vault → loot → catalyst → voidForge). */
export function gearStatusFrom(flags: {
  vault?: boolean;
  loot?: boolean;
  catalyst?: boolean;
  voidForge?: boolean;
}): GearStatus | null {
  if (flags.vault) return 'vault';
  if (flags.loot) return 'loot';
  if (flags.catalyst) return 'catalyst';
  if (flags.voidForge) return 'voidForge';
  return null;
}

/** Semantic text colors used in result rows. */
export const STATUS_TEXT = {
  /** Upgrade / crest cost emphasis. */
  upgrade: 'text-gold/70',
  /** Positive delta (DPS gain). */
  deltaPositive: 'text-green-400',
  /** Negative delta (DPS loss). */
  deltaNegative: 'text-red-400',
} as const;
