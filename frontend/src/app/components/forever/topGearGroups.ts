import type { ForeverGear } from './types';

const PAIRED: Record<string, string> = {
  finger1: 'finger',
  finger2: 'finger',
  trinket1: 'trinket',
  trinket2: 'trinket',
};

export interface TopGearGroup {
  equipped: ForeverGear[];
  bags: { gear: ForeverGear; index: number }[];
}

/** Equipped items and the engine-known bag items per slot (rings and trinkets share one group);
 *  only groups with something to compare. `index` is the bag item's position in `bags`. */
export function groupForTopGear(
  equipped: ForeverGear[],
  bags: ForeverGear[]
): [string, TopGearGroup][] {
  const out = new Map<string, TopGearGroup>();
  const entry = (slot: string) => {
    const key = PAIRED[slot] ?? slot;
    if (!out.has(key)) out.set(key, { equipped: [], bags: [] });
    return out.get(key)!;
  };
  for (const g of equipped) entry(g.slot).equipped.push(g);
  bags.forEach((g, index) => {
    if (g.known) entry(g.slot).bags.push({ gear: g, index });
  });
  return [...out.entries()].filter(([, g]) => g.bags.length > 0);
}
