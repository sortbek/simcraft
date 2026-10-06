/** Semantic status styling for gear rows: vault/loot/catalyst/voidForge color
 *  families (icon border + row edge/background, checked/unchecked). */
export type GearStatus = 'vault' | 'loot' | 'catalyst' | 'voidForge';

interface GearStatusStyle {
  /** Border color on the item icon. */
  iconRing: string;
  /** Row edge + background when the row is selected (checked). */
  rowChecked: string;
  /** Row edge + background when not selected. */
  rowUnchecked: string;
}

export const GEAR_STATUS_STYLES: Record<GearStatus, GearStatusStyle> = {
  vault: {
    iconRing: 'border-warning',
    rowChecked: 'border-warning/50 bg-warning/10 ring-1 ring-warning/40',
    rowUnchecked:
      'border-warning/[0.15] bg-warning/[0.03] hover:border-warning/25 hover:bg-warning/[0.06]',
  },
  loot: {
    iconRing: 'border-quality-rare',
    rowChecked: 'border-quality-rare/35 bg-quality-rare/10',
    rowUnchecked:
      'border-quality-rare/[0.15] bg-quality-rare/[0.03] hover:border-quality-rare/25 hover:bg-quality-rare/[0.06]',
  },
  catalyst: {
    iconRing: 'border-quality-epic',
    rowChecked: 'border-quality-epic/35 bg-quality-epic/10',
    rowUnchecked:
      'border-quality-epic/[0.15] bg-quality-epic/[0.03] hover:border-quality-epic/25 hover:bg-quality-epic/[0.06]',
  },
  voidForge: {
    iconRing: 'border-quality-legendary',
    rowChecked: 'border-quality-legendary/35 bg-quality-legendary/10',
    rowUnchecked:
      'border-quality-legendary/[0.15] bg-quality-legendary/[0.03] hover:border-quality-legendary/25 hover:bg-quality-legendary/[0.06]',
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
  deltaPositive: 'text-positive',
  /** Negative delta (DPS loss). */
  deltaNegative: 'text-negative',
} as const;
