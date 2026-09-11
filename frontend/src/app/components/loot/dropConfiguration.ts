import { getWowheadData } from '../../lib/useItemInfo';
import type { SlotInherit } from '../../lib/inheritedGear';
import { resolveUpgrade, type DropItem, type DropItemPayload, type UpgradeTracks } from './types';

export interface DropConfigurationOptions {
  difficulty: string;
  dungeonDiff: string;
  upgradeLevel: number;
  upgradeTracks: UpgradeTracks;
  preferredStats?: number[] | null;
}
export interface DropConfiguration {
  ilevel: number;
  quality: number;
  bonus_ids: number[];
  preferredStats?: number[];
}
/** Resolve the properties shared by the row, tooltip, and submitted candidate. */
export function resolveDropConfiguration(
  item: DropItem,
  options: DropConfigurationOptions
): DropConfiguration {
  const upgrade = resolveUpgrade(
    item,
    options.difficulty,
    options.dungeonDiff,
    options.upgradeLevel,
    options.upgradeTracks
  );
  return {
    ilevel: upgrade.ilvl,
    quality: upgrade.quality,
    bonus_ids: [
      ...new Set([
        ...(upgrade.bonus_id ? [upgrade.bonus_id] : []),
        ...(item.extra_bonus_ids ?? []),
        ...(item.effect_bonus_ids ?? []),
      ]),
    ],
    preferredStats: item.accepts_preferred_stats
      ? (options.preferredStats ?? undefined)
      : undefined,
  };
}
export function dropPayload(item: DropItem, configuration: DropConfiguration): DropItemPayload {
  return {
    ...item,
    ilevel: configuration.ilevel,
    quality: configuration.quality,
    bonus_ids: configuration.bonus_ids,
  };
}
export function dropWowheadAttr(
  item: DropItem,
  configuration: DropConfiguration,
  inherit?: SlotInherit,
  embellishmentBonusIds?: number[]
): string {
  const params = getWowheadData({
    ...configuration,
    crafted_stats: configuration.preferredStats,
    embellishment: embellishmentBonusIds?.length ? { bonus_ids: embellishmentBonusIds } : undefined,
    enchant_id: inherit?.enchant_id,
    gem_id: inherit?.gem_id,
    is_catalyst: item.is_catalyst,
    source_item_id: item.source_item_id,
  });
  return 'item=' + item.item_id + (params ? '&' + params : '');
}
