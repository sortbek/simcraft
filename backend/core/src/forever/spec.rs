//! Class, race, spec and slot names between the SimC export and the engine's protojson.

/// Spec keys a class can sim with, preferred first.
pub fn spec_choices(class: &str) -> &'static [&'static str] {
    match class {
        "druid" => &[
            "balanceDruid",
            "feralCatDruid",
            "feralBearDruid",
            "restorationDruid",
        ],
        "hunter" => &["hunter"],
        "mage" => &["mage"],
        "paladin" => &["retributionPaladin", "protectionPaladin", "holyPaladin"],
        "priest" => &["dpsPriest", "healerPriest"],
        "rogue" => &["rogue"],
        "shaman" => &["elementalShaman", "enhancementShaman", "restorationShaman"],
        "warlock" => &["warlock"],
        "warrior" => &["dpsWarrior", "protectionWarrior"],
        _ => &[],
    }
}

/// Healers sim for healing per second.
pub fn is_healer(spec_key: &str) -> bool {
    matches!(
        spec_key,
        "holyPaladin" | "healerPriest" | "restorationDruid" | "restorationShaman"
    )
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
        ("priest", 2) => "dpsPriest",
        ("priest", _) => "healerPriest",
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
        "holyPaladin" => "Holy Paladin",
        "healerPriest" => "Healing Priest",
        "restorationDruid" => "Restoration Druid",
        "restorationShaman" => "Restoration Shaman",
        _ => "Unknown",
    }
}

/// Why a character cannot sim with this spec, or None. Below level 60 the engine needs the
/// character sheet, which newer SimC addons export.
pub fn blocked_reason(level: u32, has_sheet: bool, spec_key: Option<&str>) -> Option<String> {
    if level < 10 {
        Some("Forever sims work from level 10".into())
    } else if level < 60 && !has_sheet {
        Some(
            "Below level 60 the sim needs your character stats. Update the SimC addon and export again"
                .into(),
        )
    } else if spec_key.is_none() {
        Some("Pick a spec to sim".into())
    } else {
        None
    }
}

/// The engine's HunterOptions.PetType of an addon pet family token.
pub fn engine_pet_type(family: &str) -> Option<&'static str> {
    Some(match family {
        "cat" => "Cat",
        "wind_serpent" => "WindSerpent",
        "wolf" => "Wolf",
        "bat" => "Bat",
        "bear" => "Bear",
        "owl" => "Owl",
        "boar" => "Boar",
        "carrion_bird" => "CarrionBird",
        "crab" => "Crab",
        "crocolisk" => "Crocolisk",
        "gorilla" => "Gorilla",
        "hyena" => "Hyena",
        "raptor" => "Raptor",
        "scorpid" => "Scorpid",
        "spider" => "Spider",
        "tallstrider" => "Tallstrider",
        "turtle" => "Turtle",
        _ => return None,
    })
}

/// The engine's HunterOptions.Ammo of an ammo item; it knows these and no others.
pub fn engine_ammo(item_id: u32) -> Option<&'static str> {
    Some(match item_id {
        3030 => "RazorArrow",
        3033 => "SolidShot",
        11285 => "JaggedArrow",
        11284 => "AccurateSlugs",
        10513 => "MithrilGyroShot",
        19316 => "IceThreadedArrow",
        18042 => "ThoriumHeadedArrow",
        19317 => "IceThreadedBullet",
        15997 => "ThoriumShells",
        _ => return None,
    })
}

/// The engine's HunterOptions.PetAttackSpeed of a pet's swing time.
pub fn engine_pet_attack_speed(seconds: f64) -> Option<&'static str> {
    Some(match (seconds * 10.0).round() as u32 {
        10 => "One",
        12 => "OneTwo",
        13 => "OneThree",
        14 => "OneFour",
        15 => "OneFive",
        16 => "OneSix",
        17 => "OneSeven",
        20 => "Two",
        24 => "TwoFour",
        25 => "TwoFive",
        _ => return None,
    })
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
        "ranged" => 16,
        _ => return None,
    })
}

pub const SLOT_NAMES: [&str; 17] = [
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
    "ranged",
];
