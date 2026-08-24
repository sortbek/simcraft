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

export interface GemOption extends ItemOption {
  algariColor?: string;
}

/** Slots that support permanent enchants, in display order. */
export const ENCHANT_SLOTS = [
  'main_hand',
  'head',
  'shoulder',
  'back',
  'chest',
  'wrist',
  'legs',
  'feet',
  'finger1',
  'finger2',
];

/** Diamonds: quality 4, crafted rank 2 (separate from regular gems). */
export function filterDiamonds(gems: GemOption[]): GemOption[] {
  return gems.filter((g) => g.craftingQuality === 2 && (g.quality ?? 0) === 4);
}

/** Regular gems grouped by Algari color: rank 2 crafted, quality 3. */
export function groupGemsByColor(gems: GemOption[]): { color: string; gems: GemOption[] }[] {
  const filtered = gems.filter((g) => g.craftingQuality === 2 && (g.quality ?? 0) === 3);
  const groups: Record<string, GemOption[]> = {};
  for (const g of filtered) {
    const color = g.algariColor || 'other';
    if (!groups[color]) groups[color] = [];
    groups[color].push(g);
  }
  for (const arr of Object.values(groups)) {
    arr.sort((a, b) => (a.itemName || a.displayName).localeCompare(b.itemName || b.displayName));
  }
  const colorOrder = ['amethyst', 'garnet', 'lapis', 'peridot', 'other'];
  return colorOrder
    .filter((c) => groups[c]?.length > 0)
    .map((c) => ({ color: c, gems: groups[c] }));
}
