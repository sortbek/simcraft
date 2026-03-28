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
            SpecDef { name: "arms",       id: 71, weapon_subclasses: &[1, 5, 6, 8],                   can_dual_wield: false, can_use_shield: false, can_use_offhand: false },
            SpecDef { name: "fury",        id: 72, weapon_subclasses: &[0, 1, 4, 5, 6, 7, 8, 13, 15], can_dual_wield: true,  can_use_shield: false, can_use_offhand: false },
            SpecDef { name: "protection",  id: 73, weapon_subclasses: &[0, 4, 7, 13, 15],             can_dual_wield: false, can_use_shield: true,  can_use_offhand: false },
        ],
    },
    ClassDef {
        name: "paladin",
        aliases: &[],
        max_armor: 4,
        weapons: &[0, 1, 4, 5, 6, 7, 8],
        specs: &[
            SpecDef { name: "holy",        id: 65, weapon_subclasses: &[4, 5, 6, 7, 8],   can_dual_wield: false, can_use_shield: true,  can_use_offhand: true  },
            SpecDef { name: "protection",  id: 66, weapon_subclasses: &[0, 4, 7, 13],     can_dual_wield: false, can_use_shield: true,  can_use_offhand: false },
            SpecDef { name: "retribution", id: 70, weapon_subclasses: &[1, 5, 6, 8],      can_dual_wield: false, can_use_shield: false, can_use_offhand: false },
        ],
    },
    ClassDef {
        name: "hunter",
        aliases: &[],
        max_armor: 3,
        weapons: &[2, 3, 6, 18],
        specs: &[
            SpecDef { name: "beast_mastery", id: 253, weapon_subclasses: &[2, 3, 18],       can_dual_wield: false, can_use_shield: false, can_use_offhand: false },
            SpecDef { name: "marksmanship",  id: 254, weapon_subclasses: &[2, 3, 18],       can_dual_wield: false, can_use_shield: false, can_use_offhand: false },
            SpecDef { name: "survival",      id: 255, weapon_subclasses: &[1, 5, 6, 8, 10], can_dual_wield: false, can_use_shield: false, can_use_offhand: false },
        ],
    },
    ClassDef {
        name: "rogue",
        aliases: &[],
        max_armor: 2,
        weapons: &[0, 4, 7, 13, 15],
        specs: &[
            SpecDef { name: "assassination", id: 259, weapon_subclasses: &[0, 4, 7, 13, 15], can_dual_wield: true, can_use_shield: false, can_use_offhand: false },
            SpecDef { name: "outlaw",        id: 260, weapon_subclasses: &[0, 4, 7, 13, 15], can_dual_wield: true, can_use_shield: false, can_use_offhand: false },
            SpecDef { name: "subtlety",      id: 261, weapon_subclasses: &[0, 4, 7, 13, 15], can_dual_wield: true, can_use_shield: false, can_use_offhand: false },
        ],
    },
    ClassDef {
        name: "priest",
        aliases: &[],
        max_armor: 1,
        weapons: &[4, 10, 15, 19],
        specs: &[
            SpecDef { name: "discipline", id: 256, weapon_subclasses: &[4, 10, 15, 19], can_dual_wield: false, can_use_shield: false, can_use_offhand: true },
            SpecDef { name: "holy",       id: 257, weapon_subclasses: &[4, 10, 15, 19], can_dual_wield: false, can_use_shield: false, can_use_offhand: true },
            SpecDef { name: "shadow",     id: 258, weapon_subclasses: &[4, 10, 15, 19], can_dual_wield: false, can_use_shield: false, can_use_offhand: true },
        ],
    },
    ClassDef {
        name: "death_knight",
        aliases: &["deathknight"],
        max_armor: 4,
        weapons: &[0, 1, 4, 5, 7, 8],
        specs: &[
            SpecDef { name: "blood",  id: 250, weapon_subclasses: &[1, 5, 6, 8],          can_dual_wield: false, can_use_shield: false, can_use_offhand: false },
            SpecDef { name: "frost",  id: 251, weapon_subclasses: &[0, 1, 4, 5, 6, 7, 8], can_dual_wield: true,  can_use_shield: false, can_use_offhand: false },
            SpecDef { name: "unholy", id: 252, weapon_subclasses: &[1, 5, 6, 8],          can_dual_wield: false, can_use_shield: false, can_use_offhand: false },
        ],
    },
    ClassDef {
        name: "shaman",
        aliases: &[],
        max_armor: 3,
        weapons: &[0, 1, 4, 5, 10, 13],
        specs: &[
            SpecDef { name: "elemental",   id: 262, weapon_subclasses: &[0, 4, 10, 13, 15], can_dual_wield: false, can_use_shield: true,  can_use_offhand: true  },
            SpecDef { name: "enhancement", id: 263, weapon_subclasses: &[0, 4, 13, 15],     can_dual_wield: true,  can_use_shield: false, can_use_offhand: false },
            SpecDef { name: "restoration", id: 264, weapon_subclasses: &[0, 4, 10, 13, 15], can_dual_wield: false, can_use_shield: true,  can_use_offhand: true  },
        ],
    },
    ClassDef {
        name: "mage",
        aliases: &[],
        max_armor: 1,
        weapons: &[7, 10, 15, 19],
        specs: &[
            SpecDef { name: "arcane", id: 62, weapon_subclasses: &[7, 10, 15, 19], can_dual_wield: false, can_use_shield: false, can_use_offhand: true },
            SpecDef { name: "fire",   id: 63, weapon_subclasses: &[7, 10, 15, 19], can_dual_wield: false, can_use_shield: false, can_use_offhand: true },
            SpecDef { name: "frost",  id: 64, weapon_subclasses: &[7, 10, 15, 19], can_dual_wield: false, can_use_shield: false, can_use_offhand: true },
        ],
    },
    ClassDef {
        name: "warlock",
        aliases: &[],
        max_armor: 1,
        weapons: &[7, 10, 15, 19],
        specs: &[
            SpecDef { name: "affliction",  id: 265, weapon_subclasses: &[7, 10, 15, 19], can_dual_wield: false, can_use_shield: false, can_use_offhand: true },
            SpecDef { name: "demonology",  id: 266, weapon_subclasses: &[7, 10, 15, 19], can_dual_wield: false, can_use_shield: false, can_use_offhand: true },
            SpecDef { name: "destruction", id: 267, weapon_subclasses: &[7, 10, 15, 19], can_dual_wield: false, can_use_shield: false, can_use_offhand: true },
        ],
    },
    ClassDef {
        name: "monk",
        aliases: &[],
        max_armor: 2,
        weapons: &[0, 4, 6, 7, 10, 13],
        specs: &[
            SpecDef { name: "brewmaster",  id: 268, weapon_subclasses: &[0, 4, 6, 7, 10, 13], can_dual_wield: true,  can_use_shield: false, can_use_offhand: false },
            SpecDef { name: "mistweaver",  id: 270, weapon_subclasses: &[4, 7, 10, 13],       can_dual_wield: false, can_use_shield: false, can_use_offhand: true  },
            SpecDef { name: "windwalker",  id: 269, weapon_subclasses: &[0, 4, 7, 13],        can_dual_wield: true,  can_use_shield: false, can_use_offhand: false },
        ],
    },
    ClassDef {
        name: "druid",
        aliases: &[],
        max_armor: 2,
        weapons: &[4, 5, 6, 10, 13, 15],
        specs: &[
            SpecDef { name: "balance",     id: 102, weapon_subclasses: &[4, 5, 6, 10, 13, 15], can_dual_wield: false, can_use_shield: false, can_use_offhand: true  },
            SpecDef { name: "feral",       id: 103, weapon_subclasses: &[4, 5, 6, 10, 13, 15], can_dual_wield: false, can_use_shield: false, can_use_offhand: false },
            SpecDef { name: "guardian",    id: 104, weapon_subclasses: &[4, 5, 6, 10, 13, 15], can_dual_wield: false, can_use_shield: false, can_use_offhand: false },
            SpecDef { name: "restoration", id: 105, weapon_subclasses: &[4, 5, 10, 13, 15],   can_dual_wield: false, can_use_shield: false, can_use_offhand: true  },
        ],
    },
    ClassDef {
        name: "demon_hunter",
        aliases: &["demonhunter"],
        max_armor: 2,
        weapons: &[0, 7, 9, 13],
        specs: &[
            SpecDef { name: "havoc",    id: 577, weapon_subclasses: &[0, 7, 9, 13], can_dual_wield: true, can_use_shield: false, can_use_offhand: false },
            SpecDef { name: "vengeance", id: 581, weapon_subclasses: &[0, 7, 9, 13], can_dual_wield: true, can_use_shield: false, can_use_offhand: false },
        ],
    },
    ClassDef {
        name: "evoker",
        aliases: &[],
        max_armor: 3,
        weapons: &[0, 4, 7, 10, 13, 15],
        specs: &[
            SpecDef { name: "devastation",  id: 1467, weapon_subclasses: &[0, 4, 7, 10, 13, 15], can_dual_wield: false, can_use_shield: false, can_use_offhand: true },
            SpecDef { name: "preservation", id: 1468, weapon_subclasses: &[0, 4, 7, 10, 13, 15], can_dual_wield: false, can_use_shield: false, can_use_offhand: true },
            SpecDef { name: "augmentation", id: 1473, weapon_subclasses: &[0, 4, 7, 10, 13, 15], can_dual_wield: false, can_use_shield: false, can_use_offhand: true },
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
