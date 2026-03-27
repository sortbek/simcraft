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

pub fn paired_slot(slot: &str) -> Option<&'static str> {
    match slot {
        "finger1" => Some("finger2"),
        "finger2" => Some("finger1"),
        "trinket1" => Some("trinket2"),
        "trinket2" => Some("trinket1"),
        _ => None,
    }
}

pub const UNIQUE_SLOT_PAIRS: &[(&str, &str)] = &[("finger1", "finger2"), ("trinket1", "trinket2")];

// ---- Slot Labels ----

pub fn slot_label(slot: &str) -> &'static str {
    match slot {
        "head" => "Head",
        "neck" => "Neck",
        "shoulder" => "Shoulder",
        "back" => "Back",
        "chest" => "Chest",
        "wrist" => "Wrist",
        "hands" => "Hands",
        "waist" => "Waist",
        "legs" => "Legs",
        "feet" => "Feet",
        "finger1" => "Ring 1",
        "finger2" => "Ring 2",
        "trinket1" => "Trinket 1",
        "trinket2" => "Trinket 2",
        "main_hand" => "Main Hand",
        "off_hand" => "Off Hand",
        _ => "Unknown",
    }
}

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
        13 => "One-Hand",
        14 => "Shield",
        15 | 26 => "Ranged",
        16 => "Back",
        17 => "Two-Hand",
        19 => "Tabard",
        21 => "Main Hand",
        22 => "Off Hand",
        23 => "Held In Off-Hand",
        _ => "Other",
    }
}

pub const SLOT_DISPLAY_ORDER: &[&str] = &[
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
    "One-Hand",
    "Main Hand",
    "Off Hand",
    "Two-Hand",
    "Held In Off-Hand",
    "Shield",
    "Ranged",
];

// ---- Class & Spec ----

pub fn can_dual_wield(spec: &str) -> bool {
    matches!(
        spec,
        "frost"
            | "fury"
            | "enhancement"
            | "windwalker"
            | "brewmaster"
            | "havoc"
            | "vengeance"
            | "outlaw"
            | "assassination"
            | "subtlety"
    )
}

/// Max armor subclass: 1=Cloth, 2=Leather, 3=Mail, 4=Plate.
pub fn class_max_armor(class_name: &str) -> Option<u64> {
    match class_name.to_lowercase().as_str() {
        "priest" | "mage" | "warlock" => Some(1),
        "rogue" | "monk" | "druid" | "demon_hunter" | "demonhunter" => Some(2),
        "hunter" | "shaman" | "evoker" => Some(3),
        "warrior" | "paladin" | "death_knight" | "deathknight" => Some(4),
        _ => None,
    }
}

/// Weapon subclass IDs each class can equip.
pub fn class_allowed_weapons(class_name: &str) -> Option<&'static [u64]> {
    match class_name {
        "warrior" => Some(&[0, 1, 4, 5, 6, 7, 8, 13, 15]),
        "paladin" => Some(&[0, 1, 4, 5, 6, 7, 8]),
        "hunter" => Some(&[2, 3, 6, 18]),
        "rogue" => Some(&[0, 4, 7, 13, 15]),
        "priest" => Some(&[4, 10, 15, 19]),
        "death_knight" | "deathknight" => Some(&[0, 1, 4, 5, 7, 8]),
        "shaman" => Some(&[0, 1, 4, 5, 10, 13]),
        "mage" => Some(&[7, 10, 15, 19]),
        "warlock" => Some(&[7, 10, 15, 19]),
        "monk" => Some(&[0, 4, 6, 7, 10, 13]),
        "druid" => Some(&[4, 5, 6, 10, 13, 15]),
        "demon_hunter" | "demonhunter" => Some(&[0, 7, 9, 13]),
        "evoker" => Some(&[0, 4, 7, 10, 13, 15]),
        _ => None,
    }
}

/// Map spec name → numeric spec ID.
pub fn class_spec_ids(class_name: &str, spec_name: Option<&str>) -> Vec<u64> {
    let all: &[(&str, u64)] = match class_name {
        "warrior" => &[("arms", 71), ("fury", 72), ("protection", 73)],
        "paladin" => &[("holy", 65), ("protection", 66), ("retribution", 70)],
        "hunter" => &[
            ("beast_mastery", 253),
            ("marksmanship", 254),
            ("survival", 255),
        ],
        "rogue" => &[("assassination", 259), ("outlaw", 260), ("subtlety", 261)],
        "priest" => &[("discipline", 256), ("holy", 257), ("shadow", 258)],
        "death_knight" | "deathknight" => &[("blood", 250), ("frost", 251), ("unholy", 252)],
        "shaman" => &[
            ("elemental", 262),
            ("enhancement", 263),
            ("restoration", 264),
        ],
        "mage" => &[("arcane", 62), ("fire", 63), ("frost", 64)],
        "warlock" => &[
            ("affliction", 265),
            ("demonology", 266),
            ("destruction", 267),
        ],
        "monk" => &[
            ("brewmaster", 268),
            ("mistweaver", 270),
            ("windwalker", 269),
        ],
        "druid" => &[
            ("balance", 102),
            ("feral", 103),
            ("guardian", 104),
            ("restoration", 105),
        ],
        "demon_hunter" | "demonhunter" => &[("havoc", 577), ("vengeance", 581)],
        "evoker" => &[
            ("devastation", 1467),
            ("preservation", 1468),
            ("augmentation", 1473),
        ],
        _ => &[],
    };
    if let Some(spec) = spec_name {
        all.iter()
            .filter(|(n, _)| *n == spec)
            .map(|(_, id)| *id)
            .collect()
    } else {
        all.iter().map(|(_, id)| *id).collect()
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

const CLASS_NAMES: &[&str] = &[
    "warrior",
    "paladin",
    "hunter",
    "rogue",
    "priest",
    "death_knight",
    "deathknight",
    "shaman",
    "mage",
    "warlock",
    "monk",
    "demon_hunter",
    "demonhunter",
    "druid",
    "evoker",
];

/// Detect the character class from a simc input string.
pub fn detect_class(simc_input: &str) -> Option<String> {
    let pattern = format!(r#"^({})\s*="#, CLASS_NAMES.join("|"));
    let class_re = Regex::new(&pattern).unwrap();
    for line in simc_input.lines() {
        let trimmed = line.trim();
        if let Some(caps) = class_re.captures(trimmed) {
            return Some(caps[1].to_string());
        }
    }
    None
}

/// Detect the spec from a simc input string.
pub fn detect_spec(simc_input: &str) -> Option<String> {
    let spec_re = Regex::new(r"^spec=(\w+)").unwrap();
    for line in simc_input.lines() {
        let trimmed = line.trim();
        if let Some(caps) = spec_re.captures(trimmed) {
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
