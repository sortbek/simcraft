export type ItemOrigin = "equipped" | "bags" | "vault";

export interface ParsedItem {
  slot: string;
  simc_string: string;
  item_id: number;
  ilevel: number;
  name: string;
  bonus_ids: number[];
  enchant_id: number;
  gem_id: number;
  is_equipped: boolean;
  origin: ItemOrigin;
}

export type ItemsBySlot = Record<string, ParsedItem[]>;

export const GEAR_SLOTS = [
  "head",
  "neck",
  "shoulder",
  "back",
  "chest",
  "wrist",
  "hands",
  "waist",
  "legs",
  "feet",
  "finger1",
  "finger2",
  "trinket1",
  "trinket2",
  "main_hand",
  "off_hand",
];

export const SLOT_LABELS: Record<string, string> = {
  head: "Head",
  neck: "Neck",
  shoulder: "Shoulder",
  back: "Back",
  chest: "Chest",
  wrist: "Wrist",
  hands: "Hands",
  waist: "Waist",
  legs: "Legs",
  feet: "Feet",
  finger1: "Ring 1",
  finger2: "Ring 2",
  trinket1: "Trinket 1",
  trinket2: "Trinket 2",
  main_hand: "Main Hand",
  off_hand: "Off Hand",
};

const SLOT_REGEX = new RegExp(`^(${GEAR_SLOTS.join("|")})=(.*)`, "i");

// Bag items for these slots should appear in both paired slots
const BASE_PAIRED_SLOTS: Record<string, string> = {
  finger1: "finger2",
  finger2: "finger1",
  trinket1: "trinket2",
  trinket2: "trinket1",
};

const DUAL_WIELD_SPECS = new Set([
  "frost",
  "fury",
  "enhancement",
  "windwalker",
  "brewmaster",
  "havoc",
  "vengeance",
  "outlaw",
  "assassination",
  "subtlety",
]);

