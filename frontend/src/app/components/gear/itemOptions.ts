/** Shared shape for selectable enchant/gem options returned by the game-data API. */
export interface ItemOption {
  id: number;
  displayName: string;
  itemId?: number;
  itemName?: string;
  itemIcon?: string;
  quality?: number;
  stats?: { type: string; amount: number }[];
  craftingQuality?: number;
}

const STAT_LABELS: Record<string, string> = {
  crit: 'Crit',
  haste: 'Haste',
  mastery: 'Mastery',
  vers: 'Vers',
  versatility: 'Vers',
  agility: 'Agi',
  strength: 'Str',
  intellect: 'Int',
  stragiint: 'Primary',
  stamina: 'Sta',
  armor: 'Armor',
};

/** Format a stat delta for display, e.g. `{ type: 'crit', amount: 215 }` → "215 Crit". */
export function statLabel(stat: { type: string; amount: number }): string {
  return `${stat.amount} ${STAT_LABELS[stat.type] || stat.type}`;
}
