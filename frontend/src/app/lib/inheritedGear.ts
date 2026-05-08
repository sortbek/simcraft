// Pure-data module. Mirrors three backend functions — keep in sync when those
// change:
//   - parse_base_profile  in backend/core/src/profileset_generator/base_profile.rs
//   - inv_type_to_slots   in backend/core/src/types/class_data.rs
//   - can_dual_wield      in backend/core/src/types/class_data.rs
//                         (drives the DUAL_WIELD_SPECS set below)
//
// Used by the drop finder to compute the per-slot `slot_inherits` payload it
// sends to the backend, and to render inherit badges in the loot table.

export const GEAR_SLOTS = [
  'head',
  'neck',
  'shoulder',
  'back',
  'chest',
  'wrist',
  'hands',
  'waist',
  'legs',
  'feet',
  'finger1',
  'finger2',
  'trinket1',
  'trinket2',
  'main_hand',
  'off_hand',
] as const;

export type Slot = (typeof GEAR_SLOTS)[number];

export interface EquippedSlot {
  enchant_id?: number;
  gem_id?: number;
}

export type EquippedGear = Partial<Record<Slot, EquippedSlot>>;

export interface SlotInherit {
  slot: Slot;
  enchant_id?: number;
  gem_id?: number;
}

const GEM_SLOTS: ReadonlySet<Slot> = new Set(['finger1', 'finger2', 'neck']);

const DUAL_WIELD_SPECS: ReadonlySet<string> = new Set([
  'fury', // warrior
  'assassination',
  'outlaw',
  'subtlety', // rogue
  'frost', // death knight
  'enhancement', // shaman
  'brewmaster',
  'windwalker', // monk
  'havoc',
  'vengeance', // demon hunter
]);

function canDualWield(spec: string): boolean {
  return DUAL_WIELD_SPECS.has(spec);
}

/**
 * Parse equipped enchant_id and gem_id per slot from a simc input string.
 * Mirrors the backend `parse_base_profile` regex behavior.
 */
export function parseEquippedGear(simcInput: string): EquippedGear {
  const result: EquippedGear = {};
  if (!simcInput) return result;

  const slotPattern = new RegExp(`^(${GEAR_SLOTS.join('|')})=(.*)$`);

  for (const rawLine of simcInput.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const m = line.match(slotPattern);
    if (!m) continue;

    const slot = m[1] as Slot;
    const rest = m[2];

    const cleaned = rest.trim();
    if (cleaned === '' || cleaned === ',') {
      // Placeholder line (e.g. `off_hand=,`) — no item equipped in this slot.
      continue;
    }

    const entry: EquippedSlot = {};
    const eMatch = rest.match(/enchant_id=(\d+)/);
    if (eMatch) {
      const eid = Number.parseInt(eMatch[1], 10);
      if (eid > 0) entry.enchant_id = eid;
    }
    const gMatch = rest.match(/gem_id=(\d+)/);
    if (gMatch) {
      const gid = Number.parseInt(gMatch[1], 10);
      if (gid > 0) entry.gem_id = gid;
    }
    result[slot] = entry;
  }

  return result;
}

/**
 * Map an item's inventory_type to candidate gear slots.
 * TS port of backend `inv_type_to_slots`.
 */
export function slotsForInvType(invType: number, spec: string): Slot[] {
  switch (invType) {
    case 1:
      return ['head'];
    case 2:
      return ['neck'];
    case 3:
      return ['shoulder'];
    case 5:
    case 20:
      return ['chest'];
    case 6:
      return ['waist'];
    case 7:
      return ['legs'];
    case 8:
      return ['feet'];
    case 9:
      return ['wrist'];
    case 10:
      return ['hands'];
    case 11:
      return ['finger1', 'finger2'];
    case 12:
      return ['trinket1', 'trinket2'];
    case 13:
      return canDualWield(spec) ? ['main_hand', 'off_hand'] : ['main_hand'];
    case 14:
      return ['off_hand'];
    case 16:
      return ['back'];
    case 17:
      return spec === 'fury' ? ['main_hand', 'off_hand'] : ['main_hand'];
    case 15:
    case 21:
    case 26:
      return ['main_hand'];
    case 22:
    case 23:
      return ['off_hand'];
    default:
      return [];
  }
}

/**
 * Compute the candidate slots and per-slot inheritance for a single drop item.
 * Mirrors backend filtering: drops `off_hand` when a two-hand is equipped,
 * unless the spec is fury (Titan's Grip).
 */
export function resolveInherits(
  invType: number | undefined,
  spec: string,
  equipped: EquippedGear
): SlotInherit[] {
  if (!invType) return [];

  const normalizedSpec = spec.toLowerCase();
  let slots = slotsForInvType(invType, normalizedSpec);

  const offHandEquipped = Object.prototype.hasOwnProperty.call(equipped, 'off_hand');
  const twoHandEquipped = !offHandEquipped;

  if (twoHandEquipped && !(normalizedSpec === 'fury' && invType === 17)) {
    slots = slots.filter((s) => s !== 'off_hand');
  }

  return slots.map((slot) => {
    const eq = equipped[slot];
    const out: SlotInherit = { slot };
    if (eq?.enchant_id) out.enchant_id = eq.enchant_id;
    if (GEM_SLOTS.has(slot) && eq?.gem_id) out.gem_id = eq.gem_id;
    return out;
  });
}
