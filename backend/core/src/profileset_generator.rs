use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};


use crate::game_data;
use crate::types::class_data::{self, ARMOR_SLOTS, GEAR_SLOTS, UNIQUE_SLOT_PAIRS};

use once_cell::sync::Lazy;

type ProfilesetResult = Result<(String, usize, HashMap<String, Vec<Value>>), String>;

const BASE64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Extract the specId from a talent export string header (bits 8-23).
fn extract_spec_id_from_talent_string(talent_str: &str) -> Option<u64> {
    let mut bits = Vec::new();
    for ch in talent_str.bytes() {
        let val = BASE64.iter().position(|&b| b == ch)?;
        for bit in 0..6 {
            bits.push((val >> bit) & 1);
        }
        if bits.len() >= 24 {
            break;
        }
    }
    if bits.len() < 24 {
        return None;
    }
    // Skip 8-bit version, read 16-bit specId (LSB-first)
    let mut spec_id = 0u64;
    for i in 0..16 {
        if bits[8 + i] == 1 {
            spec_id |= 1 << i;
        }
    }
    Some(spec_id)
}

/// Maximum gear combinations for Top Gear. Override with MAX_COMBINATIONS env var.
pub static MAX_COMBINATIONS: Lazy<usize> = Lazy::new(|| {
    if let Ok(val) = std::env::var("MAX_COMBINATIONS") {
        if let Ok(n) = val.parse() {
            return n;
        }
    }
    500
});