function detectSpec(simcInput: string): string | null {
  for (const line of simcInput.split("\n")) {
    const m = line.trim().match(/^spec=(\w+)/);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

function getPairedSlots(): Record<string, string> {
  // Weapons are NOT paired here — dual-wield crossover for equipped weapons
  // is handled separately in the assembly phase, and bag weapons need inv_type
  // checks that aren't available at parse time.
  return BASE_PAIRED_SLOTS;
}

function parseItemProps(
  itemStr: string,
): Omit<ParsedItem, "slot" | "is_equipped" | "simc_string" | "origin"> {
  const idMatch = itemStr.match(/,id=(\d+)/);
  const ilvlMatch = itemStr.match(/(?:ilevel|ilvl)=(\d+)/);
  const nameMatch = itemStr.match(/name=([^,]+)/);
  const encMatch = itemStr.match(/^([a-z_]+),/);
  const bonusMatch = itemStr.match(/bonus_id=([0-9/:]+)/);
  const enchantMatch = itemStr.match(/enchant_id=(\d+)/);
  const gemMatch = itemStr.match(/gem_id=(\d+)/);

  let name = "";
  if (nameMatch) {
    name = nameMatch[1].replace(/_/g, " ");
  } else if (encMatch) {
    name = encMatch[1].replace(/_/g, " ");
  }
  name = name.replace(/\b\w/g, (c) => c.toUpperCase());

  const bonus_ids = bonusMatch
    ? bonusMatch[1].split(/[/:]/).map(Number).filter(Boolean)
    : [];

  return {
    item_id: idMatch ? parseInt(idMatch[1]) : 0,
    ilevel: ilvlMatch ? parseInt(ilvlMatch[1]) : 0,
    name,
    bonus_ids,
    enchant_id: enchantMatch ? parseInt(enchantMatch[1]) : 0,
    gem_id: gemMatch ? parseInt(gemMatch[1]) : 0,
  };
}

// Matches comment lines like "# Emberwing Feather (246)"
const ITEM_HEADER_REGEX = /^#+\s*(.+?)\s*\((\d+)\)\s*$/;

const CLASS_RE =
  /^(warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|demon_hunter|demonhunter|druid|evoker)\s*=/;

// Max armor subclass each class can wear (classes can wear their type and lighter)
const CLASS_MAX_ARMOR: Record<string, number> = {
  priest: 1,
  mage: 1,
  warlock: 1,
  rogue: 2,
  monk: 2,
  druid: 2,
  demon_hunter: 2,
  demonhunter: 2,
  hunter: 3,
  shaman: 3,
  evoker: 3,
  warrior: 4,
  paladin: 4,
  death_knight: 4,
  deathknight: 4,
};

const ARMOR_SLOTS = new Set([
  "head",
  "shoulder",
  "chest",
  "wrist",
  "hands",
  "waist",
  "legs",
  "feet",
]);

/** Detect character class from simc input. */
export function detectClass(simcInput: string): string | null {
  for (const line of simcInput.split("\n")) {
    const m = line.trim().match(CLASS_RE);
    if (m) return m[1];
  }
  return null;
}

/** Max armor subclass the class can equip, or null if unknown. */
export function classMaxArmor(className: string | null): number | null {
  if (!className) return null;
  return CLASS_MAX_ARMOR[className] ?? null;
}

export interface TalentLoadout {
  name: string;
  talentString: string;
  isActive: boolean;
}

/** Parse all talent loadouts from a simc input string. */
export function parseTalentLoadouts(simcInput: string): TalentLoadout[] {
  const loadouts: TalentLoadout[] = [];
  const lines = simcInput.split("\n");
  let pendingLabel = "";

  for (const rawLine of lines) {
    const stripped = rawLine.trim();

    if (stripped.startsWith("#")) {
      const clean = stripped.replace(/^#+\s*/, "");
      const talentMatch = clean.match(/^talents=(.+)/);
      if (talentMatch) {
        const name = pendingLabel || `Loadout ${loadouts.length + 1}`;
        loadouts.push({ name, talentString: talentMatch[1], isActive: false });
        pendingLabel = "";
      } else if (
        !clean.match(SLOT_REGEX) &&
        !clean.match(ITEM_HEADER_REGEX) &&
        clean.length > 0 &&
        clean.length < 60 &&
        !clean.startsWith("gear_")
      ) {
        // Potential loadout name header (short non-gear comment)
        pendingLabel = clean;
      }
    } else {
      const talentMatch = stripped.match(/^talents=(.+)/);
      if (talentMatch) {
        loadouts.unshift({
          name: pendingLabel || "Active",
          talentString: talentMatch[1],
          isActive: true,
        });
        pendingLabel = "";
      } else {
        pendingLabel = "";
      }
    }
  }

  return loadouts;
}

export function parseAddonString(simcInput: string): ItemsBySlot {
  const spec = detectSpec(simcInput);
  const pairedSlots = getPairedSlots();

  const equipped: Record<string, ParsedItem> = {};
  const bagItems: Record<string, ParsedItem[]> = {};

  // Track the last "# Name (ilvl)" header line
  let pendingName = "";
  let pendingIlevel = 0;
  let inVaultSection = false;

  for (const rawLine of simcInput.split("\n")) {
    const stripped = rawLine.trim();

    if (stripped.startsWith("#")) {
      const clean = stripped.replace(/^#+\s*/, "");

      // Detect vault section boundaries
      if (clean.toLowerCase() === "weekly reward choices") {
        inVaultSection = true;
        pendingName = "";
        pendingIlevel = 0;
        continue;
      }
      if (clean.toLowerCase() === "end of weekly reward choices") {
        inVaultSection = false;
        pendingName = "";
        pendingIlevel = 0;
        continue;
      }

      const m = clean.match(SLOT_REGEX);
      if (m) {
        const slot = m[1].toLowerCase();
        const itemStr = m[2];
        const props = parseItemProps(itemStr);
        // Use pending header data if the item line didn't have name/ilvl
        if (!props.name && pendingName) props.name = pendingName;
        if (!props.ilevel && pendingIlevel) props.ilevel = pendingIlevel;
        pendingName = "";
        pendingIlevel = 0;
        const origin: ItemOrigin = inVaultSection ? "vault" : "bags";
        const entry: ParsedItem = {
          slot,
          simc_string: itemStr,
          is_equipped: false,
          ...props,
          origin,
        };
        if (!bagItems[slot]) bagItems[slot] = [];
        bagItems[slot].push(entry);

        // Rings/trinkets: also add to the paired slot
        const other = pairedSlots[slot];
        if (other) {
          if (!bagItems[other]) bagItems[other] = [];
          bagItems[other].push({ ...entry, slot: other });
        }
      } else {
        // Check if this is a "# Name (ilvl)" header
        const headerMatch = stripped.match(ITEM_HEADER_REGEX);
        if (headerMatch) {
          pendingName = headerMatch[1];
          pendingIlevel = parseInt(headerMatch[2]);
        } else {
          pendingName = "";
          pendingIlevel = 0;
        }
      }
    } else {
      const m = stripped.match(SLOT_REGEX);
      if (m) {
        const slot = m[1].toLowerCase();
        const itemStr = m[2];
        const props = parseItemProps(itemStr);
        if (!props.name && pendingName) props.name = pendingName;
        if (!props.ilevel && pendingIlevel) props.ilevel = pendingIlevel;
        pendingName = "";
        pendingIlevel = 0;
        equipped[slot] = {
          slot,
          simc_string: itemStr,
          is_equipped: true,
          ...props,
          origin: "equipped",
        };
      }
    }
  }

  // Build items_by_slot: equipped first, then bag items (deduplicated)
  const itemsBySlot: ItemsBySlot = {};
  for (const slot of GEAR_SLOTS) {
    const items: ParsedItem[] = [];
    const seenIds = new Set<number>();

    if (equipped[slot]) {
      items.push(equipped[slot]);
      if (equipped[slot].item_id) seenIds.add(equipped[slot].item_id);
    }

    // For dual-wield specs, add the equipped weapon from the other hand as an alternative
    if (spec && DUAL_WIELD_SPECS.has(spec)) {
      const otherSlot =
        slot === "main_hand"
          ? "off_hand"
          : slot === "off_hand"
            ? "main_hand"
            : null;
      if (otherSlot && equipped[otherSlot]) {
        const otherItem = equipped[otherSlot];
        if (otherItem.item_id > 0 && !seenIds.has(otherItem.item_id)) {
          seenIds.add(otherItem.item_id);
          items.push({
            ...otherItem,
            slot,
            is_equipped: false,
            origin: "equipped",
          });
        }
      }
    }

    if (bagItems[slot]) {
      for (const bagItem of bagItems[slot]) {
        const iid = bagItem.item_id;
        if (iid && seenIds.has(iid)) continue;
        if (iid) seenIds.add(iid);
        items.push(bagItem);
      }
    }

    if (items.length > 0) {
      itemsBySlot[slot] = items;
    }
  }

  return itemsBySlot;
}

export function parseUpgradeCurrencies(
  simcInput: string,
): Record<number, number> {
  const currencies: Record<number, number> = {};
  const lineRegex = /^#?\s*upgrade_currencies\s*=\s*(.+)$/i;
  const pairRegex = /(?:^|\/)\s*c:(\d+):(\d+)/gi;

  for (const rawLine of simcInput.split("\n")) {
    const line = rawLine.trim();
    const match = line.match(lineRegex);
    if (!match) continue;
    const rhs = match[1];
    let pair: RegExpExecArray | null;
    while ((pair = pairRegex.exec(rhs)) !== null) {
      const currencyId = Number(pair[1]);
      const amount = Number(pair[2]);
      if (Number.isFinite(currencyId) && currencyId > 0) {
        currencies[currencyId] = amount;
      }
    }
    break;
  }

  return currencies;
}
