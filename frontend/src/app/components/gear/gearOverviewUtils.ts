import type { ItemQuery } from '../../lib/useItemInfo';
import type { GearItem } from './gearOverviewTypes';

export function collectItemQueries(gear: Record<string, GearItem>): ItemQuery[] {
  const seen = new Set<string>();
  const queries: ItemQuery[] = [];

  for (const item of Object.values(gear)) {
    if (item.item_id <= 0) {
      continue;
    }
    const key = `${item.item_id}:${(item.bonus_ids || []).sort().join(':')}`;
    if (!seen.has(key)) {
      seen.add(key);
      queries.push({ item_id: item.item_id, bonus_ids: item.bonus_ids });
    }
  }

  return queries;
}

export function collectEnchantIds(gear: Record<string, GearItem>): number[] {
  const ids = new Set<number>();
  for (const item of Object.values(gear)) {
    if (item.enchant_id && item.enchant_id > 0) {
      ids.add(item.enchant_id);
    }
  }
  return [...ids];
}

export function collectGemIds(gear: Record<string, GearItem>): number[] {
  const ids = new Set<number>();
  for (const item of Object.values(gear)) {
    if (item.gem_id && item.gem_id > 0) {
      ids.add(item.gem_id);
    }
  }
  return [...ids];
}
