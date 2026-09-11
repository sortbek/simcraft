import { resolveInherits, type EquippedGear } from '../../lib/inheritedGear';
import { getWowheadUrl, localizedItemName } from '../../lib/useItemInfo';
import type { CraftedEmbellishment } from '../../lib/types';
import { dropUid, type DropItem } from './types';
import { dropWowheadAttr, type DropConfiguration } from './dropConfiguration';

/** Display data only: the component does not resolve simulation settings or eligibility. */
export interface LootItemRowModel {
  uid: string;
  itemId: number;
  name: string;
  icon: string;
  source: string;
  sourceId?: number;
  sourceName: string;
  slot: string;
  ilevel: number;
  quality: number;
  href: string;
  tooltip: string;
  selected: boolean;
  offSpec: boolean;
  embellished: boolean;
  variants: { is_void_forge?: boolean; is_catalyst?: boolean };
  embellishment?: { value: number | null; options: CraftedEmbellishment[] };
}

export interface LootItemRowContext {
  configuration: DropConfiguration;
  equippedGear: EquippedGear;
  spec: string;
  locale: string;
  selected: Set<string>;
  embellishmentOptions?: CraftedEmbellishment[];
  embellishmentPicks?: Record<number, number>;
}

export function buildLootItemRow(
  item: DropItem,
  slot: string,
  context: LootItemRowContext
): LootItemRowModel {
  const resolved = context.configuration;
  const uid = dropUid(item);
  const selected = context.selected.has(uid);
  const inherits = resolveInherits(item.inventory_type, context.spec, context.equippedGear);
  const options = context.embellishmentOptions?.filter((option) =>
    option.item_ids.includes(item.item_id)
  );
  const pick = context.embellishmentPicks?.[item.item_id];
  const pickBonusIds =
    pick === undefined
      ? undefined
      : context.embellishmentOptions?.find((option) => option.id === pick)?.bonus_ids;
  return {
    uid,
    itemId: item.item_id,
    name: localizedItemName(item.item_id, item.name, context.locale),
    icon: item.icon,
    source: item.encounter ? [item.instance_name, item.encounter].filter(Boolean).join(' • ') : '',
    sourceId: item.instance_id,
    // `??` would keep the backend's empty string for meta-pool encounters.
    sourceName: item.instance_name || 'Unknown',
    slot,
    ilevel: resolved.ilevel,
    quality: resolved.quality,
    href: getWowheadUrl(item.item_id, context.locale),
    tooltip: dropWowheadAttr(item, resolved, inherits[0], pickBonusIds),
    selected,
    offSpec: item.off_spec === true,
    embellished: item.embellished === true || pick !== undefined,
    variants: { is_void_forge: item.is_void_forge, is_catalyst: item.is_catalyst },
    embellishment: options?.length ? { value: pick ?? null, options } : undefined,
  };
}
