//! SimC addon export (Forever client) to a character and a UI summary.

use std::collections::HashMap;

use serde::Serialize;

use super::data::ForeverData;
use super::detect::client_build;
use super::spec;
use super::talents;

const GEAR_SLOTS: [&str; 17] = [
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

#[derive(Debug, Clone, PartialEq)]
pub struct ExportItem {
    pub slot: String,
    pub item_id: u32,
    pub enchant_id: u32,
    /// The "of the ..." enchantment, which the addon writes as the item's bonus id.
    pub random_suffix: u32,
}

/// What the addon's "Additional Character Info" block reads off the character sheet, in the
/// engine's `CharacterSheet` shape. A character below level 60 sims from these.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterSheet {
    pub level: u32,
    /// Strength, Agility, Stamina, Intellect, Spirit without gear or buffs.
    pub base: [f64; 5],
    pub attributes: [f64; 5],
    pub attribute_buffs: [f64; 5],
    pub health: f64,
    pub mana: f64,
    pub melee_crit: f64,
    pub ranged_crit: f64,
    /// Holy to Arcane; the addon exports one spell crit for all schools.
    pub spell_crit: [f64; 6],
    pub spell_power: [f64; 6],
    pub healing_power: f64,
    pub dodge: f64,
    pub parry: f64,
    pub block: f64,
    /// Base, positive and negative parts.
    pub attack_power: [f64; 3],
    pub ranged_attack_power: [f64; 3],
    /// Base and total.
    pub armor: [f64; 2],
    /// Base and while casting.
    pub mana_regen: [f64; 2],
    pub auras: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Pet {
    pub family: String,
    pub attack_speed: f64,
}

#[derive(Debug, Clone)]
pub struct ForeverCharacter {
    pub name: String,
    pub class: String,
    pub race: String,
    pub level: u32,
    pub professions: Vec<(String, u32)>,
    pub talents_loadout: Option<String>,
    pub client_build: Option<String>,
    pub equipped: Vec<ExportItem>,
    pub bags: Vec<ExportItem>,
    pub sheet: Option<CharacterSheet>,
    pub pet: Option<Pet>,
}

/// `a:1:2/b:3` to name -> numbers.
fn info_fields(value: &str) -> HashMap<&str, Vec<f64>> {
    value
        .split('/')
        .filter_map(|part| {
            let mut bits = part.split(':');
            let name = bits.next()?;
            Some((name, bits.filter_map(|n| n.parse().ok()).collect()))
        })
        .collect()
}

fn sheet_from(info: &HashMap<String, String>, level: u32) -> Option<CharacterSheet> {
    let fields = |key: &str| info.get(key).map(|v| info_fields(v)).unwrap_or_default();
    let (stats, base) = (fields("character_stats"), fields("character_stats_base"));
    let at = |f: &HashMap<&str, Vec<f64>>, name: &str, i: usize| {
        f.get(name).and_then(|v| v.get(i)).copied().unwrap_or(0.0)
    };
    const ATTRIBUTES: [&str; 5] = ["strength", "agility", "stamina", "intellect", "spirit"];
    if !ATTRIBUTES
        .iter()
        .all(|a| base.contains_key(a) && stats.contains_key(a))
    {
        return None;
    }
    let (bonus, ap, crit, defense, regen, power) = (
        fields("character_stats_bonus"),
        fields("attack_power"),
        fields("crit"),
        fields("defense"),
        fields("regen"),
        fields("spell_power"),
    );
    let triple = |name: &str| [at(&ap, name, 0), at(&ap, name, 1), at(&ap, name, 2)];
    const SCHOOLS: [&str; 6] = ["holy", "fire", "nature", "frost", "shadow", "arcane"];
    Some(CharacterSheet {
        level,
        base: ATTRIBUTES.map(|a| at(&base, a, 0)),
        attributes: ATTRIBUTES.map(|a| at(&stats, a, 0)),
        attribute_buffs: ATTRIBUTES.map(|a| at(&bonus, a, 0)),
        health: at(&stats, "health", 0),
        mana: at(&stats, "mana", 0),
        melee_crit: at(&crit, "melee", 0),
        ranged_crit: at(&crit, "ranged", 0),
        spell_crit: [at(&crit, "spell", 0); 6],
        spell_power: SCHOOLS.map(|s| at(&power, s, 0)),
        healing_power: at(&fields("spell_stats"), "healing", 0),
        dodge: at(&defense, "dodge", 0),
        parry: at(&defense, "parry", 0),
        block: at(&defense, "block", 0),
        attack_power: triple("melee"),
        ranged_attack_power: triple("ranged"),
        armor: [
            at(&defense, "armor_base", 0),
            at(&defense, "armor_effective", 0),
        ],
        mana_regen: [at(&regen, "mana", 0), at(&regen, "mana", 1)],
        auras: info
            .get("buffs")
            .map(|v| {
                v.split('/')
                    .filter_map(|b| b.split(':').next()?.parse().ok())
                    .collect()
            })
            .unwrap_or_default(),
    })
}

fn parse_item(line: &str) -> Option<ExportItem> {
    let (slot, rest) = line.split_once('=')?;
    if !GEAR_SLOTS.contains(&slot) {
        return None;
    }
    let mut item = ExportItem {
        slot: slot.to_string(),
        item_id: 0,
        enchant_id: 0,
        random_suffix: 0,
    };
    for opt in rest.split(',') {
        if let Some(v) = opt.strip_prefix("id=") {
            item.item_id = v.parse().ok()?;
        } else if let Some(v) = opt.strip_prefix("enchant_id=") {
            item.enchant_id = v.parse().unwrap_or(0);
        } else if let Some(v) = opt.strip_prefix("bonus_id=") {
            item.random_suffix = v
                .split(['/', ':'])
                .next()
                .and_then(|n| n.parse().ok())
                .unwrap_or(0);
        }
    }
    (item.item_id > 0).then_some(item)
}

pub fn parse_export(input: &str) -> Result<ForeverCharacter, String> {
    let mut ch = ForeverCharacter {
        name: String::new(),
        class: String::new(),
        race: String::new(),
        level: 0,
        professions: Vec::new(),
        talents_loadout: None,
        client_build: client_build(input),
        equipped: Vec::new(),
        bags: Vec::new(),
        sheet: None,
        pet: None,
    };
    let mut info: HashMap<String, String> = HashMap::new();
    let mut pet_family = None;
    let mut in_bags = false;
    for raw in input.lines() {
        let line = raw.trim();
        if line.starts_with("###") {
            in_bags = line.starts_with("### Gear from Bags");
            continue;
        }
        if let Some(commented) = line.strip_prefix("# ") {
            if in_bags {
                if let Some(item) = parse_item(commented.trim()) {
                    ch.bags.push(item);
                }
            } else if let Some((key, value)) = commented.trim().split_once('=') {
                info.insert(key.to_string(), value.to_string());
            }
            continue;
        }
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match key {
            "level" => ch.level = value.parse().unwrap_or(0),
            "race" => ch.race = value.to_string(),
            "pet_family" => pet_family = Some(value.to_string()),
            "talents" if ch.talents_loadout.is_none() => {
                ch.talents_loadout = Some(value.to_string())
            }
            "professions" => {
                ch.professions = value
                    .split('/')
                    .filter_map(|p| {
                        let (name, rank) = p.split_once('=')?;
                        Some((name.to_string(), rank.parse().ok()?))
                    })
                    .collect();
            }
            _ if spec::engine_class(key).is_some() && ch.class.is_empty() => {
                ch.class = key.to_string();
                ch.name = value.trim_matches('"').to_string();
            }
            _ => {
                if let Some(item) = parse_item(line) {
                    ch.equipped.push(item);
                }
            }
        }
    }
    if ch.class.is_empty() {
        return Err("No class line found in the export".into());
    }
    if spec::engine_race(&ch.race).is_none() {
        return Err(format!("Unsupported race \"{}\"", ch.race));
    }
    ch.sheet = sheet_from(&info, ch.level);
    ch.pet = pet_family.map(|family| Pet {
        family,
        attack_speed: info
            .get("pet_weapon_damage")
            .and_then(|v| info_fields(v).get("mainhand")?.get(2).copied())
            .unwrap_or(0.0),
    });
    Ok(ch)
}

#[derive(Debug, Serialize)]
pub struct GearView {
    pub slot: String,
    pub item_id: u32,
    pub enchant_id: u32,
    pub random_suffix: u32,
    pub name: String,
    pub icon: String,
    pub quality: u8,
    pub ilevel: u32,
    pub known: bool,
}

#[derive(Debug, Serialize)]
pub struct ImportSummary {
    pub game: &'static str,
    pub name: String,
    pub class: String,
    pub race: String,
    pub level: u32,
    /// The export carries the character stats a sim below level 60 needs.
    pub has_sheet: bool,
    pub client_build: Option<String>,
    pub spec_key: Option<String>,
    pub spec_choices: Vec<String>,
    pub talents_string: String,
    pub points_per_tree: Vec<u32>,
    pub talent_trees: Vec<talents::TalentTreeView>,
    pub equipped: Vec<GearView>,
    pub bags: Vec<GearView>,
    pub warnings: Vec<String>,
    pub can_sim: bool,
    pub blocked_reason: Option<String>,
}

fn gear_view(item: &ExportItem, data: &ForeverData, warnings: &mut Vec<String>) -> GearView {
    match data.items.get(&item.item_id) {
        Some(known) => GearView {
            slot: if known.item_type == spec::ITEM_TYPE_RANGED {
                "ranged".into()
            } else {
                item.slot.clone()
            },
            item_id: item.item_id,
            enchant_id: item.enchant_id,
            random_suffix: item.random_suffix,
            name: known.name.clone(),
            icon: known.icon.clone(),
            quality: known.quality,
            ilevel: known.ilvl,
            known: true,
        },
        None => {
            warnings.push(format!(
                "Unknown item {} in {} is left out",
                item.item_id, item.slot
            ));
            GearView {
                slot: item.slot.clone(),
                item_id: item.item_id,
                enchant_id: item.enchant_id,
                random_suffix: item.random_suffix,
                name: format!("Item {}", item.item_id),
                icon: String::new(),
                quality: 0,
                ilevel: 0,
                known: false,
            }
        }
    }
}

pub fn summarize(ch: &ForeverCharacter, data: &ForeverData) -> ImportSummary {
    let mut warnings = Vec::new();
    let equipped: Vec<GearView> = ch
        .equipped
        .iter()
        .map(|i| gear_view(i, data, &mut warnings))
        .collect();
    // Unknown bag items (profession tools and the like) are just not offered in Top Gear.
    let bags: Vec<GearView> = ch
        .bags
        .iter()
        .map(|i| gear_view(i, data, &mut Vec::new()))
        .collect();
    if ch.class == "hunter" && !equipped.iter().any(|g| g.slot == "ranged") {
        warnings.push(
            "This export has no ranged weapon, so this hunter sims without a bow or gun and its DPS will be far too low. Update the SimC addon if one is equipped"
                .into(),
        );
    }
    for item in ch.equipped.iter().filter(|i| i.random_suffix == 0) {
        if let Some(known) = data.items.get(&item.item_id).filter(|i| i.suffix) {
            warnings.push(format!(
                "{} can have a random suffix (\"of the …\"); the export does not include it, so it sims without those stats",
                known.name
            ));
        }
    }
    if let Some(build) = ch
        .client_build
        .as_deref()
        .filter(|b| *b != data.version.client_build)
    {
        warnings.push(format!(
            "Your game build {build} differs from the sim data ({}); talents may be read wrong until the data is updated",
            data.version.client_build
        ));
    }
    let (talents_string, points_per_tree, ranks) =
        match (ch.talents_loadout.as_deref(), data.talents.get(&ch.class)) {
            (Some(loadout), Some(class)) => match talents::decode(loadout, class) {
                Ok(d) => {
                    if !d.unknown_definitions.is_empty() {
                        warnings.push(format!(
                            "{} talents are not known to the engine and are left out",
                            d.unknown_definitions.len()
                        ));
                    }
                    (d.talents_string, d.points_per_tree, d.ranks)
                }
                Err(e) => {
                    warnings.push(format!("Talents could not be read: {e}"));
                    (String::new(), Vec::new(), Vec::new())
                }
            },
            _ => {
                warnings.push("No talents in the export".into());
                (String::new(), Vec::new(), Vec::new())
            }
        };
    let spec_key = spec::derive_spec(&ch.class, &points_per_tree).map(str::to_string);
    let blocked_reason = spec::blocked_reason(ch.level, ch.sheet.is_some(), spec_key.as_deref());
    ImportSummary {
        game: "forever",
        name: ch.name.clone(),
        class: ch.class.clone(),
        race: ch.race.clone(),
        level: ch.level,
        has_sheet: ch.sheet.is_some(),
        client_build: ch.client_build.clone(),
        spec_key,
        spec_choices: spec::spec_choices(&ch.class)
            .iter()
            .map(|s| s.to_string())
            .collect(),
        talents_string,
        points_per_tree,
        talent_trees: data
            .talents
            .get(&ch.class)
            .map(|class| talents::tree_views(class, &ranks))
            .unwrap_or_default(),
        equipped,
        bags,
        warnings,
        can_sim: blocked_reason.is_none(),
        blocked_reason,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sylfrey() -> &'static str {
        include_str!("testdata/sylfrey.simc")
    }

    fn at60() -> String {
        sylfrey().replace("level=27", "level=60")
    }

    #[test]
    fn parses_character_gear_and_bags() {
        let ch = parse_export(sylfrey()).unwrap();
        assert_eq!(
            (
                ch.name.as_str(),
                ch.class.as_str(),
                ch.race.as_str(),
                ch.level
            ),
            ("Sylfrey", "paladin", "undead", 27)
        );
        assert_eq!(
            ch.professions,
            vec![
                ("blacksmithing".to_string(), 83),
                ("mining".to_string(), 104)
            ]
        );
        assert_eq!(
            ch.talents_loadout.as_deref(),
            Some("C4cBVQDZr24kTJEclZxwfbGlGBAYmLAjZAAAwMDA")
        );
        assert_eq!(ch.client_build.as_deref(), Some("1.60.1.70374"));
        assert_eq!(ch.equipped.len(), 15, "shirt is skipped");
        assert!(ch
            .equipped
            .iter()
            .any(|i| i.slot == "main_hand" && i.item_id == 273637));
        assert_eq!(ch.bags.len(), 5);
        assert!(ch
            .bags
            .iter()
            .any(|i| i.slot == "back" && i.item_id == 6314));
    }

    #[test]
    fn summary_blocks_below_60_and_names_items() {
        let s = summarize(
            &parse_export(sylfrey()).unwrap(),
            crate::forever::test_data(),
        );
        assert_eq!(s.spec_key.as_deref(), Some("protectionPaladin"));
        assert_eq!(
            s.spec_choices,
            vec!["retributionPaladin", "protectionPaladin"]
        );
        assert_eq!(s.talents_string, "-05005133210012");
        assert!(!s.can_sim);
        assert_eq!(
            s.blocked_reason.as_deref(),
            Some("Below level 60 the sim needs your character stats. Update the SimC addon and export again")
        );
        let blade = s.equipped.iter().find(|g| g.item_id == 273637).unwrap();
        assert_eq!(
            (blade.name.as_str(), blade.ilevel, blade.known),
            ("Blade of Silverlaine", 26, true)
        );
        assert!(s.warnings.is_empty(), "{:?}", s.warnings);
    }

    #[test]
    fn level_60_with_dps_talents_can_sim() {
        let s = summarize(&parse_export(&at60()).unwrap(), crate::forever::test_data());
        assert!(s.can_sim, "{:?}", s.blocked_reason);
    }

    #[test]
    fn summary_carries_the_talent_trees() {
        let s = summarize(&parse_export(&at60()).unwrap(), crate::forever::test_data());
        assert_eq!(s.talent_trees.len(), 3);
        assert_eq!(s.talent_trees[1].points, 23);
    }

    #[test]
    fn holy_tree_is_blocked_but_offers_dps_specs() {
        let s = summarize(&parse_export(&at60()).unwrap(), crate::forever::test_data());
        assert!(spec::blocked_reason(60, false, Some("holyPaladin")).is_some());
        assert!(s.spec_choices.iter().all(|k| spec::is_supported(k)));
    }

    #[test]
    fn unknown_race_is_an_error_and_skyborne_maps() {
        let err = parse_export(&sylfrey().replace("race=undead", "race=vulpera")).unwrap_err();
        assert!(err.contains("vulpera"), "{err}");
        let ch = parse_export(&sylfrey().replace("race=undead", "race=skyborne_horde")).unwrap();
        assert_eq!(spec::engine_race(&ch.race), Some("RaceWindshaperSkyborne"));
    }

    #[test]
    fn unknown_item_is_a_warning() {
        let s = summarize(
            &parse_export(&sylfrey().replace("id=280766", "id=999999")).unwrap(),
            crate::forever::test_data(),
        );
        assert!(s.warnings.iter().any(|w| w.contains("999999")));
    }

    #[test]
    fn bad_talents_are_a_warning_and_sim_without_them() {
        let input = at60().replace(
            "talents=C4cBVQDZr24kTJEclZxwfbGlGBAYmLAjZAAAwMDA\n",
            "talents=C4cB\n",
        );
        let s = summarize(&parse_export(&input).unwrap(), crate::forever::test_data());
        assert!(s
            .warnings
            .iter()
            .any(|w| w.starts_with("Talents could not be read")));
        assert_eq!(s.talents_string, "");
        assert_eq!(s.spec_key.as_deref(), Some("retributionPaladin"));
    }

    #[test]
    fn newer_client_build_warns() {
        let input = sylfrey().replace("1.60.1.70374, TOC", "1.60.1.70999, TOC");
        let s = summarize(&parse_export(&input).unwrap(), crate::forever::test_data());
        assert!(
            s.warnings.iter().any(|w| w.contains("1.60.1.70999")),
            "{:?}",
            s.warnings
        );
    }

    #[test]
    fn suffix_item_warns() {
        let input = sylfrey().replace("finger1=,id=6414", "finger1=,id=862");
        let s = summarize(&parse_export(&input).unwrap(), crate::forever::test_data());
        assert!(
            s.warnings
                .iter()
                .any(|w| w.contains("Runed Ring") && w.contains("random suffix")),
            "{:?}",
            s.warnings
        );
    }

    fn sortbek() -> &'static str {
        include_str!("testdata/sortbek.simc")
    }

    #[test]
    fn live_export_gives_the_ranged_slot_suffix_pet_and_sheet() {
        let ch = parse_export(sortbek()).unwrap();
        let worn = |slot: &str| ch.equipped.iter().find(|i| i.slot == slot).unwrap();
        assert_eq!(worn("ranged").item_id, 273843);
        assert_eq!(worn("main_hand").random_suffix, 12726);
        assert_eq!(worn("chest").enchant_id, 15);
        assert!(ch
            .bags
            .iter()
            .any(|i| i.item_id == 15117 && i.random_suffix == 12756));
        assert_eq!(
            ch.pet,
            Some(Pet {
                family: "raptor".into(),
                attack_speed: 2.0
            })
        );
        let sheet = ch.sheet.unwrap();
        assert_eq!(sheet.level, 29);
        assert_eq!(sheet.base, [36.0, 58.0, 50.0, 33.0, 43.0]);
        assert_eq!(sheet.attributes, [54.0, 93.0, 83.0, 33.0, 61.0]);
        assert_eq!(sheet.attribute_buffs, [18.0, 35.0, 33.0, 0.0, 18.0]);
        assert_eq!((sheet.health, sheet.mana), (1028.0, 960.0));
        assert_eq!((sheet.melee_crit, sheet.ranged_crit), (3.81, 4.01));
        assert_eq!(sheet.spell_crit, [4.65; 6]);
        assert_eq!(sheet.attack_power, [185.0, 6.0, 0.0]);
        assert_eq!(sheet.ranged_attack_power, [224.0, 41.0, 0.0]);
        assert_eq!(sheet.armor, [44.0, 712.0]);
        assert_eq!(sheet.mana_regen, [13.88, 0.0]);
        assert_eq!((sheet.dodge, sheet.parry, sheet.block), (7.45, 4.36, 0.0));
        assert_eq!(sheet.auras, vec![14318, 19883]);
    }

    #[test]
    fn a_levelling_character_with_a_sheet_can_sim() {
        let ch = parse_export(sortbek()).unwrap();
        let s = summarize(&ch, crate::forever::test_data());
        assert_eq!((s.level, s.can_sim), (29, true));
        assert_eq!(s.blocked_reason, None);
        assert!(
            !s.warnings.iter().any(|w| w.contains("ranged weapon")),
            "{:?}",
            s.warnings
        );
        assert_eq!(
            spec::blocked_reason(9, true, Some("hunter")).as_deref(),
            Some("Forever sims work from level 10")
        );
    }

    #[test]
    fn a_suffix_in_the_export_does_not_warn() {
        let input = sylfrey().replace("finger1=,id=6414", "finger1=,id=862,bonus_id=12726");
        let s = summarize(&parse_export(&input).unwrap(), crate::forever::test_data());
        assert!(
            !s.warnings.iter().any(|w| w.contains("random suffix")),
            "{:?}",
            s.warnings
        );
    }

    #[test]
    fn hunter_without_ranged_warns_and_bag_bow_goes_to_ranged() {
        let data = crate::forever::test_data();
        let base =
            "# WoW 1.60.1.70374, TOC 16001\nhunter=\"H\"\nlevel=60\nrace=orc\nspec=unknown\n";
        let s = summarize(&parse_export(base).unwrap(), data);
        assert!(
            s.warnings.iter().any(|w| w.contains("ranged weapon")),
            "{:?}",
            s.warnings
        );
        let with_bag_bow = format!("{base}### Gear from Bags\n# main_hand=,id=2824\n");
        let s = summarize(&parse_export(&with_bag_bow).unwrap(), data);
        assert!(s
            .bags
            .iter()
            .any(|g| g.item_id == 2824 && g.slot == "ranged"));
    }
}
