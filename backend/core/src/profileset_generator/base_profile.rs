use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::types::class_data::GEAR_SLOTS;

pub(super) fn parse_base_profile(
    base_profile: &str,
) -> (Vec<String>, HashMap<String, String>, String, String) {
    let mut non_gear_lines: Vec<String> = Vec::new();
    let mut equipped_gear: HashMap<String, String> = HashMap::new();
    let mut talents_string = String::new();
    let mut spec_string = String::new();

    let gear_pattern = format!(r"^({})=(.*)", GEAR_SLOTS.join("|"));
    let gear_re = Regex::new(&gear_pattern).unwrap();
    let talents_re = Regex::new(r"^talents=(.+)").unwrap();
    let spec_re = Regex::new(r"^spec=(\w+)").unwrap();

    for line in base_profile.lines() {
        let stripped = line.trim();
        if stripped.is_empty() {
            continue;
        }

        if let Some(caps) = talents_re.captures(stripped) {
            talents_string = caps[1].to_string();
            continue;
        }

        if let Some(caps) = spec_re.captures(stripped) {
            spec_string = caps[1].to_lowercase();
        }

        if let Some(caps) = gear_re.captures(stripped) {
            let slot = caps[1].to_lowercase();
            let value = caps[2].to_string();
            equipped_gear.insert(slot, value);
            continue;
        }

        non_gear_lines.push(stripped.to_string());
    }

    (non_gear_lines, equipped_gear, talents_string, spec_string)
}

pub(super) fn item_meta(item: &Value, slot: &str) -> Value {
    let mut meta = json!({
        "slot": slot,
        "item_id": item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0),
        "ilevel": item.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0),
        "name": item.get("name").and_then(|v| v.as_str()).unwrap_or(""),
        "bonus_ids": item.get("bonus_ids").cloned().unwrap_or(json!([])),
        "enchant_id": item.get("enchant_id").and_then(|v| v.as_u64()).unwrap_or(0),
        "gem_id": item.get("gem_id").and_then(|v| v.as_u64()).unwrap_or(0),
        "is_kept": item.get("is_equipped").and_then(|v| v.as_bool()).unwrap_or(false),
        "origin": item.get("origin").and_then(|v| v.as_str()).unwrap_or("bags"),
    });
    if item
        .get("is_catalyst")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        meta["is_catalyst"] = json!(true);
    }
    meta
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_all_gear_slots_into_equipped_map() {
        let profile = "\
mage=test\n\
head=,id=100\n\
neck=,id=101\n\
shoulder=,id=102\n\
back=,id=103\n\
chest=,id=104\n\
wrist=,id=105\n\
hands=,id=106\n\
waist=,id=107\n\
legs=,id=108\n\
feet=,id=109\n\
finger1=,id=110\n\
finger2=,id=111\n\
trinket1=,id=112\n\
trinket2=,id=113\n\
main_hand=,id=114\n\
off_hand=,id=115\n";
        let (_, equipped, _, _) = parse_base_profile(profile);
        assert_eq!(equipped.len(), 16);
        assert_eq!(equipped.get("head").unwrap(), ",id=100");
        assert_eq!(equipped.get("off_hand").unwrap(), ",id=115");
    }

    #[test]
    fn parses_talents_string_separately() {
        let profile = "\
mage=test\n\
talents=ABCDEF12345\n\
head=,id=100\n";
        let (_, equipped, talents, _) = parse_base_profile(profile);
        assert_eq!(talents, "ABCDEF12345");
        // talents= line should NOT be in equipped_gear or non-gear
        assert!(!equipped.contains_key("talents"));
    }

    #[test]
    fn parses_spec_lowercase() {
        let profile = "\
mage=test\n\
spec=Frost\n";
        let (_, _, _, spec) = parse_base_profile(profile);
        assert_eq!(spec, "frost");
    }

    #[test]
    fn collects_non_gear_lines() {
        let profile = "\
mage=test\n\
level=80\n\
race=human\n\
head=,id=100\n";
        let (non_gear, _, _, _) = parse_base_profile(profile);
        assert!(non_gear.contains(&"mage=test".to_string()));
        assert!(non_gear.contains(&"level=80".to_string()));
        assert!(non_gear.contains(&"race=human".to_string()));
        // gear lines should NOT be in non_gear
        assert!(!non_gear.iter().any(|l| l.starts_with("head=")));
    }

    #[test]
    fn skips_empty_lines() {
        let profile = "\
mage=test\n\
\n\
\n\
head=,id=100\n\
\n";
        let (non_gear, equipped, _, _) = parse_base_profile(profile);
        assert_eq!(non_gear.len(), 1); // only "mage=test"
        assert_eq!(equipped.len(), 1);
    }

    #[test]
    fn talents_empty_when_missing() {
        let profile = "mage=test\n";
        let (_, _, talents, _) = parse_base_profile(profile);
        assert_eq!(talents, "");
    }

    #[test]
    fn spec_empty_when_missing() {
        let profile = "mage=test\nhead=,id=100\n";
        let (_, _, _, spec) = parse_base_profile(profile);
        assert_eq!(spec, "");
    }

    #[test]
    fn item_meta_extracts_all_fields() {
        let item = json!({
            "item_id": 12345,
            "ilevel": 600,
            "name": "Test Item",
            "bonus_ids": [1, 2, 3],
            "enchant_id": 7777,
            "gem_id": 5555,
            "is_equipped": true,
            "origin": "bags",
        });
        let meta = item_meta(&item, "head");
        assert_eq!(meta["slot"], "head");
        assert_eq!(meta["item_id"], 12345);
        assert_eq!(meta["ilevel"], 600);
        assert_eq!(meta["name"], "Test Item");
        assert_eq!(meta["enchant_id"], 7777);
        assert_eq!(meta["gem_id"], 5555);
        assert_eq!(meta["is_kept"], true);
        assert_eq!(meta["origin"], "bags");
    }

    #[test]
    fn item_meta_marks_catalyst() {
        let item = json!({
            "item_id": 12345,
            "is_catalyst": true,
        });
        let meta = item_meta(&item, "head");
        assert_eq!(meta["is_catalyst"], true);
    }

    #[test]
    fn item_meta_defaults_when_fields_missing() {
        let item = json!({});
        let meta = item_meta(&item, "head");
        assert_eq!(meta["item_id"], 0);
        assert_eq!(meta["ilevel"], 0);
        assert_eq!(meta["name"], "");
        assert_eq!(meta["enchant_id"], 0);
        assert_eq!(meta["gem_id"], 0);
        assert_eq!(meta["is_kept"], false);
        assert_eq!(meta["origin"], "bags");
    }
}
