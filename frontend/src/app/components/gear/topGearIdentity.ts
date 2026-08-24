import type { ItemOrigin, ResolvedItem } from '../../lib/types';

function sortBonusIds(bonusIds: number[]): number[] {
  return [...bonusIds].sort((a, b) => a - b);
}

export function buildTopGearUid(
  itemId: number,
  bonusIds: number[],
  origin: ItemOrigin,
  slot: string,
  // Catalyst uids append the conversion source (mirrors the backend resolver):
  // two sources converting to the same tier piece are distinct items.
  catalystSourceItemId?: number
): string {
  const source = catalystSourceItemId ? `:${catalystSourceItemId}` : '';
  return `${itemId}:${sortBonusIds(bonusIds).join(':')}:${origin}:${slot}${source}`;
}

export function buildResolvedCopy(
  item: ResolvedItem,
  overrides: Partial<ResolvedItem> & { bonus_ids?: number[]; origin?: ItemOrigin }
): ResolvedItem {
  const origin = overrides.origin ?? item.origin;
  const bonusIds = overrides.bonus_ids ?? item.bonus_ids;
  const slot = overrides.slot ?? item.slot;

  return {
    ...item,
    ...overrides,
    origin,
    bonus_ids: bonusIds,
    slot,
    uid: buildTopGearUid(
      item.item_id,
      bonusIds,
      origin,
      slot,
      item.is_catalyst ? item.source_item_id : undefined
    ),
  };
}

export function buildAlternativeKey(item: ResolvedItem): string {
  return [
    item.item_id,
    sortBonusIds(item.bonus_ids).join(':'),
    item.origin,
    item.enchant_id,
    item.gem_id,
    item.is_catalyst ? 1 : 0,
    item.simc_string,
  ].join('|');
}
