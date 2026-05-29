//! Single source of truth for all WoW class, spec, and gear slot constants.
//!
//! Every module in the codebase imports from here. Nothing else defines these.

use regex::Regex;

// ---- Gear Slots ----

pub const GEAR_SLOTS: &[&str] = &[
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

/// Armor-type-restricted slots (head, shoulder, chest, wrist, hands, waist, legs, feet).
/// Slots like neck, back, finger, trinket, and weapons are NOT armor-type restricted.
pub const ARMOR_SLOTS: &[&str] = &[
    "head", "shoulder", "chest", "wrist", "hands", "waist", "legs", "feet",
];

/// Armor inventory types where subclass filtering applies.
pub const ARMOR_INVENTORY_TYPES: &[u64] = &[1, 3, 5, 6, 7, 8, 9, 10, 20];

/// Paired slots — single source for both `paired_slot()` and `UNIQUE_SLOT_PAIRS`.
const PAIRED_SLOTS: &[(&str, &str)] = &[("finger1", "finger2"), ("trinket1", "trinket2")];

pub const UNIQUE_SLOT_PAIRS: &[(&str, &str)] = PAIRED_SLOTS;

pub fn paired_slot(slot: &str) -> Option<&'static str> {
    PAIRED_SLOTS.iter().find_map(|(a, b)| {
        if *a == slot {
            Some(*b)
        } else if *b == slot {
            Some(*a)
        } else {
            None
        }
    })
}

pub const SLOT_DISPLAY_ORDER: &[&str] = &[
    "Main Hand",
    "Off Hand",
    "Head",
    "Neck",
    "Shoulder",
    "Back",
    "Chest",
    "Wrist",
    "Hands",
    "Waist",
    "Legs",
    "Feet",
    "Finger",
    "Trinket",
];

/// Human-readable slot name from inventory_type (for drop display).
pub fn inventory_type_display_slot(inv_type: u64) -> &'static str {
    match inv_type {
        1 => "Head",
        2 => "Neck",
        3 => "Shoulder",
        4 => "Shirt",
        5 | 20 => "Chest",
        6 => "Waist",
        7 => "Legs",
        8 => "Feet",
        9 => "Wrist",
        10 => "Hands",
        11 => "Finger",
        12 => "Trinket",
        13 | 15 | 17 | 21 | 26 => "Main Hand",
        14 | 22 | 23 => "Off Hand",
        16 => "Back",
        19 => "Tabard",
        _ => "Other",
    }
}

// ---- Class & Spec Data Table ----
//
// All class/spec metadata lives here. The lookup functions below derive from
// this single table instead of maintaining parallel match blocks.

/// Primary attribute for a spec — drives drop filtering (e.g. a hunter spec
/// with `PrimaryStat::Agility` rejects Strength-stat trinkets and weapons).
/// Sourced from SimC's `convert_hybrid_stat` in `engine/class_modules/*.cpp`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum PrimaryStat {
    Strength,
    Agility,
    Intellect,
}

/// Per-spec metadata.
pub struct SpecDef {
    pub name: &'static str,
    pub id: u64,
    /// Weapon subclass IDs:
    ///   0=1H Axe, 1=2H Axe, 2=Bow, 3=Gun, 4=1H Mace, 5=2H Mace,
    ///   6=Polearm, 7=1H Sword, 8=2H Sword, 9=Warglaive, 10=Staff,
    ///   13=Fist, 15=Dagger, 18=Crossbow, 19=Wand
    pub weapon_subclasses: &'static [u64],
    pub can_dual_wield: bool,
    pub can_use_shield: bool,
    pub can_use_offhand: bool,
    pub primary_stat: PrimaryStat,
}

/// Per-class metadata, containing its specs.
pub struct ClassDef {
    pub name: &'static str,
    pub aliases: &'static [&'static str],
    /// Max armor subclass: 1=Cloth, 2=Leather, 3=Mail, 4=Plate.
    pub max_armor: u64,
    /// Class-level allowed weapon subclasses (broad filter for drop tables).
    pub weapons: &'static [u64],
    pub specs: &'static [SpecDef],
}

