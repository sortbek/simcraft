//! SimC addon export (Forever client) to a character and a UI summary.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

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
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
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
    /// Battle.net region (`eu`, `us`, ...); empty when the export names none.
    pub region: String,
    pub class: String,
    pub race: String,
    pub level: u32,
    pub professions: Vec<(String, u32)>,
    pub talents_loadout: Option<String>,
    /// Talents already in the engine's string form (the MythicSim export's).
    pub talents_string: Option<String>,
    pub client_build: Option<String>,
    pub equipped: Vec<ExportItem>,
    pub bags: Vec<ExportItem>,
    pub sheet: Option<CharacterSheet>,
    pub pet: Option<Pet>,
    /// Item id of the arrows or bullets in the ammo slot.
    pub ammo_id: u32,
    /// Spell ids the spellbook lists; empty when the export has no spellbook.
    pub known_spells: Vec<u32>,
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

/// A Forever character can have a second name, which the MythicSim addon writes as the realm. A
/// real realm reads like "camwow eu5 realm 6 pvp": more than one word, or with digits.
fn mythicsim_name(name: &str, realm: &str) -> String {
    let (name, realm) = (name.trim(), realm.trim());
    let second_name = !realm.is_empty()
        && !realm.contains(|c: char| c.is_whitespace() || c.is_ascii_digit() || c == '_');
    if second_name {
        format!("{name} {realm}")
    } else {
        name.to_string()
    }
}

/// The MythicSim addon's JSON export. Its gear has no slots (see [`place_items`]) and its talents
/// are already the engine's string; it also carries the spellbook, which the SimC export lacks.
fn parse_mythicsim(input: &str) -> Result<ForeverCharacter, String> {
    let export: serde_json::Value = serde_json::from_str(input)
        .map_err(|e| format!("The MythicSim export is not valid JSON: {e}"))?;
    let extra = &export["mythicsim"];
    let text = |value: &serde_json::Value| value.as_str().unwrap_or("").to_string();
    let token = |value: &serde_json::Value| text(value).trim().to_lowercase().replace(' ', "_");
    let items = |list: &serde_json::Value| -> Vec<ExportItem> {
        list.as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| {
                Some(ExportItem {
                    slot: String::new(),
                    item_id: item["id"].as_u64().filter(|id| *id > 0)? as u32,
                    enchant_id: item["enchant"].as_u64().unwrap_or(0) as u32,
                    random_suffix: item["random_suffix"].as_u64().unwrap_or(0) as u32,
                })
            })
            .collect()
    };
    let mut race = token(&export["race"]);
    if race.contains("skyborne") {
        let horde = text(&extra["faction"]).eq_ignore_ascii_case("horde");
        race = if horde {
            "skyborne_horde"
        } else {
            "skyborne_alliance"
        }
        .into();
    }
    let level = export["level"].as_u64().unwrap_or(0) as u32;
    let ch = ForeverCharacter {
        name: mythicsim_name(&text(&export["name"]), &text(&export["realm"])),
        region: text(&extra["region"]).trim().to_lowercase(),
        class: token(&export["class"]),
        race,
        level,
        professions: export["professions"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| (token(&p["name"]), p["level"].as_u64().unwrap_or(0) as u32))
            .collect(),
        talents_loadout: None,
        talents_string: export["talents"].as_str().map(str::to_string),
        client_build: match (
            extra["clientVersion"].as_str(),
            extra["clientBuild"].as_str(),
        ) {
            (Some(version), Some(build)) => Some(format!("{version}.{build}")),
            _ => None,
        },
        equipped: items(&export["gear"]["items"]),
        bags: items(&export["bags"]),
        sheet: serde_json::from_value::<CharacterSheet>(extra["sheet"].clone())
            .ok()
            .map(|sheet| CharacterSheet { level, ..sheet }),
        pet: extra["pet"]["family"].as_str().map(|family| Pet {
            family: family.trim().to_lowercase().replace(' ', "_"),
            attack_speed: extra["pet"]["attackSpeed"].as_f64().unwrap_or(0.0),
        }),
        // The export has no ammo slot; the arrows or bullets carried in the bags are what is shot.
        ammo_id: export["bags"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| Some(item["id"].as_u64()? as u32))
            .find(|id| spec::engine_ammo(*id).is_some())
            .unwrap_or(0),
        known_spells: extra["knownSpells"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|id| Some(id.as_u64()? as u32))
            .collect(),
    };
    if spec::engine_class(&ch.class).is_none() {
        return Err("No class found in the export".into());
    }
    if spec::engine_race(&ch.race).is_none() {
        return Err(format!("Unsupported race \"{}\"", ch.race));
    }
    Ok(ch)
}

