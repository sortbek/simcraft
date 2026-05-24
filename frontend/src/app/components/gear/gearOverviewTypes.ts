export interface GearItem {
  slot: string;
  item_id: number;
  ilevel: number;
  name: string;
  bonus_ids?: number[];
  enchant_id?: number;
  gem_id?: number;
  /**
   * All gem IDs placed on this item, one per socket. Necks and crafted items
   * can hold 2+ gems; `gem_id` alone only carries the first. Consumers that
   * render gems should prefer `gem_ids` when present.
   */
  gem_ids?: number[];
  is_kept?: boolean;
  upgrade_levels?: number;
  origin?: string;
}

export const GEAR_ORDER_LEFT = ['head', 'neck', 'shoulder', 'back', 'chest', 'wrist'];
export const GEAR_ORDER_RIGHT = [
  'hands',
  'waist',
  'legs',
  'feet',
  'finger1',
  'finger2',
  'trinket1',
  'trinket2',
];
export const GEAR_ORDER_BOTTOM = ['main_hand', 'off_hand'];
