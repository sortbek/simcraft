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
