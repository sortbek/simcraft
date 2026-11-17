//! Drop Finder: the source items a character can wear, and the equipment slots each may go in.
//! The class tables follow wowsims/forever's `character_constants.go` (MIT); mail and plate wait
//! for level 40 and dual wield for level 20, as in Classic.

use std::collections::HashSet;

use serde::Serialize;

use super::data::{ForeverData, ForeverItem};
use super::import::ForeverCharacter;

const MAIN_HAND: usize = 14;
const OFF_HAND: usize = 15;
const RANGED: usize = 16;

pub fn side(race: &str) -> Option<&'static str> {
    match race {
        "human" | "dwarf" | "night_elf" | "gnome" | "skyborne_alliance" => Some("alliance"),
        "orc" | "undead" | "tauren" | "troll" | "blood_elf" | "skyborne_horde" => Some("horde"),
        _ => None,
    }
}

fn armor_rank(armor: &str) -> u8 {
    match armor {
        "cloth" => 1,
        "leather" => 2,
        "mail" => 3,
        "plate" => 4,
        _ => 0,
    }
}

fn max_armor(class: &str, level: u32) -> u8 {
    let late = level >= 40;
    match class {
        "warrior" | "paladin" => 3 + late as u8,
        "hunter" | "shaman" => 2 + late as u8,
        "rogue" | "druid" => 2,
        _ => 1,
    }
}

/// Melee weapon kinds a class can use, and whether as a two-hander.
fn weapons(class: &str) -> &'static [(&'static str, bool)] {
    match class {
        "warrior" => &[
            ("axe", true),
            ("dagger", false),
            ("fist", false),
            ("mace", true),
            ("off_hand", false),
            ("polearm", true),
            ("shield", false),
            ("staff", true),
            ("sword", true),
        ],
        "paladin" => &[
            ("axe", true),
            ("mace", true),
            ("off_hand", false),
            ("polearm", true),
            ("shield", false),
            ("sword", true),
        ],
        "hunter" => &[
            ("axe", true),
            ("dagger", false),
            ("fist", false),
            ("polearm", true),
            ("staff", true),
            ("sword", true),
        ],
        "rogue" => &[
            ("axe", false),
            ("dagger", false),
            ("fist", false),
            ("mace", false),
            ("off_hand", false),
            ("sword", false),
        ],
        "druid" => &[
            ("dagger", false),
            ("fist", false),
            ("mace", true),
            ("off_hand", false),
            ("polearm", true),
            ("staff", true),
        ],
        "shaman" => &[
            ("axe", true),
            ("dagger", false),
            ("fist", false),
            ("mace", true),
            ("off_hand", false),
            ("shield", false),
            ("staff", true),
        ],
        "mage" | "warlock" => &[
            ("dagger", false),
            ("off_hand", false),
            ("staff", true),
            ("sword", false),
        ],
        "priest" => &[
            ("dagger", false),
            ("mace", false),
            ("off_hand", false),
            ("staff", true),
        ],
        _ => &[],
    }
}

fn ranged(class: &str) -> &'static [&'static str] {
    match class {
        "warrior" | "rogue" => &["bow", "crossbow", "gun", "thrown"],
        "hunter" => &["bow", "crossbow", "gun"],
        "mage" | "priest" | "warlock" => &["wand"],
        "druid" => &["idol"],
        "paladin" => &["libram"],
        "shaman" => &["totem"],
        _ => &[],
    }
}

fn dual_wields(class: &str, level: u32) -> bool {
    class == "rogue" || (matches!(class, "warrior" | "hunter") && level >= 20)
}