/// Gives items that came without a slot (the MythicSim export's) the slot their type fits: the
/// first ring, trinket and weapon take the first slot of their pair, the next one the second.
pub fn place_items(ch: &mut ForeverCharacter, data: &ForeverData) {
    let slot_of = |item: &ExportItem, taken: &[String]| -> String {
        let Some(known) = data.items.get(&item.item_id) else {
            return String::new();
        };
        let pair = |first: &str, second: &str| {
            if taken.iter().any(|slot| slot == first) {
                second
            } else {
                first
            }
            .to_string()
        };
        match known.item_type {
            1 => "head".into(),
            2 => "neck".into(),
            3 => "shoulder".into(),
            4 => "back".into(),
            5 => "chest".into(),
            6 => "wrist".into(),
            7 => "hands".into(),
            8 => "waist".into(),
            9 => "legs".into(),
            10 => "feet".into(),
            11 => pair("finger1", "finger2"),
            12 => pair("trinket1", "trinket2"),
            13 => pair("main_hand", "off_hand"),
            spec::ITEM_TYPE_RANGED => "ranged".into(),
            _ => String::new(),
        }
    };
    let mut taken: Vec<String> = Vec::new();
    for item in ch.equipped.iter_mut().filter(|i| i.slot.is_empty()) {
        item.slot = slot_of(item, &taken);
        taken.push(item.slot.clone());
    }
    // A bag item only needs the slot it could go in.
    for item in ch.bags.iter_mut().filter(|i| i.slot.is_empty()) {
        item.slot = slot_of(item, &[]);
    }
}

/// [`parse_export`], with slotless items placed by the engine bundle's item types.
pub fn parse_export_with(input: &str, data: &ForeverData) -> Result<ForeverCharacter, String> {
    let mut ch = parse_export(input)?;
    place_items(&mut ch, data);
    Ok(ch)
}

