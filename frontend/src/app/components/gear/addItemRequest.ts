export interface IlvlOption {
  ilvl: number;
  bonus_id: number;
}

export interface SearchItem {
  item_id: number;
  name: string;
  icon: string;
  inventory_type: number;
  quality: number;
  ilevel: number;
  /** Item levels this specific item can exist at, highest first. */
  ilvl_options: IlvlOption[];
  /** Backend `item_db::accepts_preferred_stats`: crafted gear or a flexible-stat BOE. */
  accepts_preferred_stats?: boolean;
}

/** One row's crafted picks: its stat pair, and an embellishment when one is set. */
export interface AddItemPicks {
  stats: [number, number];
  embellishmentId?: number;
}

/** Body for `POST /api/top-gear/resolve-drops` adding one searched item. The
 *  stat pair is sent only for items that accept one; the embellishment only
 *  when picked. */
export function addItemRequestBody(
  simcInput: string,
  item: SearchItem,
  option: IlvlOption | undefined,
  picks: AddItemPicks
) {
  return {
    simc_input: simcInput,
    drop_items: [
      {
        item_id: item.item_id,
        name: item.name,
        icon: item.icon,
        inventory_type: item.inventory_type,
        ilevel: option?.ilvl ?? item.ilevel,
        bonus_ids: option?.bonus_id ? [option.bonus_id] : [],
        ...(picks.embellishmentId != null ? { embellishment_id: picks.embellishmentId } : {}),
      },
    ],
    ...(item.accepts_preferred_stats ? { preferred_crafted_stats: picks.stats } : {}),
  };
}
