import type { ItemQuery } from '../../lib/useItemInfo';
import type { GearItem } from './GearOverview';
import type { GroupMode, ResultItem, TopGearResult } from './topGearResultsTypes';

const GEAR_ORDER_LEFT = ['head', 'neck', 'shoulder', 'back', 'chest', 'wrist'];
const GEAR_ORDER_RIGHT = [
  'hands',
  'waist',
  'legs',
  'feet',
  'finger1',
  'finger2',
  'trinket1',
  'trinket2',
];
const GEAR_ORDER_BOTTOM = ['main_hand', 'off_hand'];
const ALL_SLOTS = [...GEAR_ORDER_LEFT, ...GEAR_ORDER_RIGHT, ...GEAR_ORDER_BOTTOM];

export function gemBadgeClass(name?: string): string {
  if (!name) return 'bg-sky-500/10 text-sky-300';
  const lower = name.toLowerCase();
  if (lower.includes('garnet')) return 'bg-red-500/10 text-red-300';
  if (lower.includes('amethyst')) return 'bg-purple-500/10 text-purple-300';
  if (lower.includes('peridot')) return 'bg-green-500/10 text-green-300';
  if (lower.includes('lapis')) return 'bg-blue-500/10 text-blue-300';
  if (lower.includes('diamond') || lower.includes('eversong')) {
    return 'bg-amber-500/10 text-amber-300';
  }
  return 'bg-sky-500/10 text-sky-300';
}

export function dedupeEncounterResults(
  results: TopGearResult[],
  hasEncounterData: boolean
): TopGearResult[] {
  if (!hasEncounterData) {
    return results;
  }

  const bestByItem = new Map<string, TopGearResult>();
  for (const result of results) {
    const item = result.items[0];
    if (!item) {
      continue;
    }

    const key = `${item.item_id}_${item.ilevel}_${item.encounter || ''}`;
    const existing = bestByItem.get(key);
    if (!existing || result.dps > existing.dps) {
      bestByItem.set(key, result);
    }
  }

  return [...bestByItem.values()].sort((a, b) => b.delta - a.delta);
}

export function groupResults(
  activeResults: TopGearResult[],
  groupMode: GroupMode
): Array<[string, TopGearResult[]]> | null {
  if (groupMode === 'rank') {
    return null;
  }

  const groups: Record<string, TopGearResult[]> = {};
  for (const result of activeResults) {
    const key =
      groupMode === 'slot'
        ? result.items[0]?.slot || 'Unknown'
        : result.items[0]?.encounter || 'Unknown';
    groups[key] ??= [];
    groups[key].push(result);
  }

  return Object.entries(groups).sort(([, a], [, b]) => {
    const bestA = a[0]?.delta ?? 0;
    const bestB = b[0]?.delta ?? 0;
    return bestB - bestA;
  });
}

export function buildBestGearSet(
  equippedGear: Record<string, ResultItem> | undefined,
  selectedResult: TopGearResult | null
): Record<string, GearItem> {
  if (!equippedGear) {
    return {};
  }

  const gearSet: Record<string, GearItem> = {};
  for (const slot of ALL_SLOTS) {
    if (equippedGear[slot]) {
      gearSet[slot] = { ...equippedGear[slot] };
    }
  }

  if (!selectedResult) {
    return gearSet;
  }

  for (const item of selectedResult.items) {
    if (item.type) {
      continue;
    }
    if (!item.is_kept && item.slot === 'off_hand' && item.item_id === 0) {
      delete gearSet.off_hand;
      continue;
    }
    if (!item.is_kept && item.item_id > 0) {
      gearSet[item.slot] = { ...item };
    }
  }

  for (const item of selectedResult.items) {
    if (item.type === 'gem' && item.gem_id && item.slot && gearSet[item.slot]) {
      gearSet[item.slot] = { ...gearSet[item.slot], gem_id: item.gem_id };
    }
  }

  return gearSet;
}

function collectChangedSlots(
  result: TopGearResult | null,
  include: (delta: number) => boolean
): Set<string> {
  const slots = new Set<string>();
  if (!result || !include(result.delta)) {
    return slots;
  }

  for (const item of result.items) {
    if (!item.is_kept && item.item_id > 0) {
      slots.add(item.slot);
    }
    if (item.type === 'gem' && item.slot) {
      slots.add(item.slot);
    }
  }

  return slots;
}

export function collectUpgradeSlots(result: TopGearResult | null): Set<string> {
  return collectChangedSlots(result, (delta) => delta > 0);
}

export function collectDowngradeSlots(result: TopGearResult | null): Set<string> {
  return collectChangedSlots(result, (delta) => delta < 0);
}

export function collectItemQueries(
  results: TopGearResult[],
  equippedGear?: Record<string, ResultItem>
): ItemQuery[] {
  const seen = new Set<string>();
  const queries: ItemQuery[] = [];

  const addItem = (item: { item_id: number; bonus_ids?: number[] }) => {
    if (item.item_id <= 0) {
      return;
    }

    const bonusIds = [...(item.bonus_ids || [])].sort((a, b) => a - b);
    const key = `${item.item_id}:${bonusIds.join(':')}`;
    if (!seen.has(key)) {
      seen.add(key);
      queries.push({ item_id: item.item_id, bonus_ids: item.bonus_ids });
    }
  };

  for (const result of results) {
    for (const item of result.items) {
      addItem(item);
    }
  }

  if (equippedGear) {
    for (const item of Object.values(equippedGear)) {
      addItem(item);
    }
  }

  return queries;
}

function collectIds(
  results: TopGearResult[],
  equippedGear: Record<string, ResultItem> | undefined,
  pick: (item: ResultItem) => number | undefined
): number[] {
  const ids = new Set<number>();

  const addId = (id?: number) => {
    if (id && id > 0) {
      ids.add(id);
    }
  };

  for (const result of results) {
    for (const item of result.items) {
      addId(pick(item));
    }
  }

  if (equippedGear) {
    for (const item of Object.values(equippedGear)) {
      addId(pick(item));
    }
  }

  return [...ids];
}

export function collectEnchantIds(
  results: TopGearResult[],
  equippedGear?: Record<string, ResultItem>
): number[] {
  return collectIds(results, equippedGear, (item) => item.enchant_id);
}

export function collectGemIds(
  results: TopGearResult[],
  equippedGear?: Record<string, ResultItem>
): number[] {
  return collectIds(results, equippedGear, (item) => item.gem_id);
}

export function getCharacterRenderUrl(
  playerRealm?: string,
  playerName?: string,
  playerRegion = 'eu'
): string | null {
  if (!playerRealm || !playerName) {
    return null;
  }

  return `https://simhammer.com/api/blizzard/character/${playerRegion}/${encodeURIComponent(
    playerRealm.toLowerCase()
  )}/${encodeURIComponent(playerName.toLowerCase())}/media/render`;
}