pub fn parse_export(input: &str) -> Result<ForeverCharacter, String> {
    if super::detect::is_mythicsim_export(input) {
        return parse_mythicsim(input);
    }
    let mut ch = ForeverCharacter {
        name: String::new(),
        region: String::new(),
        class: String::new(),
        race: String::new(),
        level: 0,
        professions: Vec::new(),
        talents_loadout: None,
        talents_string: None,
        client_build: client_build(input),
        equipped: Vec::new(),
        bags: Vec::new(),
        sheet: None,
        pet: None,
        ammo_id: 0,
        known_spells: Vec::new(),
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
            "region" => ch.region = value.trim().to_lowercase(),
            "race" => ch.race = value.to_string(),
            "pet_family" => pet_family = Some(value.to_string()),
            "ammo" => {
                ch.ammo_id = value
                    .split(',')
                    .find_map(|opt| opt.strip_prefix("id=")?.parse().ok())
                    .unwrap_or(0)
            }
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
    pub region: String,
    pub class: String,
    pub race: String,
    pub level: u32,
    /// The export carries the character stats a sim below level 60 needs.
    pub has_sheet: bool,
    pub client_build: Option<String>,
    pub spec_key: Option<String>,
    pub spec_choices: Vec<String>,
    pub talents_string: String,
    /// What the export itself carries; differs from `talents_string` once edited.
    pub exported_talents_string: String,
    /// Talent points a character of this level has.
    pub max_talent_points: u32,
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

/// The last part of `1.60.1.70938`; builds only count up.
fn build_number(build: &str) -> u64 {
    build
        .rsplit('.')
        .next()
        .and_then(|n| n.trim().parse().ok())
        .unwrap_or(0)
}

pub fn summarize(ch: &ForeverCharacter, data: &ForeverData) -> ImportSummary {
    summarize_with(ch, data, None)
}

/// [`summarize`] with the talents someone edited in the calculator in place of the export's.
pub fn summarize_with(
    ch: &ForeverCharacter,
    data: &ForeverData,
    edited_talents: Option<&str>,
) -> ImportSummary {
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
        .filter(|b| build_number(b) > build_number(&data.version.client_build))
    {
        warnings.push(format!(
            "Your game build {build} is newer than the sim data ({}); talents may be read wrong until the data is updated",
            data.version.client_build
        ));
    }
    let (talents_string, points_per_tree, ranks) =
        match (ch.talents_loadout.as_deref(), data.talents.get(&ch.class)) {
            (None, Some(class)) if ch.talents_string.is_some() => {
                match talents::from_string(ch.talents_string.as_deref().unwrap_or(""), class) {
                    Ok(d) => (d.talents_string, d.points_per_tree, d.ranks),
                    Err(e) => {
                        warnings.push(format!("Talents could not be read: {e}"));
                        (String::new(), Vec::new(), Vec::new())
                    }
                }
            }
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
    let exported_talents_string = talents_string.clone();
    let (talents_string, points_per_tree, ranks) =
        match edited_talents.zip(data.talents.get(&ch.class)) {
            Some((edited, class)) => match talents::from_string(edited, class) {
                Ok(d) => (d.talents_string, d.points_per_tree, d.ranks),
                Err(e) => {
                    warnings.push(format!("The edited talents could not be read: {e}"));
                    (talents_string, points_per_tree, ranks)
                }
            },
            None => (talents_string, points_per_tree, ranks),
        };
    let spec_key = spec::derive_spec(&ch.class, &points_per_tree).map(str::to_string);
    let blocked_reason = spec::blocked_reason(ch.level, ch.sheet.is_some(), spec_key.as_deref());
    ImportSummary {
        game: "forever",
        name: ch.name.clone(),
        region: ch.region.clone(),
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
        exported_talents_string,
        max_talent_points: ch.level.saturating_sub(9),
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
            vec!["retributionPaladin", "protectionPaladin", "holyPaladin"]
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
    fn edited_talents_replace_the_exports_and_bad_ones_warn() {
        let ch = parse_export(&at60()).unwrap();
        let data = crate::forever::test_data();
        let s = summarize_with(&ch, data, Some("5-05"));
        assert_eq!(s.talents_string, "5-05");
        assert_eq!(s.exported_talents_string, "-05005133210012");
        assert_eq!(s.points_per_tree, vec![5, 5, 0]);
        assert_eq!(s.talent_trees[0].talents[0].rank, 5);
        assert_eq!(s.max_talent_points, 51);
        // Trailing zeros and trees are dropped, so the same build always reads the same.
        assert_eq!(
            summarize_with(&ch, data, Some("50-050-0")).talents_string,
            "5-05"
        );
        let bad = summarize_with(&ch, data, Some("9"));
        assert_eq!(bad.talents_string, "-05005133210012");
        assert!(
            bad.warnings.iter().any(|w| w.contains("edited talents")),
            "{:?}",
            bad.warnings
        );
    }

    #[test]
    fn summary_carries_the_talent_trees() {
        let s = summarize(&parse_export(&at60()).unwrap(), crate::forever::test_data());
        assert_eq!(s.talent_trees.len(), 3);
        assert_eq!(s.talent_trees[1].points, 23);
    }

    #[test]
    fn healers_sim_and_a_missing_spec_is_blocked() {
        let s = summarize(&parse_export(&at60()).unwrap(), crate::forever::test_data());
        assert_eq!(spec::blocked_reason(60, false, Some("holyPaladin")), None);
        assert!(spec::blocked_reason(60, false, None).is_some());
        assert!(s.spec_choices.contains(&"holyPaladin".to_string()));
        assert_eq!(
            spec::derive_spec("priest", &[20, 31, 0]),
            Some("healerPriest")
        );
        assert_eq!(spec::derive_spec("priest", &[0, 20, 31]), Some("dpsPriest"));
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
        assert_eq!(ch.region, "eu");
        assert_eq!(worn("ranged").item_id, 273843);
        assert_eq!(ch.ammo_id, 3030);
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

    fn mythicsim() -> &'static str {
        include_str!("testdata/sortbek.mythicsim.json")
    }

    #[test]
    fn mythicsim_export_reads_like_the_simc_one_and_brings_the_spellbook() {
        assert_eq!(
            crate::forever::detect_game(mythicsim()),
            crate::forever::Game::Forever
        );
        let ch = parse_export(mythicsim()).unwrap();
        assert_eq!(
            (
                ch.name.as_str(),
                ch.class.as_str(),
                ch.race.as_str(),
                ch.level
            ),
            ("Sortbek Hunter", "hunter", "orc", 29)
        );
        assert_eq!(ch.region, "eu");
        assert_eq!(
            mythicsim_name("Sortbek", "camwow_eu5_realm_6_pvp"),
            "Sortbek"
        );
        assert_eq!(mythicsim_name("Sortbek", "Realm 6"), "Sortbek");
        assert_eq!(mythicsim_name("Sortbek", ""), "Sortbek");
        assert_eq!(
            ch.professions,
            vec![
                ("leatherworking".to_string(), 101),
                ("skinning".to_string(), 170)
            ]
        );
        assert_eq!(ch.client_build.as_deref(), Some("1.60.1.70938"));
        assert_eq!(
            ch.talents_string.as_deref(),
            Some("5120221402100000-0000000000000000-000000000000000000")
        );
        assert_eq!(ch.equipped.len(), 13);
        assert!(ch
            .equipped
            .iter()
            .any(|i| i.item_id == 3210 && i.random_suffix == 12726));
        assert!(ch
            .equipped
            .iter()
            .any(|i| i.item_id == 270043 && i.enchant_id == 15));
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
        assert!(ch.known_spells.contains(&19434) && ch.known_spells.len() > 40);
        assert_eq!(ch.ammo_id, 3030, "the Razor Arrows in the bags");
        let sheet = ch.sheet.unwrap();
        let simc = parse_export(sortbek()).unwrap().sheet.unwrap();
        assert_eq!(
            (sheet.level, sheet.base, sheet.attributes),
            (29, simc.base, simc.attributes)
        );
        assert_eq!(
            (sheet.attack_power, sheet.ranged_attack_power, sheet.armor),
            (simc.attack_power, simc.ranged_attack_power, simc.armor)
        );
        assert_eq!(sheet.melee_crit, 3.8055);
    }

    #[test]
    fn slotless_items_take_the_slot_of_their_type() {
        let data = crate::forever::test_data();
        // The paladin's items, as the MythicSim export lists them: no slots, pairs in order.
        let ids = [273457, 6414, 6321, 273643, 280766, 273637, 6630];
        let mut ch = parse_export(mythicsim()).unwrap();
        ch.equipped = ids
            .iter()
            .map(|id| ExportItem {
                slot: String::new(),
                item_id: *id,
                enchant_id: 0,
                random_suffix: 0,
            })
            .collect();
        ch.bags = vec![ExportItem {
            slot: String::new(),
            item_id: 6314,
            enchant_id: 0,
            random_suffix: 0,
        }];
        place_items(&mut ch, data);
        let slots: Vec<&str> = ch.equipped.iter().map(|i| i.slot.as_str()).collect();
        assert_eq!(
            slots,
            [
                "neck",
                "finger1",
                "finger2",
                "trinket1",
                "trinket2",
                "main_hand",
                "off_hand"
            ]
        );
        assert_eq!(ch.bags[0].slot, "back");
    }

    #[test]
    fn mythicsim_talents_are_used_as_they_are() {
        let export = mythicsim()
            .replace("\"class\":\"hunter\"", "\"class\":\"paladin\"")
            .replace(
                "5120221402100000-0000000000000000-000000000000000000",
                "0-05005",
            );
        let ch = parse_export(&export).unwrap();
        let s = summarize(&ch, crate::forever::test_data());
        assert_eq!(
            (s.talents_string.as_str(), &s.points_per_tree),
            ("-05005", &vec![0, 10, 0])
        );
        assert!(s.has_sheet && s.can_sim, "{:?}", s.blocked_reason);
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