/// The engine equipment slots the item may go in for this character; empty when it can't wear it.
pub fn slots_for(item: &ForeverItem, class: &str, level: u32) -> Vec<usize> {
    if item.req_level > level
        || (!item.classes.is_empty() && !item.classes.iter().any(|c| c == class))
    {
        return Vec::new();
    }
    if !item.armor.is_empty() && armor_rank(&item.armor) > max_armor(class, level) {
        return Vec::new();
    }
    match item.item_type {
        1..=10 => vec![item.item_type as usize - 1],
        11 => vec![10, 11],
        12 => vec![12, 13],
        13 => {
            let Some(&(_, two_hand)) = weapons(class).iter().find(|(kind, _)| *kind == item.weapon)
            else {
                return Vec::new();
            };
            match item.hand.as_str() {
                "two_hand" if two_hand => vec![MAIN_HAND],
                "two_hand" => Vec::new(),
                "main_hand" => vec![MAIN_HAND],
                // Shields and held-in-off-hand items need no dual wield; off-hand weapons do.
                "off_hand" if matches!(item.weapon.as_str(), "shield" | "off_hand") => {
                    vec![OFF_HAND]
                }
                "off_hand" if dual_wields(class, level) => vec![OFF_HAND],
                "off_hand" => Vec::new(),
                _ if dual_wields(class, level) => vec![MAIN_HAND, OFF_HAND],
                _ => vec![MAIN_HAND],
            }
        }
        14 if ranged(class).contains(&item.weapon.as_str()) => vec![RANGED],
        _ => Vec::new(),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DropItem {
    pub item_id: u32,
    pub from: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub standing: String,
    pub slots: Vec<usize>,
}

/// One source as the Drop Finder lists it for a character.
#[derive(Debug, Clone, Serialize)]
pub struct DropGroup {
    pub key: String,
    pub category: String,
    pub name: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub zone: String,
    /// An instance's entry level; 0 for other sources.
    pub level: u32,
    pub new: bool,
    /// Gear this source has for anyone.
    pub total: usize,
    /// Gear from here the character can wear. Items with a random suffix are left out: which
    /// suffix drops is not known.
    pub items: Vec<DropItem>,
}

/// Every source with the items from it this character can wear.
pub fn catalog(ch: &ForeverCharacter, data: &ForeverData) -> Vec<DropGroup> {
    let side = side(&ch.race);
    data.sources
        .iter()
        .map(|g| {
            let mut seen = HashSet::new();
            let items = g
                .items
                .iter()
                .filter(|e| e.side.is_empty() || Some(e.side.as_str()) == side)
                .filter(|e| e.classes.is_empty() || e.classes.contains(&ch.class))
                .filter_map(|e| {
                    let item = data.items.get(&e.id).filter(|i| !i.suffix)?;
                    let slots = slots_for(item, &ch.class, ch.level);
                    (!slots.is_empty() && seen.insert(e.id)).then(|| DropItem {
                        item_id: e.id,
                        from: e.from.clone(),
                        standing: e.standing.clone(),
                        slots,
                    })
                })
                .collect();
            DropGroup {
                key: group_key(&g.category, &g.name),
                category: g.category.clone(),
                name: g.name.clone(),
                zone: g.zone.clone(),
                level: g.level,
                new: g.new,
                total: g.items.iter().map(|e| e.id).collect::<HashSet<_>>().len(),
                items,
            }
        })
        .collect()
}

pub fn group_key(category: &str, name: &str) -> String {
    format!("{category}:{name}")
}

/// The items of the chosen sources, each once (with the first source that has it).
pub fn chosen(catalog: &[DropGroup], keys: &[String]) -> Vec<(DropItem, String)> {
    let mut seen = HashSet::new();
    catalog
        .iter()
        .filter(|g| keys.contains(&g.key))
        .flat_map(|g| g.items.iter().map(move |i| (i.clone(), g.name.clone())))
        .filter(|(i, _)| seen.insert(i.item_id))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::forever::data::{SourceGroup, SourceItem};

    fn item(
        id: u32,
        item_type: u8,
        armor: &str,
        weapon: &str,
        hand: &str,
        req_level: u32,
    ) -> ForeverItem {
        ForeverItem {
            id,
            name: format!("Item {id}"),
            icon: String::new(),
            item_type,
            quality: 3,
            ilvl: 30,
            suffix: false,
            req_level,
            armor: armor.into(),
            weapon: weapon.into(),
            hand: hand.into(),
            classes: Vec::new(),
        }
    }

    #[test]
    fn mail_waits_for_level_40() {
        let mail_chest = item(1, 5, "mail", "", "", 25);
        assert!(slots_for(&mail_chest, "hunter", 29).is_empty());
        assert_eq!(slots_for(&mail_chest, "hunter", 40), vec![4]);
        assert_eq!(slots_for(&mail_chest, "warrior", 29), vec![4]);
        assert!(slots_for(&mail_chest, "rogue", 60).is_empty());
        let plate = item(2, 1, "plate", "", "", 40);
        assert!(slots_for(&plate, "paladin", 39).is_empty());
        assert_eq!(slots_for(&plate, "paladin", 40), vec![0]);
        assert!(slots_for(&plate, "shaman", 60).is_empty());
    }

    #[test]
    fn a_higher_required_level_or_another_class_cant_wear_it() {
        assert!(slots_for(&item(1, 2, "", "", "", 30), "mage", 29).is_empty());
        let mut libram = item(2, 14, "", "libram", "", 0);
        assert_eq!(slots_for(&libram, "paladin", 20), vec![16]);
        assert!(slots_for(&libram, "priest", 20).is_empty());
        libram.classes = vec!["paladin".into()];
        assert!(slots_for(&libram, "warrior", 20).is_empty());
    }

    #[test]
    fn weapons_follow_the_class_and_dual_wield() {
        let one_hand_sword = item(1, 13, "", "sword", "one_hand", 0);
        assert_eq!(slots_for(&one_hand_sword, "rogue", 10), vec![14, 15]);
        assert_eq!(slots_for(&one_hand_sword, "hunter", 19), vec![14]);
        assert_eq!(slots_for(&one_hand_sword, "hunter", 20), vec![14, 15]);
        assert_eq!(slots_for(&one_hand_sword, "mage", 20), vec![14]);
        assert!(slots_for(&one_hand_sword, "priest", 20).is_empty());
        let two_hand_sword = item(2, 13, "", "sword", "two_hand", 0);
        assert!(slots_for(&two_hand_sword, "rogue", 20).is_empty());
        assert_eq!(slots_for(&two_hand_sword, "warrior", 20), vec![14]);
        let shield = item(3, 13, "", "shield", "off_hand", 0);
        assert_eq!(slots_for(&shield, "shaman", 10), vec![15]);
        assert!(slots_for(&shield, "rogue", 10).is_empty());
        let off_hand_dagger = item(4, 13, "", "dagger", "off_hand", 0);
        assert!(slots_for(&off_hand_dagger, "mage", 30).is_empty());
        assert_eq!(slots_for(&off_hand_dagger, "rogue", 30), vec![15]);
        let bow = item(5, 14, "", "bow", "", 0);
        assert_eq!(slots_for(&bow, "hunter", 10), vec![16]);
        assert!(slots_for(&bow, "mage", 10).is_empty());
    }

    #[test]
    fn rings_and_trinkets_go_in_either_slot() {
        assert_eq!(
            slots_for(&item(1, 11, "", "", "", 0), "mage", 10),
            vec![10, 11]
        );
        assert_eq!(
            slots_for(&item(2, 12, "", "", "", 0), "mage", 10),
            vec![12, 13]
        );
    }

    fn data_with(items: Vec<ForeverItem>, sources: Vec<SourceGroup>) -> ForeverData {
        let mut data = ForeverData {
            version: crate::forever::test_data().version.clone(),
            items: Default::default(),
            enchants: Default::default(),
            spells: Default::default(),
            spell_icons: Default::default(),
            talents: Default::default(),
            sources,
        };
        data.items = items.into_iter().map(|i| (i.id, i)).collect();
        data
    }

    fn entry(id: u32, from: &str, side: &str, classes: &[&str]) -> SourceItem {
        SourceItem {
            id,
            from: from.into(),
            side: side.into(),
            standing: String::new(),
            classes: classes.iter().map(|c| c.to_string()).collect(),
        }
    }

    #[test]
    fn the_catalog_keeps_what_the_character_can_get_and_wear() {
        let mut suffixed = item(5, 2, "", "", "", 0);
        suffixed.suffix = true;
        let data = data_with(
            vec![
                item(1, 1, "leather", "", "", 20),
                item(2, 1, "mail", "", "", 20),
                item(3, 2, "", "", "", 20),
                item(4, 2, "", "", "", 20),
                suffixed,
            ],
            vec![SourceGroup {
                category: "dungeon".into(),
                name: "Shadowfang Keep".into(),
                zone: String::new(),
                level: 14,
                new: false,
                items: vec![
                    entry(1, "Baron Silverlaine", "", &[]),
                    entry(1, "Trash", "", &[]),
                    entry(2, "Trash", "", &[]),
                    entry(3, "Arugal Must Die", "alliance", &[]),
                    entry(4, "Class quest", "", &["mage"]),
                    entry(5, "Trash", "", &[]),
                ],
            }],
        );
        let mut ch =
            crate::forever::import::parse_export(include_str!("testdata/sortbek.simc")).unwrap();
        ch.class = "hunter".into();
        ch.race = "orc".into();
        ch.level = 29;
        let groups = catalog(&ch, &data);
        assert_eq!(groups[0].key, "dungeon:Shadowfang Keep");
        assert_eq!(groups[0].total, 5);
        let got: Vec<(u32, &str)> = groups[0]
            .items
            .iter()
            .map(|i| (i.item_id, i.from.as_str()))
            .collect();
        assert_eq!(got, vec![(1, "Baron Silverlaine")]);
        let picked = chosen(
            &groups,
            &["dungeon:Shadowfang Keep".into(), "dungeon:Other".into()],
        );
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].1, "Shadowfang Keep");
    }
}