/// Build a UID from a legacy item JSON Value, matching gear_resolver::make_uid format:
/// "item_id:sorted_bonus_ids:origin:slot"
fn make_item_uid(item: &Value) -> String {
    let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
    let mut bonus_ids: Vec<u64> = item
        .get("bonus_ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
        .unwrap_or_default();
    bonus_ids.sort();
    let bonus_key = bonus_ids
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(":");
    let origin = item
        .get("origin")
        .and_then(|v| v.as_str())
        .unwrap_or("bags");
    let slot = item.get("slot").and_then(|v| v.as_str()).unwrap_or("");
    format!("{}:{}:{}:{}", item_id, bonus_key, origin, slot)
}

/// Build a slot-agnostic identity key used to mirror selections across paired slots.
/// Format: "item_id:sorted_bonus_ids:origin"
fn make_item_identity(item: &Value) -> String {
    let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
    let mut bonus_ids: Vec<u64> = item
        .get("bonus_ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
        .unwrap_or_default();
    bonus_ids.sort();
    let bonus_key = bonus_ids
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(":");
    let origin = item
        .get("origin")
        .and_then(|v| v.as_str())
        .unwrap_or("bags");
    format!("{}:{}:{}", item_id, bonus_key, origin)
}

/// Convert a UID like "item:bonuses:origin:slot" into "item:bonuses:origin".
fn uid_identity(uid: &str) -> String {
    uid.rsplit_once(':')
        .map(|(prefix, _)| prefix.to_string())
        .unwrap_or_else(|| uid.to_string())
}

/// Generate a simc input string with full-set profilesets for Top Gear.
///
/// Returns (simc_input_string, combination_count, combo_metadata).
/// combo_metadata maps "Combo N" -> list of item metadata values.
pub fn generate_top_gear_input(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
    max_combos_override: Option<usize>,
) -> ProfilesetResult {
    generate_top_gear_input_with_talents(
        base_profile,
        items_by_slot,
        selected_items,
        max_combos_override,
        &[],
        None,
        &HashMap::new(),
        &[],
        &HashSet::new(),
    )
}

/// Generate top-gear profileset input, optionally multiplying by talent builds
/// and enchant/gem variations.
pub fn generate_top_gear_input_with_talents(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
    max_combos_override: Option<usize>,
    talent_builds: &[(String, String)],
    catalyst_charges: Option<u32>,
    enchant_selections: &HashMap<String, Vec<u64>>,
    gem_options: &[u64],
    socketed_item_ids: &HashSet<u64>,
) -> ProfilesetResult {
    // Extract base profile info (non-gear lines) and equipped gear
    let (base_lines, equipped_gear, talents_string, spec) = parse_base_profile(base_profile);

    let slot_item_lists = build_slot_candidates(base_profile, items_by_slot, selected_items);

    // Find slots that have alternatives (more than just equipped)
    let varying_slots: Vec<String> = slot_item_lists
        .iter()
        .filter(|(_, items)| items.len() > 1)
        .map(|(slot, _)| slot.clone())
        .collect();

    // Sort for deterministic ordering
    let mut varying_slots = varying_slots;
    varying_slots.sort();

    let has_enchant_gem_input = enchant_selections.values().any(|v| !v.is_empty())
        || !gem_options.is_empty();

    if varying_slots.is_empty() && talent_builds.len() <= 1 && !has_enchant_gem_input {
        return Ok((base_profile.to_string(), 0, HashMap::new()));
    }

    // Build cartesian product across varying slots
    let option_lists: Vec<&Vec<Value>> = varying_slots
        .iter()
        .map(|slot| slot_item_lists.get(slot).unwrap())
        .collect();

    // Generate all combos via iterative cartesian product
    let mut all_combos: Vec<Vec<usize>> = vec![vec![]];
    for opts in &option_lists {
        let mut new_combos = Vec::new();
        for combo in &all_combos {
            for i in 0..opts.len() {
                let mut new = combo.clone();
                new.push(i);
                new_combos.push(new);
            }
        }
        all_combos = new_combos;
    }

    // Filter invalid combos and build gear sets
    let mut valid_combos: Vec<HashMap<String, Value>> = Vec::new();
    let mut seen_combo_keys: HashSet<String> = HashSet::new();

    for combo_indices in &all_combos {
        // Build full gear set: start with equipped, override varying slots
        let mut gear_set: HashMap<String, Value> = HashMap::new();
        for slot in GEAR_SLOTS {
            let slot = slot.to_string();
            if let Some(items) = slot_item_lists.get(&slot) {
                // Use equipped item as default
                let default = items
                    .iter()
                    .find(|it| {
                        it.get("is_equipped")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false)
                    })
                    .unwrap_or(&items[0]);
                gear_set.insert(slot, default.clone());
            }
        }

        // Apply the combo choices
        for (i, slot) in varying_slots.iter().enumerate() {
            let item = &option_lists[i][combo_indices[i]];
            gear_set.insert(slot.clone(), item.clone());
        }

        // For non-Fury specs, a 2H main hand forces an empty off hand.
        // Normalize here so count and generated combos align.
        if main_hand_is_two_hand(&gear_set, &spec) {
            gear_set.remove("off_hand");
        }

        // Validate unique-equipped constraints
        if !validate_unique_equipped(&gear_set) {
            continue;
        }

        // Vault constraint: only one vault item can be picked
        if !validate_vault_constraint(&gear_set) {
            continue;
        }

        // Weapon constraint: two-hander in main_hand cannot pair with off_hand
        if !validate_weapon_constraint(&gear_set, &spec) {
            continue;
        }

        // Catalyst constraint: max N catalyst items per combination
        if let Some(charges) = catalyst_charges {
            if !validate_catalyst_constraint(&gear_set, charges) {
                continue;
            }
        }

        // Item limit categories (e.g. max 2 embellished items)
        if !validate_item_limits(&gear_set) {
            continue;
        }

        // Check if this is identical to baseline (all equipped)
        let is_baseline = GEAR_SLOTS.iter().all(|slot| {
            gear_set
                .get(*slot)
                .and_then(|item| item.get("is_equipped"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true)
        });
        if is_baseline {
            continue;
        }

        let combo_key = gear_set_identity_key(&gear_set);
        if !seen_combo_keys.insert(combo_key) {
            continue;
        }

        valid_combos.push(gear_set);
    }

    let gear_combo_count = valid_combos.len(); // excludes baseline

    // Build enchant/gem variation axes.
    // Each axis = (slot, kind, options) where options includes the equipped value.
    let mut eg_axes: Vec<EnchantGemAxis> = Vec::new();
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
        eg_axes.push(EnchantGemAxis {
            slot: slot.clone(),
            kind: "enchant",
            options,
        });
    }
    // Gem options: single axis — each gem option applies to ALL socketed slots at once.
    // The slot is stored as "_gems" to distinguish from per-slot enchant axes.
    if !gem_options.is_empty() {
        let mut gem_opt_list: Vec<u64> = Vec::new();
        for &gid in gem_options {
            if !gem_opt_list.contains(&gid) {
                gem_opt_list.push(gid);
            }
        }
        if !gem_opt_list.is_empty() {
            eg_axes.push(EnchantGemAxis {
                slot: "_gems".to_string(),
                kind: "gem",
                options: gem_opt_list,
            });
        }
    }
    eg_axes.sort_by(|a, b| a.slot.cmp(&b.slot).then_with(|| a.kind.cmp(b.kind)));

    // Generate enchant/gem combos via cartesian product (excluding baseline)
    let has_enchant_gem = !eg_axes.is_empty();
    let eg_combos: Vec<Vec<usize>> = if has_enchant_gem {
        let mut all: Vec<Vec<usize>> = vec![vec![]];
        for axis in &eg_axes {
            let mut next = Vec::new();
            for combo in &all {
                for i in 0..axis.options.len() {
                    let mut c = combo.clone();
                    c.push(i);
                    next.push(c);
                }
            }
            all = next;
        }
        let baseline_eg: Vec<usize> = vec![0; eg_axes.len()];
        all.into_iter().filter(|c| *c != baseline_eg).collect()
    } else {
        Vec::new()
    };
    let eg_combo_count = eg_combos.len(); // excludes baseline

    // Resolve talent builds: if multiple provided, multiply; otherwise use single
    let effective_talents: Vec<(String, String)> = if talent_builds.is_empty() {
        vec![("".to_string(), talents_string.clone())]
    } else {
        talent_builds
            .iter()
            .map(|(name, ts)| (name.clone(), ts.clone()))
            .collect()
    };
    let has_talent_variants = effective_talents.len() > 1;

    // Total combos: gear × enchant/gem × talents (each including baseline),
    // minus 1 for the base actor itself.
    let gear_plus_baseline = gear_combo_count + 1;
    let eg_plus_baseline = eg_combo_count + 1;
    let talent_count = effective_talents.len();
    let total_combo_count = gear_plus_baseline * eg_plus_baseline * talent_count - 1;

    let limit = max_combos_override.unwrap_or(*MAX_COMBINATIONS);
    if total_combo_count > limit {
        return Err(format!(
            "Too many combinations ({}). Maximum is {}. Please deselect some items.",
            total_combo_count, limit
        ));
    }

    if gear_combo_count == 0 && !has_talent_variants && eg_combo_count == 0 {
        return Ok((base_profile.to_string(), 0, HashMap::new()));
    }

    // Build output: base profile as Combo 1, then profilesets
    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: HashMap<String, Vec<Value>> = HashMap::new();
    let paired_display_slots = ["finger1", "finger2", "trinket1", "trinket2"];

    // Write clean base profile (non-gear lines + equipped gear)
    lines.push("# Base Actor".to_string());
    lines.extend(base_lines.clone());
    let base_talent = &effective_talents[0].1;
    lines.push("### Combo 1".to_string());
    for slot in GEAR_SLOTS {
        let slot_str = slot.to_string();
        if let Some(gear_val) = equipped_gear.get(&slot_str) {
            lines.push(format!("{}={}", slot, gear_val));
        } else if *slot == "off_hand" {
            lines.push("off_hand=,".to_string());
        }
    }
    // Determine the base actor's effective spec (might differ from original if first talent build is another spec)
    let base_actor_spec: String = if !base_talent.is_empty() {
        extract_spec_id_from_talent_string(base_talent)
            .and_then(class_data::spec_id_to_name)
            .map(|s| s.to_string())
            .unwrap_or_else(|| spec.clone())
    } else {
        spec.clone()
    };

    if !base_talent.is_empty() {
        lines.push(format!("talents={}", base_talent));
        if base_actor_spec != spec {
            lines.push(format!("spec={}", base_actor_spec));
        }
    }
    lines.push(String::new());

    // Build baseline metadata for "Currently Equipped"
    let mut baseline_items: Vec<Value> = Vec::new();
    for slot in &paired_display_slots {
        let slot = slot.to_string();
        if let Some(items) = slot_item_lists.get(&slot) {
            if !items.is_empty() {
                baseline_items.push(item_meta(&items[0], &slot));
            }
        }
    }
    let baseline_name = if has_talent_variants {
        let talent_name = &effective_talents[0].0;
        let talent_spec: Option<&str> = extract_spec_id_from_talent_string(&effective_talents[0].1)
            .and_then(class_data::spec_id_to_name);
        if baseline_items.is_empty() {
            baseline_items.push(json!({
                "talent_build": talent_name,
                "talent_spec": talent_spec,
                "is_kept": true,
            }));
        } else {
            for item in &mut baseline_items {
                item["talent_build"] = json!(talent_name);
                item["talent_spec"] = json!(talent_spec);
            }
        }
        format!("Currently Equipped ({})", talent_name)
    } else {
        "Currently Equipped".to_string()
    };
    combo_metadata.insert(baseline_name, baseline_items);

    let mut combo_number = 2usize;

    // Build the list of enchant/gem combos including the baseline (index 0 per axis = equipped).
    // eg_all_combos includes baseline; eg_combos excludes it.
    let eg_baseline: Vec<usize> = vec![0; eg_axes.len()];
    let eg_all_combos: Vec<Vec<usize>> = if has_enchant_gem {
        let mut v = vec![eg_baseline.clone()];
        v.extend(eg_combos.iter().cloned());
        v
    } else {
        vec![vec![]]
    };

    // Helper: apply an enchant/gem combo to a simc string for a given slot.
    // Returns the modified simc string, or None if no change for this slot.
    let apply_eg_combo = |slot: &str, simc: &str, eg_indices: &[usize]| -> Option<String> {
        let mut result = simc.to_string();
        let mut changed = false;
        for (axis_idx, &option_idx) in eg_indices.iter().enumerate() {
            let axis = &eg_axes[axis_idx];
            match axis.kind {
                "enchant" => {
                    if option_idx == 0 || axis.slot != slot {
                        continue; // Enchant baseline (index 0 = equipped) or wrong slot
                    }
                    result = set_enchant_id(&result, axis.options[option_idx]);
                    changed = true;
                }
                "gem" => {
                    // "_gems" axis applies to items with empty sockets:
                    // item must have sockets (in socketed_item_ids) AND no gem_id yet
                    if axis.slot == "_gems" {
                        let item_id = extract_item_id(&result);
                        if socketed_item_ids.contains(&item_id) && extract_gem_id(&result) == 0 {
                            result = set_gem_id(&result, axis.options[option_idx]);
                            changed = true;
                        }
                    } else if axis.slot == slot {
                        result = set_gem_id(&result, axis.options[option_idx]);
                        changed = true;
                    }
                }
                _ => {}
            }
        }
        if changed { Some(result) } else { None }
    };

    // Helper: build enchant/gem metadata entries for an eg combo
    let build_eg_meta = |eg_indices: &[usize]| -> Vec<Value> {
        let mut meta = Vec::new();
        for (axis_idx, &option_idx) in eg_indices.iter().enumerate() {
            let axis = &eg_axes[axis_idx];
            let new_val = axis.options[option_idx];
            match axis.kind {
                "enchant" => {
                    if option_idx == 0 {
                        continue; // Enchant baseline = equipped, no change
                    }
                    let info = crate::item_db::get_enchant_info(new_val);
                    let name = info
                        .as_ref()
                        .and_then(|v| v.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("");
                    meta.push(json!({
                        "slot": axis.slot,
                        "type": "enchant",
                        "enchant_id": new_val,
                        "name": name,
                    }));
                }
                "gem" => {
                    let info = crate::item_db::get_gem_info(new_val);
                    let name = info
                        .as_ref()
                        .and_then(|v| v.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("");
                    meta.push(json!({
                        "slot": "gems",
                        "type": "gem",
                        "gem_id": new_val,
                        "name": name,
                    }));
                }
                _ => {}
            }
        }
        meta
    };

    // For each talent build × gear combo × enchant/gem combo, generate a profileset
    let empty_gear_set: HashMap<String, Value> = HashMap::new();

    for (talent_idx, (talent_name, talent_str)) in effective_talents.iter().enumerate() {
        // Build gear iterator: for first talent, skip baseline gear; for others, include it.
        let gear_iter: Vec<(bool, &HashMap<String, Value>)> =
            if talent_idx == 0 {
                // First talent: baseline gear is base actor. Only alternatives here.
                valid_combos.iter().map(|gs| (false, gs)).collect()
            } else {
                // Additional talents: need equipped gear + all alternatives
                std::iter::once((true, &empty_gear_set))
                    .chain(valid_combos.iter().map(|gs| (false, gs)))
                    .collect()
            };

        // For the first talent + baseline gear, we still need enchant/gem-only combos
        if talent_idx == 0 && has_enchant_gem {
            // Baseline gear + non-baseline enchant/gem combos
            for eg_idx in &eg_combos {
                // Check if this eg combo actually changes any equipped slot
                let any_change = GEAR_SLOTS.iter().any(|slot| {
                    let slot_str = slot.to_string();
                    equipped_gear.get(&slot_str)
                        .and_then(|gear_val| apply_eg_combo(&slot_str, gear_val, eg_idx))
                        .is_some()
                });
                if !any_change {
                    continue; // Skip: no equipped items have empty sockets for this gem
                }

                let combo_name = format!("Combo {}", combo_number);
                lines.push(format!("### {}", combo_name));

                for slot in GEAR_SLOTS {
                    let slot_str = slot.to_string();
                    if let Some(gear_val) = equipped_gear.get(&slot_str) {
                        let modified = apply_eg_combo(&slot_str, gear_val, eg_idx);
                        let val = modified.as_deref().unwrap_or(gear_val);
                        lines.push(format!("profileset.\"{}\"+={}={}", combo_name, slot, val));
                    } else if *slot == "off_hand" {
                        lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
                    }
                }
                lines.push(String::new());

                let mut combo_items: Vec<Value> = build_eg_meta(eg_idx);
                if has_talent_variants {
                    let talent_spec: Option<&str> = extract_spec_id_from_talent_string(talent_str)
                        .and_then(class_data::spec_id_to_name);
                    for item in &mut combo_items {
                        item["talent_build"] = json!(talent_name);
                        item["talent_spec"] = json!(talent_spec);
                    }
                }
                combo_metadata.insert(combo_name, combo_items);
                combo_number += 1;
            }
        }

        for (is_equipped_with_new_talent, gear_set) in &gear_iter {
            // For each gear combo, iterate over all enchant/gem combos (including baseline)
            let eg_iter: &[Vec<usize>] = if *is_equipped_with_new_talent && !has_enchant_gem {
                // Only baseline enchants with new talent + equipped gear
                &eg_all_combos[..1]
            } else {
                &eg_all_combos
            };

            for eg_idx in eg_iter {
                let is_eg_baseline = !has_enchant_gem || *eg_idx == eg_baseline;

                // Skip: first talent + equipped gear + baseline enchants (that's the base actor)
                if talent_idx == 0 && *is_equipped_with_new_talent && is_eg_baseline {
                    continue;
                }

                // For non-baseline gem combos, check if the gem actually applies to any
                // item in this gear set. If no item has an empty socket, skip.
                if !is_eg_baseline {
                    let any_change = GEAR_SLOTS.iter().any(|slot| {
                        let slot_str = slot.to_string();
                        let simc = if *is_equipped_with_new_talent || gear_set.is_empty() {
                            equipped_gear.get(&slot_str).map(|s| s.as_str())
                        } else {
                            gear_set.get(&slot_str)
                                .and_then(|item| item.get("simc_string"))
                                .and_then(|s| s.as_str())
                                .or_else(|| equipped_gear.get(&slot_str).map(|s| s.as_str()))
                        };
                        simc.and_then(|s| apply_eg_combo(&slot_str, s, eg_idx)).is_some()
                    });
                    if !any_change {
                        continue;
                    }
                }

                let combo_name = format!("Combo {}", combo_number);
                lines.push(format!("### {}", combo_name));

                if *is_equipped_with_new_talent {
                    // Same gear as base actor (possibly with enchant/gem overrides)
                    for slot in GEAR_SLOTS {
                        let slot_str = slot.to_string();
                        if let Some(gear_val) = equipped_gear.get(&slot_str) {
                            let modified = apply_eg_combo(&slot_str, gear_val, eg_idx);
                            let val = modified.as_deref().unwrap_or(gear_val);
                            lines.push(format!(
                                "profileset.\"{}\"+={}={}",
                                combo_name, slot, val
                            ));
                        } else if *slot == "off_hand" {
                            lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
                        }
                    }
                } else {
                    // Different gear combination (possibly with enchant/gem overrides)
                    let mut combo_mh_is_two_hand = false;
                    for slot in GEAR_SLOTS {
                        let slot_str = slot.to_string();
                        if let Some(item) = gear_set.get(&slot_str) {
                            if *slot == "main_hand" {
                                let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
                                let inv_type = game_data::get_inventory_type(item_id).unwrap_or(0);
                                if inv_type == 17 && spec != "fury" {
                                    combo_mh_is_two_hand = true;
                                }
                            }
                            if *slot == "off_hand" && combo_mh_is_two_hand {
                                lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
                            } else {
                                let simc_str = item
                                    .get("simc_string")
                                    .and_then(|s| s.as_str())
                                    .unwrap_or("");
                                let modified = apply_eg_combo(&slot_str, simc_str, eg_idx);
                                let val = modified.as_deref().unwrap_or(simc_str);
                                lines.push(format!(
                                    "profileset.\"{}\"+={}={}",
                                    combo_name, slot, val
                                ));
                            }
                        } else if *slot == "off_hand" {
                            lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
                        }
                    }
                }

                if !talent_str.is_empty() {
                    lines.push(format!(
                        "profileset.\"{}\"+=talents={}",
                        combo_name, talent_str
                    ));
                    if let Some(talent_spec_id) = extract_spec_id_from_talent_string(talent_str) {
                        if let Some(talent_spec_name) = class_data::spec_id_to_name(talent_spec_id) {
                            if talent_spec_name != base_actor_spec {
                                lines.push(format!(
                                    "profileset.\"{}\"+=spec={}",
                                    combo_name, talent_spec_name
                                ));
                            }
                        }
                    }
                }
                lines.push(String::new());

                // Build metadata
                let mut combo_items: Vec<Value> = Vec::new();
                if *is_equipped_with_new_talent {
                    for slot in &paired_display_slots {
                        let slot = slot.to_string();
                        if let Some(items) = slot_item_lists.get(&slot) {
                            if !items.is_empty() {
                                let mut meta = item_meta(&items[0], &slot);
                                meta["is_kept"] = json!(true);
                                combo_items.push(meta);
                            }
                        }
                    }
                } else {
                    for slot in &paired_display_slots {
                        let slot = slot.to_string();
                        if let Some(item) = gear_set.get(&slot) {
                            let mut meta = item_meta(item, &slot);
                            meta["is_kept"] = json!(item
                                .get("is_equipped")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false));
                            combo_items.push(meta);
                        }
                    }
                    for slot in GEAR_SLOTS {
                        if paired_display_slots.contains(slot) {
                            continue;
                        }
                        let slot_str = slot.to_string();
                        if let Some(item) = gear_set.get(&slot_str) {
                            let is_equipped = item
                                .get("is_equipped")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(true);
                            if !is_equipped {
                                combo_items.push(item_meta(item, &slot_str));
                            }
                        }
                    }
                }

                // Add enchant/gem change metadata
                if !is_eg_baseline {
                    combo_items.extend(build_eg_meta(eg_idx));
                }

                // Tag with talent build name and spec if comparing talents
                if has_talent_variants {
                    let talent_spec: Option<&str> = extract_spec_id_from_talent_string(talent_str)
                        .and_then(class_data::spec_id_to_name);
                    if combo_items.is_empty() {
                        combo_items.push(json!({
                            "talent_build": talent_name,
                            "talent_spec": talent_spec,
                            "is_kept": true,
                        }));
                    } else {
                        for item in &mut combo_items {
                            item["talent_build"] = json!(talent_name);
                            item["talent_spec"] = json!(talent_spec);
                        }
                    }
                }

                if !gear_set.contains_key("off_hand") {
                    combo_items.push(json!({
                        "slot": "off_hand",
                        "item_id": 0,
                        "ilevel": 0,
                        "name": "",
                        "bonus_ids": [],
                        "enchant_id": 0,
                        "gem_id": 0,
                        "is_kept": false,
                        "origin": "system",
                    }));
                }

                combo_metadata.insert(combo_name, combo_items);
                combo_number += 1;
            }
        }
    }

    Ok((lines.join("\n"), total_combo_count, combo_metadata))
}

fn parse_base_profile(
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

        // Extract talents
        if let Some(caps) = talents_re.captures(stripped) {
            talents_string = caps[1].to_string();
            continue;
        }

        // Extract spec
        if let Some(caps) = spec_re.captures(stripped) {
            spec_string = caps[1].to_lowercase();
        }

        // Extract gear lines
        if let Some(caps) = gear_re.captures(stripped) {
            let slot = caps[1].to_lowercase();
            let value = caps[2].to_string();
            equipped_gear.insert(slot, value);
            continue;
        }

        // Keep everything else
        non_gear_lines.push(stripped.to_string());
    }

    (non_gear_lines, equipped_gear, talents_string, spec_string)
}

fn item_meta(item: &Value, slot: &str) -> Value {
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

// can_dual_wield and inv_type_to_slots now live in types::class_data

pub fn generate_droptimizer_input(
    base_profile: &str,
    drop_items: &[Value],
) -> (String, usize, HashMap<String, Value>) {
    let (base_lines, equipped_gear, talents_string, spec) = parse_base_profile(base_profile);

    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: HashMap<String, Value> = HashMap::new();

    // Write base profile
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

    // Detect if currently using a two-hander (no off-hand or empty off-hand)
    let has_two_hand_equipped = {
        let oh = equipped_gear.get("off_hand").map(|s| s.trim());
        oh.is_none() || oh == Some("") || oh == Some(",")
    };

    // Extract enchant/runeforge from equipped gear to copy onto drop items.
    // Gems are NOT copied because drop items may not have sockets.
    let enchant_re = Regex::new(r"(enchant_id=\d+)").unwrap();

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
        let mut slots = class_data::inv_type_to_slots(inv_type, &spec);

        // If the character has a two-hander equipped, nothing can go in the
        // off-hand — except two-handers for Fury warriors (Titan's Grip).
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
            // Copy enchants/gems from the currently equipped item in this slot
            let mut simc_str = base_simc_str.clone();
            if let Some(equipped) = equipped_gear.get(*slot) {
                if let Some(caps) = enchant_re.captures(equipped) {
                    simc_str.push_str(&format!(",{}", &caps[1]));
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
                    "enchant_id": 0,
                    "gem_id": 0,
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

// ---- Upgrade Compare ----

/// Generate profileset input for upgrade comparison.
///
/// Uses DFS to enumerate all valid combinations of item upgrades
/// within the given currency budget. Each combination is a profileset
/// where selected items are upgraded to different levels.
pub fn generate_upgrade_compare_input(
    base_profile: &str,
    upgraded_options_by_slot: &HashMap<String, Vec<Value>>,
    upgrade_budget: &HashMap<u64, u64>,
    max_combos_override: Option<usize>,
) -> ProfilesetResult {
    let (base_lines, equipped_gear, talents_string, _spec) = parse_base_profile(base_profile);

    let mut slots: Vec<String> = upgraded_options_by_slot
        .keys()
        .filter(|s| !upgraded_options_by_slot[*s].is_empty())
        .cloned()
        .collect();
    slots.sort();
    if slots.is_empty() {
        return Err("No upgradeable equipped items were selected.".to_string());
    }

    let limit = max_combos_override.unwrap_or(*MAX_COMBINATIONS);

    // DFS: explore upgrade choices per slot within budget
    struct Combo {
        choices: Vec<(String, usize)>, // (slot, option_index)
    }

    struct DfsCtx<'a> {
        slots: &'a [String],
        options: &'a HashMap<String, Vec<Value>>,
        budget: &'a HashMap<u64, u64>,
        limit: usize,
        best_spend: u64,
        retained: Vec<Combo>,
        spent: HashMap<u64, u64>,
        current: Vec<(String, usize)>,
    }

    impl DfsCtx<'_> {
        fn within_budget(&self, cost: &HashMap<u64, u64>) -> bool {
            cost.iter().all(|(cid, amount)| {
                let next = self.spent.get(cid).copied().unwrap_or(0) + amount;
                next <= self.budget.get(cid).copied().unwrap_or(0)
            })
        }

        fn dfs(&mut self, idx: usize) {
            if idx == self.slots.len() {
                let total: u64 = self.spent.values().sum();
                if total > self.best_spend {
                    self.best_spend = total;
                    self.retained.clear();
                }
                if total >= self.best_spend {
                    self.retained.push(Combo {
                        choices: self.current.clone(),
                    });
                }
                return;
            }

            let slot = self.slots[idx].clone();
            let slot_opts: Option<Vec<Value>> = self.options.get(&slot).cloned();

            let Some(slot_opts) = slot_opts else {
                self.current.push((slot, 0));
                self.dfs(idx + 1);
                self.current.pop();
                return;
            };

            // Option 0: keep current (no upgrade)
            self.current.push((slot.clone(), 0));
            self.dfs(idx + 1);
            self.current.pop();

            // Options 1..N: upgrade to each level
            for (i, opt) in slot_opts.iter().enumerate() {
                let costs: HashMap<u64, u64> = opt
                    .get("upgrade_costs")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();

                if !self.within_budget(&costs) {
                    continue;
                }

                for (cid, amount) in &costs {
                    *self.spent.entry(*cid).or_insert(0) += amount;
                }
                self.current.push((slot.clone(), i + 1));

                self.dfs(idx + 1);

                self.current.pop();
                for (cid, amount) in &costs {
                    let entry = self.spent.entry(*cid).or_insert(0);
                    *entry = entry.saturating_sub(*amount);
                }

                if self.retained.len() > self.limit * 2 {
                    return;
                }
            }
        }
    }

    let mut ctx = DfsCtx {
        slots: &slots,
        options: upgraded_options_by_slot,
        budget: upgrade_budget,
        limit,
        best_spend: 0,
        retained: Vec::new(),
        spent: HashMap::new(),
        current: Vec::new(),
    };
    ctx.dfs(0);

    let retained = ctx.retained;

    if retained.len() > limit {
        return Err(format!(
            "Too many upgrade combinations ({}). Maximum is {}. Please deselect some items.",
            retained.len(),
            limit
        ));
    }

    // Build profileset output
    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: HashMap<String, Vec<Value>> = HashMap::new();

    // Base actor
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

    let mut combo_idx = 2usize;

    for combo in &retained {
        // Check if all choices are "keep" (no upgrades)
        if combo.choices.iter().all(|(_, idx)| *idx == 0) {
            continue;
        }

        let combo_name = format!("Combo {}", combo_idx);
        let mut items_meta: Vec<Value> = Vec::new();

        lines.push(format!("### {}", combo_name));

        for (slot, choice_idx) in &combo.choices {
            if *choice_idx == 0 {
                continue; // Keep equipped
            }
            let opt = &upgraded_options_by_slot[slot][*choice_idx - 1];
            let simc = opt
                .get("simc_string")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !simc.is_empty() {
                lines.push(format!("profileset.\"{}\"+={}={}", combo_name, slot, simc));
            }

            let mut meta = item_meta(opt, slot);
            meta["is_kept"] = json!(false);
            meta["upgrade_levels"] = opt.get("upgrade_levels").cloned().unwrap_or(json!(0));
            items_meta.push(meta);
        }

        if !talents_string.is_empty() {
            lines.push(format!(
                "profileset.\"{}\"+=talents={}",
                combo_name, talents_string
            ));
        }
        lines.push(String::new());

        combo_metadata.insert(combo_name, items_meta);
        combo_idx += 1;
    }

    let combo_count = combo_idx - 2;
    Ok((lines.join("\n"), combo_count, combo_metadata))
}

/// Vault constraint: at most one vault item across all slots.
/// An item and its upgraded copy (same item_id) count as a single vault pick.
fn validate_vault_constraint(gear_set: &HashMap<String, Value>) -> bool {
    let mut vault_item_ids: HashSet<u64> = HashSet::new();
    for item in gear_set.values() {
        if item.get("origin").and_then(|v| v.as_str()) == Some("vault") {
            let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            vault_item_ids.insert(item_id);
            if vault_item_ids.len() > 1 {
                return false;
            }
        }
    }
    true
}

/// Catalyst constraint: at most `max_charges` catalyst items per combination.
fn validate_catalyst_constraint(gear_set: &HashMap<String, Value>, max_charges: u32) -> bool {
    let count = gear_set
        .values()
        .filter(|item| {
            item.get("is_catalyst")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .count();
    count as u32 <= max_charges
}

/// Weapon constraint: a two-hander (inventory_type 17) in main_hand cannot be
/// paired with an off_hand item, unless the spec is fury (Titan's Grip).
fn validate_weapon_constraint(gear_set: &HashMap<String, Value>, spec: &str) -> bool {
    if spec == "fury" {
        return true;
    }
    let Some(mh) = gear_set.get("main_hand") else {
        return true;
    };
    let mh_item_id = mh.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
    if mh_item_id == 0 {
        return true;
    }
    let inv_type = game_data::get_inventory_type(mh_item_id).unwrap_or(0);
    if inv_type != 17 {
        return true;
    }
    // Main hand is a two-hander — off_hand must be empty
    let oh = gear_set.get("off_hand");
    match oh {
        None => true,
        Some(oh_item) => {
            let oh_id = oh_item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            oh_id == 0
        }
    }
}

/// Build per-slot candidate lists from items_by_slot and selected UIDs.
fn build_slot_candidates(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
) -> HashMap<String, Vec<Value>> {
    let mut slot_item_lists: HashMap<String, Vec<Value>> = HashMap::new();

    for slot in GEAR_SLOTS {
        let slot = slot.to_string();
        let slot_items = match items_by_slot.get(&slot) {
            Some(items) => items,
            None => continue,
        };

        let selected_uids: HashSet<String> = selected_items
            .get(&slot)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .collect();

        // Mirror selections from paired slots (rings/trinkets) using slot-agnostic identity.
        // This ensures selecting a trinket/ring produces variants for both paired slots.
        let mut selected_identities: HashSet<String> =
            selected_uids.iter().map(|uid| uid_identity(uid)).collect();
        if let Some(paired) = class_data::paired_slot(&slot) {
            if let Some(paired_uids) = selected_items.get(paired) {
                selected_identities.extend(paired_uids.iter().map(|uid| uid_identity(uid)));
            }
        }

        let mut candidates: Vec<Value> = Vec::new();
        for item in slot_items {
            let uid = make_item_uid(item);
            let identity = make_item_identity(item);
            if selected_uids.contains(&uid) || selected_identities.contains(&identity) {
                candidates.push(item.clone());
            }
        }

        let equipped = slot_items.iter().find(|it| {
            it.get("is_equipped")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        });

        if let Some(eq) = equipped {
            let already_included = candidates.iter().any(|c| {
                c.get("item_id") == eq.get("item_id")
                    && c.get("is_equipped")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
            });
            if !already_included {
                candidates.insert(0, eq.clone());
            }
        }

        if !candidates.is_empty() {
            slot_item_lists.insert(slot, candidates);
        }
    }

    // Armor type filtering
    if let Some(class_name) = class_data::detect_class(base_profile) {
        if let Some(max_subclass) = class_data::class_max_armor(class_name.as_str()) {
            for slot in ARMOR_SLOTS {
                let slot = slot.to_string();
                if let Some(items) = slot_item_lists.get_mut(&slot) {
                    items.retain(|item| {
                        if item
                            .get("is_equipped")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false)
                        {
                            return true;
                        }
                        let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
                        if item_id == 0 {
                            return true;
                        }
                        match game_data::get_item_armor_subclass(item_id) {
                            Some(subclass) => subclass <= max_subclass || subclass == 0,
                            None => true,
                        }
                    });
                }
            }
        }
    }

    slot_item_lists
}

fn gear_set_identity_key(gear_set: &HashMap<String, Value>) -> String {
    GEAR_SLOTS
        .iter()
        .map(|slot| {
            if let Some(item) = gear_set.get(*slot) {
                let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
                let mut bonus_ids: Vec<u64> = item
                    .get("bonus_ids")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
                    .unwrap_or_default();
                bonus_ids.sort();
                let bonus_key = bonus_ids
                    .iter()
                    .map(|b| b.to_string())
                    .collect::<Vec<_>>()
                    .join(":");
                format!("{}={}:{}", slot, item_id, bonus_key)
            } else {
                format!("{}=none", slot)
            }
        })
        .collect::<Vec<_>>()
        .join("|")
}

fn main_hand_is_two_hand(gear_set: &HashMap<String, Value>, spec: &str) -> bool {
    if spec == "fury" {
        return false;
    }
    let Some(mh) = gear_set.get("main_hand") else {
        return false;
    };
    let mh_item_id = mh.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
    if mh_item_id == 0 {
        return false;
    }
    let mh_bonus_ids: Vec<u64> = mh
        .get("bonus_ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
        .unwrap_or_default();
    let inv_type = game_data::get_item_info(mh_item_id, Some(&mh_bonus_ids))
        .map(|info| info.inventory_type)
        .unwrap_or(0);
    inv_type == 17
}

fn validate_unique_equipped(gear_set: &HashMap<String, Value>) -> bool {
    // Check paired slots (rings, trinkets) for same item_id
    for (slot1, slot2) in UNIQUE_SLOT_PAIRS {
        let item1 = gear_set.get(*slot1);
        let item2 = gear_set.get(*slot2);
        if let (Some(i1), Some(i2)) = (item1, item2) {
            let id1 = i1.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            let id2 = i2.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            if id1 != 0 && id2 != 0 && id1 == id2 {
                return false;
            }
        }
    }
    true
}

/// Validate item limit categories (e.g. max 2 embellished items).
fn validate_item_limits(gear_set: &HashMap<String, Value>) -> bool {
    let mut category_counts: HashMap<u64, u64> = HashMap::new();
    let mut category_limits: HashMap<u64, u64> = HashMap::new();

    for item in gear_set.values() {
        let bonus_ids: Vec<u64> = item
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
            .unwrap_or_default();
        for (cat_id, max_qty) in game_data::get_item_limit_categories(&bonus_ids) {
            *category_counts.entry(cat_id).or_insert(0) += 1;
            category_limits.insert(cat_id, max_qty);
        }
    }

    for (cat_id, count) in &category_counts {
        if let Some(&limit) = category_limits.get(cat_id) {
            if *count > limit {
                return false;
            }
        }
    }
    true
}

// ---- Enchant & Gem profileset generator ----

/// An axis in the enchant/gem cartesian product.
struct EnchantGemAxis {
    slot: String,
    kind: &'static str, // "enchant" or "gem"
    options: Vec<u64>,  // enchant_ids or gem_item_ids
}

/// Modify a simc gear string to set or replace an enchant_id.
fn set_enchant_id(simc: &str, enchant_id: u64) -> String {
    let re = Regex::new(r"enchant_id=\d+").unwrap();
    if re.is_match(simc) {
        re.replace(simc, &format!("enchant_id={}", enchant_id))
            .to_string()
    } else {
        let id_re = Regex::new(r"(,id=\d+)").unwrap();
        id_re
            .replace(simc, &format!("$1,enchant_id={}", enchant_id))
            .to_string()
    }
}

/// Modify a simc gear string to set or replace a gem_id.
fn set_gem_id(simc: &str, gem_id: u64) -> String {
    let re = Regex::new(r"gem_id=\d+").unwrap();
    if re.is_match(simc) {
        re.replace(simc, &format!("gem_id={}", gem_id))
            .to_string()
    } else {
        let id_re = Regex::new(r"(,id=\d+)").unwrap();
        id_re
            .replace(simc, &format!("$1,gem_id={}", gem_id))
            .to_string()
    }
}

/// Extract the current enchant_id from a simc gear string.
fn extract_enchant_id(simc: &str) -> u64 {
    let re = Regex::new(r"enchant_id=(\d+)").unwrap();
    re.captures(simc)
        .and_then(|c| c[1].parse().ok())
        .unwrap_or(0)
}

/// Extract the item id from a simc gear string.
fn extract_item_id(simc: &str) -> u64 {
    let re = Regex::new(r"id=(\d+)").unwrap();
    re.captures(simc)
        .and_then(|c| c[1].parse().ok())
        .unwrap_or(0)
}

/// Extract the current gem_id from a simc gear string.
fn extract_gem_id(simc: &str) -> u64 {
    let re = Regex::new(r"gem_id=(\d+)").unwrap();
    re.captures(simc)
        .and_then(|c| c[1].parse().ok())
        .unwrap_or(0)
}

/// Generate profileset input for enchant & gem comparisons.
///
/// Takes the base profile and maps of slot → enchant_id options / gem_id options.
/// Produces a cartesian product of all selected options, outputting profilesets
/// that only override the slots where the enchant/gem differs from the baseline.
pub fn generate_enchant_gem_input(
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

    // Gem options: single axis that applies to all socketed slots
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

    // Sort axes by slot name for deterministic ordering
    axes.sort_by(|a, b| a.slot.cmp(&b.slot).then_with(|| a.kind.cmp(b.kind)));

    // Generate cartesian product of all axes
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

    // Filter out the baseline combo (where every axis uses index 0 = current equipped)
    let baseline: Vec<usize> = vec![0; axes.len()];
    let valid_combos: Vec<Vec<usize>> = all_combos
        .into_iter()
        .filter(|c| *c != baseline)
        .collect();

    let combo_count = valid_combos.len();
    let limit = max_combos_override.unwrap_or(*MAX_COMBINATIONS);
    if combo_count > limit {
        return Err(format!(
            "Too many combinations ({}). Maximum is {}. Please deselect some options.",
            combo_count, limit
        ));
    }

    if combo_count == 0 {
        return Ok((base_profile.to_string(), 0, HashMap::new()));
    }

    // Build output
    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: HashMap<String, Vec<Value>> = HashMap::new();

    // Write base actor as Combo 1
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

    // Baseline metadata
    combo_metadata.insert("Currently Equipped".to_string(), Vec::new());

    // Generate profilesets for each combo
    for (idx, combo_indices) in valid_combos.iter().enumerate() {
        let combo_number = idx + 2;
        let combo_name = format!("Combo {}", combo_number);
        lines.push(format!("### {}", combo_name));

        let mut meta_items: Vec<Value> = Vec::new();

        // Collect per-slot enchant changes and the global gem change
        let mut enchant_changes: HashMap<String, u64> = HashMap::new();
        let mut gem_change: Option<u64> = None;
        for (axis_idx, &option_idx) in combo_indices.iter().enumerate() {
            if option_idx == 0 {
                continue; // baseline
            }
            let axis = &axes[axis_idx];
            let new_val = axis.options[option_idx];
            match axis.kind {
                "enchant" => { enchant_changes.insert(axis.slot.clone(), new_val); }
                "gem" => { gem_change = Some(new_val); }
                _ => {}
            }
        }

        // Emit profileset lines for changed slots
        for slot in GEAR_SLOTS {
            let slot_str = slot.to_string();
            let has_enchant = enchant_changes.contains_key(&slot_str);
            let has_gem = gem_change.is_some() && equipped_gear.get(&slot_str)
                .map(|s| {
                    let iid = extract_item_id(s);
                    socketed_item_ids.contains(&iid) && extract_gem_id(s) == 0
                })
                .unwrap_or(false);

            if !has_enchant && !has_gem {
                continue;
            }

            let mut simc = equipped_gear
                .get(&slot_str)
                .cloned()
                .unwrap_or_default();

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

            lines.push(format!(
                "profileset.\"{}\"+={}={}",
                combo_name, slot, simc
            ));
        }

        // Add gem metadata once (not per slot)
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
