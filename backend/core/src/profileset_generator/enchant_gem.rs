use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use super::base_profile::parse_base_profile;
use super::simc::{
    extract_enchant_id, extract_gem_id, extract_item_id, set_enchant_id, set_gem_id,
};
use super::{ProfilesetResult, MAX_COMBINATIONS};
use crate::types::class_data::GEAR_SLOTS;

struct EnchantGemAxis {
    slot: String,
    kind: &'static str,
    options: Vec<u64>,
}

pub(super) fn generate_enchant_gem_input(
    base_profile: &str,
    enchant_selections: &HashMap<String, Vec<u64>>,
    gem_options: &[u64],
    socketed_item_ids: &HashSet<u64>,
    max_combos_override: Option<usize>,
) -> ProfilesetResult {
    let (base_lines, equipped_gear, _talents_string, _spec) = parse_base_profile(base_profile);

    let mut axes: Vec<EnchantGemAxis> = Vec::new();

    for (slot, ids) in enchant_selections {
        if ids.is_empty() {
            continue;
        }
        let equipped_simc = match equipped_gear.get(slot) {
            Some(s) => s,
            None => continue,
        };
        let current = extract_enchant_id(equipped_simc);
        let mut options: Vec<u64> = Vec::new();
        if current > 0 {
            options.push(current);
        }
        for &id in ids {
            if id != current {
                options.push(id);
            }
        }
        if options.len() <= 1 {
            continue;
        }
        axes.push(EnchantGemAxis {
            slot: slot.clone(),
            kind: "enchant",
            options,
        });
    }

    if !gem_options.is_empty() {
        let mut gem_opt_list: Vec<u64> = Vec::new();
        for &gid in gem_options {
            if !gem_opt_list.contains(&gid) {
                gem_opt_list.push(gid);
            }
        }
        if !gem_opt_list.is_empty() {
            axes.push(EnchantGemAxis {
                slot: "_gems".to_string(),
                kind: "gem",
                options: gem_opt_list,
            });
        }
    }

    if axes.is_empty() {
        return Ok((base_profile.to_string(), 0, HashMap::new()));
    }

    axes.sort_by(|a, b| a.slot.cmp(&b.slot).then_with(|| a.kind.cmp(b.kind)));

    let mut all_combos: Vec<Vec<usize>> = vec![vec![]];
    for axis in &axes {
        let mut new_combos = Vec::new();
        for combo in &all_combos {
            for i in 0..axis.options.len() {
                let mut new = combo.clone();
                new.push(i);
                new_combos.push(new);
            }
        }
        all_combos = new_combos;
    }

    let baseline: Vec<usize> = vec![0; axes.len()];
    let valid_combos: Vec<Vec<usize>> = all_combos.into_iter().filter(|c| *c != baseline).collect();

    let combo_count = valid_combos.len();
    let limit = max_combos_override.unwrap_or(MAX_COMBINATIONS.load(std::sync::atomic::Ordering::Relaxed));
    if limit > 0 && combo_count > limit {
        return Err(format!(
            "Too many combinations ({}). Maximum is {}. Please deselect some options.",
            combo_count, limit
        ));
    }

    if combo_count == 0 {
        return Ok((base_profile.to_string(), 0, HashMap::new()));
    }

    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: HashMap<String, Vec<Value>> = HashMap::new();

    lines.push("# Base Actor".to_string());
    lines.extend(base_lines.clone());
    lines.push("### Combo 1".to_string());
    for slot in GEAR_SLOTS {
        let slot_str = slot.to_string();
        if let Some(gear_val) = equipped_gear.get(&slot_str) {
            lines.push(format!("{}={}", slot, gear_val));
        } else if *slot == "off_hand" {
            lines.push("off_hand=,".to_string());
        }
    }
    lines.push(String::new());

    combo_metadata.insert("Currently Equipped".to_string(), Vec::new());

    for (idx, combo_indices) in valid_combos.iter().enumerate() {
        let combo_number = idx + 2;
        let combo_name = format!("Combo {}", combo_number);
        lines.push(format!("### {}", combo_name));

        let mut meta_items: Vec<Value> = Vec::new();

        let mut enchant_changes: HashMap<String, u64> = HashMap::new();
        let mut gem_change: Option<u64> = None;
        for (axis_idx, &option_idx) in combo_indices.iter().enumerate() {
            if option_idx == 0 {
                continue;
            }
            let axis = &axes[axis_idx];
            let new_val = axis.options[option_idx];
            match axis.kind {
                "enchant" => {
                    enchant_changes.insert(axis.slot.clone(), new_val);
                }
                "gem" => {
                    gem_change = Some(new_val);
                }
                _ => {}
            }
        }

        for slot in GEAR_SLOTS {
            let slot_str = slot.to_string();
            let has_enchant = enchant_changes.contains_key(&slot_str);
            let has_gem = gem_change.is_some()
                && equipped_gear
                    .get(&slot_str)
                    .map(|s| {
                        let iid = extract_item_id(s);
                        socketed_item_ids.contains(&iid) && extract_gem_id(s) == 0
                    })
                    .unwrap_or(false);

            if !has_enchant && !has_gem {
                continue;
            }

            let mut simc = equipped_gear.get(&slot_str).cloned().unwrap_or_default();

            if let Some(&ench_id) = enchant_changes.get(&slot_str) {
                simc = set_enchant_id(&simc, ench_id);
                let ench_info = crate::item_db::get_enchant_info(ench_id);
                let ench_name = ench_info
                    .as_ref()
                    .and_then(|v| v.get("name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or("");
                meta_items.push(json!({
                    "slot": slot_str,
                    "type": "enchant",
                    "enchant_id": ench_id,
                    "name": ench_name,
                }));
            }

            if let Some(gid) = gem_change {
                if has_gem {
                    simc = set_gem_id(&simc, gid);
                }
            }

            lines.push(format!("profileset.\"{}\"+={}={}", combo_name, slot, simc));
        }

        if let Some(gid) = gem_change {
            let gem_info = crate::item_db::get_gem_info(gid);
            let gem_name = gem_info
                .as_ref()
                .and_then(|v| v.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("");
            meta_items.push(json!({
                "slot": "gems",
                "type": "gem",
                "gem_id": gid,
                "name": gem_name,
            }));
        }

        lines.push(String::new());
        combo_metadata.insert(combo_name, meta_items);
    }

    Ok((lines.join("\n"), combo_count, combo_metadata))
}
