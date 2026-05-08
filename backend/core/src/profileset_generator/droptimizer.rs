use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;

use super::base_profile::parse_base_profile;
use crate::types::class_data::{self, GEAR_SLOTS};

pub(super) fn generate_droptimizer_input(
    base_profile: &str,
    drop_items: &[Value],
) -> (String, usize, HashMap<String, Value>) {
    let (base_lines, equipped_gear, talents_string, spec) = parse_base_profile(base_profile);

    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: HashMap<String, Value> = HashMap::new();

    lines.push("# Base Actor".to_string());
    lines.extend(base_lines);
    lines.push("### Combo 1".to_string());
    for slot in GEAR_SLOTS {
        if let Some(gear) = equipped_gear.get(*slot) {
            lines.push(format!("{}={}", slot, gear));
        } else if *slot == "off_hand" {
            lines.push("off_hand=,".to_string());
        }
    }
    if !talents_string.is_empty() {
        lines.push(format!("talents={}", talents_string));
    }
    lines.push(String::new());

    let has_two_hand_equipped = {
        let oh = equipped_gear.get("off_hand").map(|s| s.trim());
        oh.is_none() || oh == Some("") || oh == Some(",")
    };

    // Legacy fallback: regex-copy enchant_id from equipped slot when the drop item
    // does not provide slot_inherits. Keeps direct API consumers working while
    // the frontend rolls out. Remove in a follow-up release.
    let legacy_enchant_re = Regex::new(r"enchant_id=(\d+)").unwrap();

    let mut combo_idx = 2usize;
    for item in drop_items {
        let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
        let ilevel = item.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0);
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let encounter = item
            .get("encounter")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let inv_type = item
            .get("inventory_type")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let bonus_ids: Vec<u64> = item
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
            .unwrap_or_default();
        let slot_inherits = item.get("slot_inherits").and_then(|v| v.as_array());

        let mut slots = class_data::inv_type_to_slots(inv_type, &spec);

        if has_two_hand_equipped && !(spec == "fury" && inv_type == 17) {
            slots.retain(|s| *s != "off_hand");
        }

        if slots.is_empty() {
            continue;
        }

        let mut base_simc_str = format!(",id={},ilevel={}", item_id, ilevel);
        if !bonus_ids.is_empty() {
            let bonus_str = bonus_ids
                .iter()
                .map(|b| b.to_string())
                .collect::<Vec<_>>()
                .join("/");
            base_simc_str.push_str(&format!(",bonus_id={}", bonus_str));
        }

        for slot in &slots {
            let mut simc_str = base_simc_str.clone();
            let mut applied_enchant: u64 = 0;
            let mut applied_gem: u64 = 0;

            let inherit = slot_inherits.and_then(|arr| {
                arr.iter()
                    .find(|entry| entry.get("slot").and_then(|v| v.as_str()) == Some(*slot))
            });

            if let Some(entry) = inherit {
                if let Some(eid) = entry.get("enchant_id").and_then(|v| v.as_u64()) {
                    if eid > 0 {
                        simc_str.push_str(&format!(",enchant_id={}", eid));
                        applied_enchant = eid;
                    }
                }
                if let Some(gid) = entry.get("gem_id").and_then(|v| v.as_u64()) {
                    if gid > 0 {
                        simc_str.push_str(&format!(",gem_id={}", gid));
                        applied_gem = gid;
                    }
                }
            } else if let Some(equipped) = equipped_gear.get(*slot) {
                if let Some(caps) = legacy_enchant_re.captures(equipped) {
                    if let Ok(eid) = caps[1].parse::<u64>() {
                        if eid > 0 {
                            simc_str.push_str(&format!(",enchant_id={}", eid));
                            applied_enchant = eid;
                        }
                    }
                }
            }

            let combo_name = format!("Combo {}", combo_idx);
            lines.push(format!("### {}", combo_name));
            lines.push(format!(
                "profileset.\"{}\"+={}={}",
                combo_name, slot, simc_str
            ));
            if inv_type == 17 && *slot == "main_hand" && spec != "fury" {
                lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
            }
            if !talents_string.is_empty() {
                lines.push(format!(
                    "profileset.\"{}\"+=talents={}",
                    combo_name, talents_string
                ));
            }
            lines.push(String::new());

            combo_metadata.insert(
                combo_name.clone(),
                json!([{
                    "slot": slot,
                    "item_id": item_id,
                    "ilevel": ilevel,
                    "name": name,
                    "bonus_ids": bonus_ids,
                    "enchant_id": applied_enchant,
                    "gem_id": applied_gem,
                    "is_kept": false,
                    "encounter": encounter,
                }]),
            );
            combo_idx += 1;
        }
    }

    let combo_count = combo_idx - 2;
    (lines.join("\n"), combo_count, combo_metadata)
}
