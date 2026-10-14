//! Class, race, spec and slot names between the SimC export and the engine's protojson.

/// Spec keys a class can sim with (no healers), preferred first.
pub fn spec_choices(class: &str) -> &'static [&'static str] {
    match class {
        "druid" => &["balanceDruid", "feralCatDruid", "feralBearDruid"],
        "hunter" => &["hunter"],
        "mage" => &["mage"],
        "paladin" => &["retributionPaladin", "protectionPaladin"],
        "priest" => &["dpsPriest"],
        "rogue" => &["rogue"],
        "shaman" => &["elementalShaman", "enhancementShaman"],
        "warlock" => &["warlock"],
        "warrior" => &["dpsWarrior", "protectionWarrior"],
        _ => &[],
    }
}

pub fn is_supported(spec_key: &str) -> bool {
    !matches!(spec_key, "holyPaladin" | "healerPriest" | "restorationDruid" | "restorationShaman")
        && !spec_key.is_empty()
}

/// The spec of the tree with the most points (first tree on a tie). Healer trees map to the
/// healer spec, which is refused; priests always sim as the DPS priest (Smite or Shadow is the
/// engine's rotation choice). No talent points: the class's preferred spec.
pub fn derive_spec(class: &str, points_per_tree: &[u32]) -> Option<&'static str> {
    if points_per_tree.iter().sum::<u32>() == 0 {
        return spec_choices(class).first().copied();
    }
    let primary = points_per_tree
        .iter()
        .enumerate()
        .max_by_key(|(i, p)| (**p, std::cmp::Reverse(*i)))
        .map(|(i, _)| i)
        .unwrap_or(0);
    Some(match (class, primary) {
        ("druid", 0) => "balanceDruid",
        ("druid", 1) => "feralCatDruid",
        ("druid", _) => "restorationDruid",
        ("paladin", 0) => "holyPaladin",
        ("paladin", 1) => "protectionPaladin",
        ("paladin", _) => "retributionPaladin",
        ("shaman", 0) => "elementalShaman",
        ("shaman", 1) => "enhancementShaman",
        ("shaman", _) => "restorationShaman",
        ("warrior", 2) => "protectionWarrior",
        ("warrior", _) => "dpsWarrior",
        (c, _) => return spec_choices(c).first().copied(),
    })
}

pub fn spec_label(spec_key: &str) -> &'static str {
    match spec_key {
        "balanceDruid" => "Balance Druid",
        "feralCatDruid" => "Feral Druid",
        "feralBearDruid" => "Guardian Druid",
        "hunter" => "Hunter",
        "mage" => "Mage",
        "retributionPaladin" => "Retribution Paladin",
        "protectionPaladin" => "Protection Paladin",
        "dpsPriest" => "Priest",
        "rogue" => "Rogue",
        "elementalShaman" => "Elemental Shaman",
        "enhancementShaman" => "Enhancement Shaman",
        "warlock" => "Warlock",
        "dpsWarrior" => "Warrior",
        "protectionWarrior" => "Protection Warrior",
        _ => "Unknown",
    }
}

/// Why a character cannot sim with this spec, or None. The frontend mirrors this rule.
pub fn blocked_reason(level: u32, spec_key: Option<&str>) -> Option<String> {
    if level < 60 {
        Some("Forever sims work from level 60".into())
    } else if !spec_key.is_some_and(is_supported) {
        Some("Healer specs can't be simmed yet".into())
    } else {
        None
    }
}

pub fn engine_class(class: &str) -> Option<&'static str> {
    Some(match class {
        "druid" => "ClassDruid",
        "hunter" => "ClassHunter",
        "mage" => "ClassMage",
        "paladin" => "ClassPaladin",
        "priest" => "ClassPriest",
        "rogue" => "ClassRogue",
        "shaman" => "ClassShaman",
        "warlock" => "ClassWarlock",
        "warrior" => "ClassWarrior",
        _ => return None,
    })
}

/// SimC addon race tokens; the addon writes the Skyborne races (ids 95/96) by faction.
pub fn engine_race(token: &str) -> Option<&'static str> {
    Some(match token {
        "human" => "RaceHuman",
        "dwarf" => "RaceDwarf",
        "night_elf" => "RaceNightElf",
        "gnome" => "RaceGnome",
        "orc" => "RaceOrc",
        "undead" => "RaceUndead",
        "tauren" => "RaceTauren",
        "troll" => "RaceTroll",
        "blood_elf" => "RaceBloodElf",
        "skyborne_alliance" => "RaceHighOrderSkyborne",
        "skyborne_horde" => "RaceWindshaperSkyborne",
        _ => return None,
    })
}

pub const ITEM_TYPE_RANGED: u8 = 14;

/// Engine ItemSlot index. Ranged-type items from bags arrive as main_hand.
pub fn engine_slot(slot: &str, item_type: u8) -> Option<usize> {
    if item_type == ITEM_TYPE_RANGED {
        return Some(16);
    }
    Some(match slot {
        "head" => 0,
        "neck" => 1,
        "shoulder" => 2,
        "back" => 3,
        "chest" => 4,
        "wrist" => 5,
        "hands" => 6,
        "waist" => 7,
        "legs" => 8,
        "feet" => 9,
        "finger1" => 10,
        "finger2" => 11,
        "trinket1" => 12,
        "trinket2" => 13,
        "main_hand" => 14,
        "off_hand" => 15,
        _ => return None,
    })
}

pub const SLOT_NAMES: [&str; 17] = [
    "head", "neck", "shoulder", "back", "chest", "wrist", "hands", "waist", "legs", "feet",
    "finger1", "finger2", "trinket1", "trinket2", "main_hand", "off_hand", "ranged",
];