static CLASSES: &[ClassDef] = &[
    ClassDef {
        name: "warrior",
        aliases: &[],
        max_armor: 4,
        weapons: &[0, 1, 4, 5, 6, 7, 8, 13, 15],
        specs: &[
            SpecDef {
                name: "arms",
                id: 71,
                weapon_subclasses: &[1, 5, 6, 8],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Strength,
            },
            SpecDef {
                name: "fury",
                id: 72,
                weapon_subclasses: &[0, 1, 4, 5, 6, 7, 8, 13, 15],
                can_dual_wield: true,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Strength,
            },
            SpecDef {
                name: "protection",
                id: 73,
                weapon_subclasses: &[0, 4, 7, 13, 15],
                can_dual_wield: false,
                can_use_shield: true,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Strength,
            },
        ],
    },
    ClassDef {
        name: "paladin",
        aliases: &[],
        max_armor: 4,
        weapons: &[0, 1, 4, 5, 6, 7, 8],
        specs: &[
            SpecDef {
                name: "holy",
                id: 65,
                // Paladin can equip 1H Axe (0) and 2H Axe (1) class-wide;
                // they were missing here alongside the other 2H types.
                weapon_subclasses: &[0, 1, 4, 5, 6, 7, 8],
                can_dual_wield: false,
                can_use_shield: true,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
            SpecDef {
                name: "protection",
                id: 66,
                // Paladins cannot equip fist weapons (13) — removed.
                weapon_subclasses: &[0, 4, 7],
                can_dual_wield: false,
                can_use_shield: true,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Strength,
            },
            SpecDef {
                name: "retribution",
                id: 70,
                weapon_subclasses: &[1, 5, 6, 8],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Strength,
            },
        ],
    },
    ClassDef {
        name: "hunter",
        aliases: &[],
        max_armor: 3,
        weapons: &[2, 3, 6, 18],
        specs: &[
            SpecDef {
                name: "beast_mastery",
                id: 253,
                weapon_subclasses: &[2, 3, 18],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Agility,
            },
            SpecDef {
                name: "marksmanship",
                id: 254,
                weapon_subclasses: &[2, 3, 18],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Agility,
            },
            SpecDef {
                name: "survival",
                id: 255,
                // Hunter melee proficiencies: 2H Axe, Polearm, 2H Sword, Staff,
                // Fist, Dagger. 2H Mace (5) removed — hunters cannot equip it.
                weapon_subclasses: &[1, 6, 8, 10, 13, 15],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Agility,
            },
        ],
    },
    ClassDef {
        name: "rogue",
        aliases: &[],
        max_armor: 2,
        weapons: &[0, 4, 7, 13, 15],
        specs: &[
            SpecDef {
                name: "assassination",
                id: 259,
                weapon_subclasses: &[0, 4, 7, 13, 15],
                can_dual_wield: true,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Agility,
            },
            SpecDef {
                name: "outlaw",
                id: 260,
                weapon_subclasses: &[0, 4, 7, 13, 15],
                can_dual_wield: true,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Agility,
            },
            SpecDef {
                name: "subtlety",
                id: 261,
                weapon_subclasses: &[0, 4, 7, 13, 15],
                can_dual_wield: true,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Agility,
            },
        ],
    },
    ClassDef {
        name: "priest",
        aliases: &[],
        max_armor: 1,
        weapons: &[4, 10, 15, 19],
        specs: &[
            SpecDef {
                name: "discipline",
                id: 256,
                weapon_subclasses: &[4, 10, 15, 19],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
            SpecDef {
                name: "holy",
                id: 257,
                weapon_subclasses: &[4, 10, 15, 19],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
            SpecDef {
                name: "shadow",
                id: 258,
                weapon_subclasses: &[4, 10, 15, 19],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
        ],
    },
    ClassDef {
        name: "death_knight",
        aliases: &["deathknight"],
        max_armor: 4,
        weapons: &[0, 1, 4, 5, 7, 8],
        specs: &[
            SpecDef {
                name: "blood",
                id: 250,
                weapon_subclasses: &[1, 5, 6, 8],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Strength,
            },
            SpecDef {
                name: "frost",
                id: 251,
                weapon_subclasses: &[0, 1, 4, 5, 6, 7, 8],
                can_dual_wield: true,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Strength,
            },
            SpecDef {
                name: "unholy",
                id: 252,
                weapon_subclasses: &[1, 5, 6, 8],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Strength,
            },
        ],
    },
    ClassDef {
        name: "shaman",
        aliases: &[],
        max_armor: 3,
        weapons: &[0, 1, 4, 5, 10, 13],
        specs: &[
            SpecDef {
                name: "elemental",
                id: 262,
                weapon_subclasses: &[0, 4, 10, 13, 15],
                can_dual_wield: false,
                can_use_shield: true,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
            SpecDef {
                name: "enhancement",
                id: 263,
                weapon_subclasses: &[0, 4, 13, 15],
                can_dual_wield: true,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Agility,
            },
            SpecDef {
                name: "restoration",
                id: 264,
                weapon_subclasses: &[0, 4, 10, 13, 15],
                can_dual_wield: false,
                can_use_shield: true,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
        ],
    },
    ClassDef {
        name: "mage",
        aliases: &[],
        max_armor: 1,
        weapons: &[7, 10, 15, 19],
        specs: &[
            SpecDef {
                name: "arcane",
                id: 62,
                weapon_subclasses: &[7, 10, 15, 19],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
            SpecDef {
                name: "fire",
                id: 63,
                weapon_subclasses: &[7, 10, 15, 19],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
            SpecDef {
                name: "frost",
                id: 64,
                weapon_subclasses: &[7, 10, 15, 19],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
        ],
    },
    ClassDef {
        name: "warlock",
        aliases: &[],
        max_armor: 1,
        weapons: &[7, 10, 15, 19],
        specs: &[
            SpecDef {
                name: "affliction",
                id: 265,
                weapon_subclasses: &[7, 10, 15, 19],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
            SpecDef {
                name: "demonology",
                id: 266,
                weapon_subclasses: &[7, 10, 15, 19],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
            SpecDef {
                name: "destruction",
                id: 267,
                weapon_subclasses: &[7, 10, 15, 19],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
        ],
    },
    ClassDef {
        name: "monk",
        aliases: &[],
        max_armor: 2,
        weapons: &[0, 4, 6, 7, 10, 13],
        specs: &[
            SpecDef {
                name: "brewmaster",
                id: 268,
                weapon_subclasses: &[0, 4, 6, 7, 10, 13],
                can_dual_wield: true,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Agility,
            },
            SpecDef {
                name: "mistweaver",
                id: 270,
                // Monks can equip 1H Axes (0) class-wide — was missing.
                weapon_subclasses: &[0, 4, 7, 10, 13],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
            SpecDef {
                name: "windwalker",
                id: 269,
                // WW can also wield Polearm (6) and Staff (10) — matches
                // Brewmaster's list (monks share these proficiencies).
                weapon_subclasses: &[0, 4, 6, 7, 10, 13],
                can_dual_wield: true,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Agility,
            },
        ],
    },
    ClassDef {
        name: "druid",
        aliases: &[],
        max_armor: 2,
        weapons: &[4, 5, 6, 10, 13, 15],
        specs: &[
            SpecDef {
                name: "balance",
                id: 102,
                weapon_subclasses: &[4, 5, 6, 10, 13, 15],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
            SpecDef {
                name: "feral",
                id: 103,
                weapon_subclasses: &[4, 5, 6, 10, 13, 15],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Agility,
            },
            SpecDef {
                name: "guardian",
                id: 104,
                weapon_subclasses: &[4, 5, 6, 10, 13, 15],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Agility,
            },
            SpecDef {
                name: "restoration",
                id: 105,
                // Polearm (6) is a druid class proficiency — the other three
                // druid specs include it; Resto was missing it.
                weapon_subclasses: &[4, 5, 6, 10, 13, 15],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
        ],
    },
    ClassDef {
        name: "demon_hunter",
        aliases: &["demonhunter"],
        max_armor: 2,
        weapons: &[0, 7, 9, 13],
        specs: &[
            SpecDef {
                name: "havoc",
                id: 577,
                weapon_subclasses: &[0, 7, 9, 13],
                can_dual_wield: true,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Agility,
            },
            SpecDef {
                name: "vengeance",
                id: 581,
                weapon_subclasses: &[0, 7, 9, 13],
                can_dual_wield: true,
                can_use_shield: false,
                can_use_offhand: false,
                primary_stat: PrimaryStat::Agility,
            },
        ],
    },
    ClassDef {
        name: "evoker",
        aliases: &[],
        max_armor: 3,
        weapons: &[0, 4, 7, 10, 13, 15],
        specs: &[
            SpecDef {
                name: "devastation",
                id: 1467,
                weapon_subclasses: &[0, 4, 7, 10, 13, 15],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
            SpecDef {
                name: "preservation",
                id: 1468,
                weapon_subclasses: &[0, 4, 7, 10, 13, 15],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
            SpecDef {
                name: "augmentation",
                id: 1473,
                weapon_subclasses: &[0, 4, 7, 10, 13, 15],
                can_dual_wield: false,
                can_use_shield: false,
                can_use_offhand: true,
                primary_stat: PrimaryStat::Intellect,
            },
        ],
    },
];

// ---- Lookup Helpers ----

fn find_class(name: &str) -> Option<&'static ClassDef> {
    let n = name.to_lowercase();
    CLASSES
        .iter()
        .find(|c| c.name == n || c.aliases.iter().any(|&a| a == n))
}

pub fn can_dual_wield(spec: &str) -> bool {
    CLASSES
        .iter()
        .flat_map(|c| c.specs.iter())
        .any(|s| s.name == spec && s.can_dual_wield)
}

/// Max armor subclass: 1=Cloth, 2=Leather, 3=Mail, 4=Plate.
pub fn class_max_armor(class_name: &str) -> Option<u64> {
    find_class(class_name).map(|c| c.max_armor)
}

/// Weapon subclass IDs each class can equip (broad filter for drop tables).
pub fn class_allowed_weapons(class_name: &str) -> Option<&'static [u64]> {
    find_class(class_name).map(|c| c.weapons)
}

/// Per-spec weapon eligibility. Returns the full `SpecDef` which includes
/// `weapon_subclasses`, `can_use_shield`, `can_use_offhand`, and more.
pub fn spec_weapon_profile(class_name: &str, spec: &str) -> Option<&'static SpecDef> {
    let class = find_class(class_name)?;
    class.specs.iter().find(|s| s.name == spec)
}

/// Decode an item's `stats` array into the set of primary stats it can
/// satisfy. Returns `None` when the item has no primary-stat entries at all
/// (callers should treat that as "allow" — most effect-only trinkets fall in
/// this bucket).
///
/// Blizzard ItemModType IDs:
///   3=Agility, 4=Strength, 5=Intellect
///   71=Agi|Str|Int, 72=Agi|Str, 73=Agi|Int, 74=Str|Int
pub fn item_primary_stats(
    item: &serde_json::Value,
) -> Option<std::collections::HashSet<PrimaryStat>> {
    let stats = item.get("stats").and_then(|s| s.as_array())?;
    let mut out = std::collections::HashSet::new();
    for stat in stats {
        let id = match stat.get("id").and_then(|v| v.as_u64()) {
            Some(v) => v,
            None => continue,
        };
        match id {
            3 => {
                out.insert(PrimaryStat::Agility);
            }
            4 => {
                out.insert(PrimaryStat::Strength);
            }
            5 => {
                out.insert(PrimaryStat::Intellect);
            }
            71 => {
                out.insert(PrimaryStat::Strength);
                out.insert(PrimaryStat::Agility);
                out.insert(PrimaryStat::Intellect);
            }
            72 => {
                out.insert(PrimaryStat::Strength);
                out.insert(PrimaryStat::Agility);
            }
            73 => {
                out.insert(PrimaryStat::Agility);
                out.insert(PrimaryStat::Intellect);
            }
            74 => {
                out.insert(PrimaryStat::Strength);
                out.insert(PrimaryStat::Intellect);
            }
            _ => {}
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Map spec name → numeric spec ID.
pub fn class_spec_ids(class_name: &str, spec_name: Option<&str>) -> Vec<u64> {
    let class = match find_class(class_name) {
        Some(c) => c,
        None => return vec![],
    };
    match spec_name {
        Some(name) => class
            .specs
            .iter()
            .filter(|s| s.name == name)
            .map(|s| s.id)
            .collect(),
        None => class.specs.iter().map(|s| s.id).collect(),
    }
}

// ---- Inventory Type → Gear Slots ----

/// Map an item's inventory_type to eligible gear slot names.
pub fn inv_type_to_slots(inv_type: u64, spec: &str) -> Vec<&'static str> {
    match inv_type {
        1 => vec!["head"],
        2 => vec!["neck"],
        3 => vec!["shoulder"],
        5 | 20 => vec!["chest"],
        6 => vec!["waist"],
        7 => vec!["legs"],
        8 => vec!["feet"],
        9 => vec!["wrist"],
        10 => vec!["hands"],
        11 => vec!["finger1", "finger2"],
        12 => vec!["trinket1", "trinket2"],
        13 => {
            if can_dual_wield(spec) {
                vec!["main_hand", "off_hand"]
            } else {
                vec!["main_hand"]
            }
        }
        14 => vec!["off_hand"], // Shield
        16 => vec!["back"],
        17 => {
            // Two-hand: Fury warriors can equip in both slots (Titan's Grip)
            if spec == "fury" {
                vec!["main_hand", "off_hand"]
            } else {
                vec!["main_hand"]
            }
        }
        15 | 21 | 26 => vec!["main_hand"], // Ranged, Main-hand only
        22 | 23 => vec!["off_hand"],       // Off-hand, Held
        _ => vec![],
    }
}

/// Map a numeric spec ID to the SimC spec name (e.g., 254 → "marksmanship").
pub fn spec_id_to_name(spec_id: u64) -> Option<&'static str> {
    CLASSES
        .iter()
        .flat_map(|c| c.specs.iter())
        .find(|s| s.id == spec_id)
        .map(|s| s.name)
}

/// Map a SimC class name to its WoW numeric class ID.
pub fn class_wow_id(class_name: &str) -> Option<u64> {
    let n = class_name.to_lowercase();
    // WoW class IDs: warrior=1, paladin=2, hunter=3, rogue=4, priest=5,
    // death_knight=6, shaman=7, mage=8, warlock=9, monk=10, druid=11,
    // demon_hunter=12, evoker=13
    const WOW_IDS: &[(&str, u64)] = &[
        ("warrior", 1),
        ("paladin", 2),
        ("hunter", 3),
        ("rogue", 4),
        ("priest", 5),
        ("death_knight", 6),
        ("deathknight", 6),
        ("shaman", 7),
        ("mage", 8),
        ("warlock", 9),
        ("monk", 10),
        ("druid", 11),
        ("demon_hunter", 12),
        ("demonhunter", 12),
        ("evoker", 13),
    ];
    WOW_IDS
        .iter()
        .find(|(name, _)| *name == n)
        .map(|(_, id)| *id)
}

// ---- Detection ----

/// Detect the character class from a simc input string.
pub fn detect_class(simc_input: &str) -> Option<String> {
    let names: Vec<&str> = CLASSES
        .iter()
        .flat_map(|c| std::iter::once(c.name).chain(c.aliases.iter().copied()))
        .collect();
    let pattern = format!(r#"^({})\s*="#, names.join("|"));
    let class_re = Regex::new(&pattern).unwrap();
    for line in simc_input.lines() {
        if let Some(caps) = class_re.captures(line.trim()) {
            return Some(caps[1].to_string());
        }
    }
    None
}

/// Detect the spec from a simc input string.
pub fn detect_spec(simc_input: &str) -> Option<String> {
    let spec_re = Regex::new(r"^spec=(\w+)").unwrap();
    for line in simc_input.lines() {
        if let Some(caps) = spec_re.captures(line.trim()) {
            return Some(caps[1].to_lowercase());
        }
    }
    None
}

// ---- Quality ----

pub const QUALITY_NAMES: &[(u64, &str)] = &[
    (0, "poor"),
    (1, "common"),
    (2, "uncommon"),
    (3, "rare"),
    (4, "epic"),
    (5, "legendary"),
    (6, "artifact"),
    (7, "heirloom"),
];

pub fn quality_name(quality: u64) -> &'static str {
    QUALITY_NAMES
        .iter()
        .find(|(q, _)| *q == quality)
        .map(|(_, name)| *name)
        .unwrap_or("common")
}

pub fn quality_color(quality: u64) -> &'static str {
    match quality {
        0 => "#9d9d9d", // poor
        1 => "#ffffff", // common
        2 => "#1eff00", // uncommon
        3 => "#0070dd", // rare
        4 => "#a335ee", // epic
        5 => "#ff8000", // legendary
        6 => "#e6cc80", // artifact
        7 => "#00ccff", // heirloom
        _ => "#ffffff",
    }
}

// ---- Utilities ----

pub fn title_case(s: &str) -> String {
    s.split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(c) => format!("{}{}", c.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ---- Primary stat helper ----

    #[test]
    fn item_primary_stats_fixed_agility() {
        let item = json!({"stats": [{"id": 3, "alloc": 5000}, {"id": 7, "alloc": 4000}]});
        let stats = item_primary_stats(&item).unwrap();
        assert_eq!(stats.len(), 1);
        assert!(stats.contains(&PrimaryStat::Agility));
    }

    #[test]
    fn item_primary_stats_fixed_strength() {
        let item = json!({"stats": [{"id": 4, "alloc": 5000}]});
        let stats = item_primary_stats(&item).unwrap();
        assert!(stats.contains(&PrimaryStat::Strength));
        assert!(!stats.contains(&PrimaryStat::Agility));
    }

    #[test]
    fn item_primary_stats_hybrid_all_three() {
        let item = json!({"stats": [{"id": 71, "alloc": 5000}]});
        let stats = item_primary_stats(&item).unwrap();
        assert_eq!(stats.len(), 3);
    }

    #[test]
    fn item_primary_stats_hybrid_agi_int() {
        let item = json!({"stats": [{"id": 73, "alloc": 5000}]});
        let stats = item_primary_stats(&item).unwrap();
        assert!(stats.contains(&PrimaryStat::Agility));
        assert!(stats.contains(&PrimaryStat::Intellect));
        assert!(!stats.contains(&PrimaryStat::Strength));
    }

    #[test]
    fn item_primary_stats_no_primary_returns_none() {
        // Only stamina + secondaries — effect-only trinkets often look like this
        let item = json!({"stats": [{"id": 7, "alloc": 5000}, {"id": 32, "alloc": 3000}]});
        assert!(item_primary_stats(&item).is_none());
    }

    #[test]
    fn item_primary_stats_missing_stats_array_returns_none() {
        let item = json!({"item_id": 12345});
        assert!(item_primary_stats(&item).is_none());
    }

    // ---- Spec primary stat table ----

    #[test]
    fn all_hunter_specs_are_agility() {
        for spec in &["beast_mastery", "marksmanship", "survival"] {
            let p = spec_weapon_profile("hunter", spec).expect(spec);
            assert_eq!(p.primary_stat, PrimaryStat::Agility, "spec {spec}");
        }
    }

    #[test]
    fn holy_paladin_is_intellect_others_strength() {
        assert_eq!(
            spec_weapon_profile("paladin", "holy").unwrap().primary_stat,
            PrimaryStat::Intellect
        );
        for spec in &["protection", "retribution"] {
            assert_eq!(
                spec_weapon_profile("paladin", spec).unwrap().primary_stat,
                PrimaryStat::Strength,
                "spec {spec}"
            );
        }
    }

    #[test]
    fn shaman_enhancement_is_agility_others_intellect() {
        assert_eq!(
            spec_weapon_profile("shaman", "enhancement")
                .unwrap()
                .primary_stat,
            PrimaryStat::Agility
        );
        for spec in &["elemental", "restoration"] {
            assert_eq!(
                spec_weapon_profile("shaman", spec).unwrap().primary_stat,
                PrimaryStat::Intellect,
                "spec {spec}"
            );
        }
    }

    #[test]
    fn monk_mistweaver_is_intellect() {
        assert_eq!(
            spec_weapon_profile("monk", "mistweaver")
                .unwrap()
                .primary_stat,
            PrimaryStat::Intellect
        );
        for spec in &["brewmaster", "windwalker"] {
            assert_eq!(
                spec_weapon_profile("monk", spec).unwrap().primary_stat,
                PrimaryStat::Agility,
                "spec {spec}"
            );
        }
    }

    #[test]
    fn druid_caster_specs_are_intellect_melee_agility() {
        assert_eq!(
            spec_weapon_profile("druid", "balance")
                .unwrap()
                .primary_stat,
            PrimaryStat::Intellect
        );
        assert_eq!(
            spec_weapon_profile("druid", "restoration")
                .unwrap()
                .primary_stat,
            PrimaryStat::Intellect
        );
        assert_eq!(
            spec_weapon_profile("druid", "feral").unwrap().primary_stat,
            PrimaryStat::Agility
        );
        assert_eq!(
            spec_weapon_profile("druid", "guardian")
                .unwrap()
                .primary_stat,
            PrimaryStat::Agility
        );
    }

    // ---- weapon proficiency corrections ----

    #[test]
    fn survival_includes_daggers_and_excludes_two_hand_mace() {
        let sv = spec_weapon_profile("hunter", "survival").unwrap();
        assert!(
            sv.weapon_subclasses.contains(&15),
            "SV should allow daggers (15) — user reported them missing"
        );
        assert!(
            !sv.weapon_subclasses.contains(&5),
            "SV should NOT allow 2H mace (5) — hunters cannot equip it"
        );
    }

    #[test]
    fn holy_paladin_includes_axes() {
        // Paladins can equip 1H and 2H Axes class-wide. The Holy spec list was
        // missing both even though it included the other 2H weapon types.
        let p = spec_weapon_profile("paladin", "holy").unwrap();
        assert!(
            p.weapon_subclasses.contains(&0),
            "Holy paladin should allow 1H Axe (0)"
        );
        assert!(
            p.weapon_subclasses.contains(&1),
            "Holy paladin should allow 2H Axe (1)"
        );
    }

    #[test]
    fn protection_paladin_excludes_fist_weapons() {
        // Paladins cannot equip fist weapons class-wide.
        let p = spec_weapon_profile("paladin", "protection").unwrap();
        assert!(
            !p.weapon_subclasses.contains(&13),
            "Prot paladin should NOT allow fist weapons (13)"
        );
    }

    #[test]
    fn mistweaver_includes_one_hand_axe() {
        // Monks can equip 1H Axes class-wide; Mistweaver was missing it
        // (Brewmaster and Windwalker had it).
        let p = spec_weapon_profile("monk", "mistweaver").unwrap();
        assert!(
            p.weapon_subclasses.contains(&0),
            "Mistweaver should allow 1H Axe (0)"
        );
    }

    #[test]
    fn windwalker_includes_polearm_and_staff() {
        // Brewmaster has both; Windwalker shares monk class proficiencies.
        let p = spec_weapon_profile("monk", "windwalker").unwrap();
        assert!(
            p.weapon_subclasses.contains(&6),
            "WW should allow Polearm (6)"
        );
        assert!(
            p.weapon_subclasses.contains(&10),
            "WW should allow Staff (10)"
        );
    }

    #[test]
    fn restoration_druid_includes_polearm() {
        // Druids' three other specs (Balance/Feral/Guardian) include Polearm.
        // Resto was missing it.
        let p = spec_weapon_profile("druid", "restoration").unwrap();
        assert!(
            p.weapon_subclasses.contains(&6),
            "Resto druid should allow Polearm (6)"
        );
    }

    #[test]
    fn enhancement_shaman_excludes_two_hand_and_staff() {
        // Enhancement is locked to 1H dual-wield in retail — no 2H spec talent
        // currently exists. Staff and 2H weapons are correctly excluded.
        let p = spec_weapon_profile("shaman", "enhancement").unwrap();
        assert!(
            !p.weapon_subclasses.contains(&1),
            "Enh should NOT allow 2H Axe (1)"
        );
        assert!(
            !p.weapon_subclasses.contains(&5),
            "Enh should NOT allow 2H Mace (5)"
        );
        assert!(
            !p.weapon_subclasses.contains(&10),
            "Enh should NOT allow Staff (10)"
        );
    }
}
