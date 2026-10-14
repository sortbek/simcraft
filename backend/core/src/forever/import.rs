//! SimC addon export (Forever client) to a character and a UI summary.

use serde::Serialize;

use super::data::ForeverData;
use super::detect::client_build;
use super::spec;
use super::talents;

const GEAR_SLOTS: [&str; 16] = [
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

#[derive(Debug, Clone, PartialEq)]
pub struct ExportItem {
    pub slot: String,
    pub item_id: u32,
    pub enchant_id: u32,
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
    };
    for opt in rest.split(',') {
        if let Some(v) = opt.strip_prefix("id=") {
            item.item_id = v.parse().ok()?;
        } else if let Some(v) = opt.strip_prefix("enchant_id=") {
            item.enchant_id = v.parse().unwrap_or(0);
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
    };
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
    Ok(ch)
}

#[derive(Debug, Serialize)]
pub struct GearView {
    pub slot: String,
    pub item_id: u32,
    pub enchant_id: u32,
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
    pub client_build: Option<String>,
    pub spec_key: Option<String>,
    pub spec_choices: Vec<String>,
    pub talents_string: String,
    pub points_per_tree: Vec<u32>,
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
    if ch.class == "hunter" {
        warnings.push(
            "The SimC addon does not export the ranged slot, so this hunter sims without a bow or gun and its DPS will be far too low"
                .into(),
        );
    }
    for item in &ch.equipped {
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
    let (talents_string, points_per_tree) =
        match (ch.talents_loadout.as_deref(), data.talents.get(&ch.class)) {
            (Some(loadout), Some(class)) => match talents::decode(loadout, class) {
                Ok(d) => {
                    if !d.unknown_definitions.is_empty() {
                        warnings.push(format!(
                            "{} talents are not known to the engine and are left out",
                            d.unknown_definitions.len()
                        ));
                    }
                    (d.talents_string, d.points_per_tree)
                }
                Err(e) => {
                    warnings.push(format!("Talents could not be read: {e}"));
                    (String::new(), Vec::new())
                }
            },
            _ => {
                warnings.push("No talents in the export".into());
                (String::new(), Vec::new())
            }
        };
    let spec_key = spec::derive_spec(&ch.class, &points_per_tree).map(str::to_string);
    let blocked_reason = spec::blocked_reason(ch.level, spec_key.as_deref());
    ImportSummary {
        game: "forever",
        name: ch.name.clone(),
        class: ch.class.clone(),
        race: ch.race.clone(),
        level: ch.level,
        client_build: ch.client_build.clone(),
        spec_key,
        spec_choices: spec::spec_choices(&ch.class)
            .iter()
            .map(|s| s.to_string())
            .collect(),
        talents_string,
        points_per_tree,
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
            Some("Forever sims work from level 60")
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
    fn holy_tree_is_blocked_but_offers_dps_specs() {
        let s = summarize(&parse_export(&at60()).unwrap(), crate::forever::test_data());
        assert!(spec::blocked_reason(60, Some("holyPaladin")).is_some());
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

    #[test]
    fn hunter_without_ranged_warns_and_bag_bow_goes_to_ranged() {
        let data = crate::forever::test_data();
        let base =
            "# WoW 1.60.1.70374, TOC 16001\nhunter=\"H\"\nlevel=60\nrace=orc\nspec=unknown\n";
        let s = summarize(&parse_export(base).unwrap(), data);
        assert!(
            s.warnings.iter().any(|w| w.contains("ranged slot")),
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
