use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use super::base_profile::{item_meta, parse_base_profile};
use super::constraints::{
    gear_set_identity_key, main_hand_is_two_hand, validate_catalyst_constraint,
    validate_item_limits, validate_unique_equipped, validate_vault_constraint,
    validate_weapon_constraint,
};
use super::selection::build_slot_candidates;
use super::simc::{
    combinations, extract_enchant_id, extract_gem_id, extract_item_id,
    extract_spec_id_from_talent_string, gem_color, is_diamond, set_enchant_id, set_gem_id,
    simc_has_socket,
};
use super::{ProfilesetResult, MAX_COMBINATIONS};
use crate::game_data;
use crate::types::class_data::{self, GEAR_SLOTS};

struct EnchantGemAxis {
    slot: String,
    kind: &'static str,
    options: Vec<u64>,
}

fn dedupe_gem_assignments(
    combos: Vec<HashMap<String, u64>>,
    max_diamonds: usize,
) -> Vec<HashMap<String, u64>> {
    let mut seen: HashSet<Vec<u64>> = HashSet::new();
    let mut result = Vec::new();

    for combo in combos {
        let diamond_count = combo.values().filter(|&&gid| is_diamond(gid)).count();
        if diamond_count > max_diamonds {
            continue;
        }

        let mut key: Vec<u64> = combo.values().copied().collect();
        key.sort();
        if seen.insert(key) {
            result.push(combo);
        }
    }

    result
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
        false,
        false,
        false,
    )
}

/// Generate top-gear profileset input, optionally multiplying by talent builds
/// and enchant/gem variations.
#[allow(clippy::too_many_arguments)]
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
    replace_gems: bool,
    diamond_always_use: bool,
    max_colors: bool,
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

    let has_enchant_gem_input =
        enchant_selections.values().any(|v| !v.is_empty()) || !gem_options.is_empty();

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
    eg_axes.sort_by(|a, b| a.slot.cmp(&b.slot).then_with(|| a.kind.cmp(b.kind)));

    // Build gem combinations as a list of per-socket assignments.
    // Each entry: HashMap<slot, gem_item_id> representing one gem combo.
    let gem_combos: Vec<HashMap<String, u64>> = if !gem_options.is_empty() {
        // Determine which slots CAN have gems — look at ALL items (equipped + alternatives)
        // so that items with added sockets are included.
        let mut gem_slots: Vec<String> = Vec::new();
        for slot in crate::types::class_data::GEAR_SLOTS {
            let slot_str = slot.to_string();
            // Check equipped item
            let equipped_has_socket = equipped_gear
                .get(&slot_str)
                .map(|simc| {
                    let item_id = extract_item_id(simc);
                    socketed_item_ids.contains(&item_id)
                        && (replace_gems || extract_gem_id(simc) == 0)
                })
                .unwrap_or(false);
            // Check alternatives for any item with sockets
            let alt_has_socket = items_by_slot
                .get(&slot_str)
                .map(|items| {
                    items
                        .iter()
                        .any(|item| item.get("sockets").and_then(|s| s.as_u64()).unwrap_or(0) > 0)
                })
                .unwrap_or(false);
            if equipped_has_socket || alt_has_socket {
                gem_slots.push(slot_str);
            }
        }

        // Deduplicate gem options
        let mut gems: Vec<u64> = Vec::new();
        for &gid in gem_options {
            if !gems.contains(&gid) {
                gems.push(gid);
            }
        }

        // If not replacing gems, check if a diamond is already equipped.
        // Diamonds are unique-equipped (max 1), so don't add more.
        if !replace_gems {
            let has_equipped_diamond = equipped_gear.values().any(|simc| {
                let gid = extract_gem_id(simc);
                gid > 0 && is_diamond(gid)
            });
            if has_equipped_diamond {
                gems.retain(|g| !is_diamond(*g));
            }
        }

        // Diamonds are unique-equipped: at most one per gear set.
        // When diamond_always_use is enabled, require exactly one if any are selected.
        let diamond_ids: Vec<u64> = gems.iter().filter(|&&g| is_diamond(g)).copied().collect();
        gems.retain(|g| !is_diamond(*g));

        // Helper: generate colored gem combos for a set of non-diamond slots
        let gen_color_combos =
            |slots: &[String], gems: &[u64], max_colors: bool| -> Vec<HashMap<String, u64>> {
                if slots.is_empty() {
                    return vec![HashMap::new()];
                }
                if gems.is_empty() {
                    return vec![HashMap::new()];
                }
                if max_colors {
                    let mut by_color: HashMap<String, Vec<u64>> = HashMap::new();
                    for &gid in gems {
                        let color = gem_color(gid).unwrap_or_else(|| "other".to_string());
                        by_color.entry(color).or_default().push(gid);
                    }
                    let colors: Vec<String> = by_color.keys().cloned().collect();
                    let n_colors = colors.len().min(slots.len());

                    let color_combos = combinations(&colors, n_colors);
                    let mut result: Vec<HashMap<String, u64>> = Vec::new();
                    for color_set in &color_combos {
                        let per_slot_gems: Vec<&Vec<u64>> =
                            color_set.iter().map(|c| by_color.get(c).unwrap()).collect();
                        let mut slot_combos: Vec<Vec<u64>> = vec![vec![]];
                        for slot_gems in &per_slot_gems {
                            let mut next = Vec::new();
                            for combo in &slot_combos {
                                for &gid in *slot_gems {
                                    let mut c = combo.clone();
                                    c.push(gid);
                                    next.push(c);
                                }
                            }
                            slot_combos = next;
                        }
                        for slot_combo in slot_combos {
                            let combo: HashMap<String, u64> = slot_combo
                                .iter()
                                .enumerate()
                                .filter(|(i, _)| *i < slots.len())
                                .map(|(i, &gid)| (slots[i].clone(), gid))
                                .collect();
                            result.push(combo);
                        }
                    }
                    result
                } else {
                    // Cartesian product: each slot independently gets each gem,
                    // then deduplicate mirror combos (gems are slot-independent).
                    let mut result: Vec<HashMap<String, u64>> = vec![HashMap::new()];
                    for slot in slots {
                        let mut next = Vec::new();
                        for combo in &result {
                            for &gid in gems {
                                let mut c = combo.clone();
                                c.insert(slot.clone(), gid);
                                next.push(c);
                            }
                        }
                        result = next;
                    }
                    dedupe_gem_assignments(result, 0)
                }
            };

        if gems.is_empty() && diamond_ids.is_empty() {
            Vec::new()
        } else if !diamond_ids.is_empty() && diamond_always_use {
            // Diamond always-use: try exactly one diamond in each socketed slot position.
            let mut result: Vec<HashMap<String, u64>> = Vec::new();
            for (d_idx, d_slot) in gem_slots.iter().enumerate() {
                let remaining: Vec<String> = gem_slots
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != d_idx)
                    .map(|(_, s)| s.clone())
                    .collect();
                let color_combos = gen_color_combos(&remaining, &gems, max_colors);
                for &did in &diamond_ids {
                    for base in &color_combos {
                        let mut combo = base.clone();
                        combo.insert(d_slot.clone(), did);
                        result.push(combo);
                    }
                }
            }
            dedupe_gem_assignments(result, 1)
        } else if !diamond_ids.is_empty() {
            // Diamond optional: allow either no diamond or exactly one diamond, never more.
            let mut result = if gems.is_empty() {
                Vec::new()
            } else {
                gen_color_combos(&gem_slots, &gems, max_colors)
            };

            for (d_idx, d_slot) in gem_slots.iter().enumerate() {
                let remaining: Vec<String> = gem_slots
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != d_idx)
                    .map(|(_, s)| s.clone())
                    .collect();
                let color_combos = gen_color_combos(&remaining, &gems, max_colors);
                for &did in &diamond_ids {
                    for base in &color_combos {
                        let mut combo = base.clone();
                        combo.insert(d_slot.clone(), did);
                        result.push(combo);
                    }
                }
            }

            dedupe_gem_assignments(result, 1)
        } else {
            gen_color_combos(&gem_slots, &gems, max_colors)
        }
    } else {
        Vec::new()
    };
    let has_gem_combos = !gem_combos.is_empty();

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
    let eg_combo_count = eg_combos.len(); // excludes baseline (enchant-only combos)

    // Resolve talent builds
    let effective_talents: Vec<(String, String)> = if talent_builds.is_empty() {
        vec![("".to_string(), talents_string.clone())]
    } else {
        talent_builds
            .iter()
            .map(|(name, ts)| (name.clone(), ts.clone()))
            .collect()
    };
    let has_talent_variants = effective_talents.len() > 1;

    // Total combos calculation.
    // Without gems: (gear+1) × (enchant+1) × talent - 1  (subtract base actor)
    // With gems: each gem combo produces a full set of gear×enchant×talent combos,
    // plus 1 gem-only combo per gem_combo for baseline gear.
    // None of the gem combos IS the base actor, so no -1 for them.
    let gear_plus_baseline = gear_combo_count + 1;
    let enchant_plus_baseline = eg_combo_count + 1;
    let talent_count = effective_talents.len();
    let non_gem_combos = gear_plus_baseline * enchant_plus_baseline * talent_count - 1;
    let total_combo_count = if has_gem_combos {
        gem_combos.len() * gear_plus_baseline * enchant_plus_baseline * talent_count
    } else {
        non_gem_combos
    };

    let limit =
        max_combos_override.unwrap_or(MAX_COMBINATIONS.load(std::sync::atomic::Ordering::Relaxed));
    if limit > 0 && total_combo_count > limit {
        return Err(format!(
            "Too many combinations ({}). Maximum is {}. Please deselect some items.",
            total_combo_count, limit
        ));
    }

    if gear_combo_count == 0 && !has_talent_variants && eg_combo_count == 0 && !has_gem_combos {
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
                // Per-slot gem handling (legacy, not used with new gem_combos)
                "gem" if axis.slot == slot => {
                    result = set_gem_id(&result, axis.options[option_idx]);
                    changed = true;
                }
                _ => {}
            }
        }
        if changed {
            Some(result)
        } else {
            None
        }
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

    // Helper: apply a gem combo assignment to a simc string for a slot.
    // If the gem combo has a gem for this slot, set/replace gem_id.
    // If replace_gems is true, also strip existing gem_id first.
    let apply_gem = |slot: &str, simc: &str, gem_combo: &HashMap<String, u64>| -> String {
        let has_socket = simc_has_socket(simc);

        let mut result = if replace_gems && has_socket {
            let re = Regex::new(r",?gem_id=\d+").unwrap();
            re.replace(simc, "").to_string()
        } else {
            simc.to_string()
        };
        if let Some(&gid) = gem_combo.get(slot) {
            if has_socket {
                result = set_gem_id(&result, gid);
            }
        }
        result
    };

    // Helper: build gem metadata for a gem combo, filtered to only slots that
    // actually have a socket. If socketed_slots is None, include all gems.
    let build_gem_meta = |gem_combo: &HashMap<String, u64>,
                          socketed_slots: Option<&HashSet<String>>|
     -> Vec<Value> {
        let mut meta = Vec::new();
        for (slot, &gid) in gem_combo {
            if let Some(valid) = socketed_slots {
                if !valid.contains(slot) {
                    continue;
                }
            }
            let info = crate::item_db::get_gem_info(gid);
            let name = info
                .as_ref()
                .and_then(|v| v.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("");
            meta.push(json!({
                "slot": slot,
                "type": "gem",
                "gem_id": gid,
                "name": name,
            }));
        }
        meta
    };

    // Build gem combo list including baseline (empty = no gem changes)
    let gem_iter: Vec<Option<&HashMap<String, u64>>> = if has_gem_combos {
        // No baseline for gem combos — gems always get applied
        gem_combos.iter().map(Some).collect()
    } else {
        vec![None] // No gem combos selected: single pass with no gem changes
    };

    // For each gem combo × talent × gear × enchant, generate a profileset
    let empty_gear_set: HashMap<String, Value> = HashMap::new();

    for gem_combo_opt in &gem_iter {
        // Helper: apply gem combo to a simc string for a slot, if gem combo is active
        let gem_simc = |slot: &str, simc: &str| -> String {
            if let Some(gc) = gem_combo_opt {
                apply_gem(slot, simc, gc)
            } else {
                simc.to_string()
            }
        };

        for (talent_idx, (talent_name, talent_str)) in effective_talents.iter().enumerate() {
            // Build gear iterator: for first talent, skip baseline gear; for others, include it.
            let gear_iter: Vec<(bool, &HashMap<String, Value>)> = if talent_idx == 0 {
                // First talent: baseline gear is base actor. Only alternatives here.
                valid_combos.iter().map(|gs| (false, gs)).collect()
            } else {
                // Additional talents: need equipped gear + all alternatives
                std::iter::once((true, &empty_gear_set))
                    .chain(valid_combos.iter().map(|gs| (false, gs)))
                    .collect()
            };

            // For the first talent + baseline gear: emit a gem-only combo
            // (baseline gear with gem combo applied, no enchant or gear changes)
            // Skip if the gem combo doesn't actually change any equipped slot.
            if talent_idx == 0 && gem_combo_opt.is_some() {
                let any_gem_change = GEAR_SLOTS.iter().any(|slot| {
                    let slot_str = slot.to_string();
                    equipped_gear
                        .get(&slot_str)
                        .map(|gear_val| gem_simc(&slot_str, gear_val) != *gear_val)
                        .unwrap_or(false)
                });
                if !any_gem_change {
                    // Gem combo doesn't change anything on baseline gear, skip
                } else {
                    let combo_name = format!("Combo {}", combo_number);
                    lines.push(format!("### {}", combo_name));
                    for slot in GEAR_SLOTS {
                        let slot_str = slot.to_string();
                        if let Some(gear_val) = equipped_gear.get(&slot_str) {
                            let val = gem_simc(&slot_str, gear_val);
                            lines.push(format!("profileset.\"{}\"+={}={}", combo_name, slot, val));
                        } else if *slot == "off_hand" {
                            lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
                        }
                    }
                    lines.push(String::new());
                    let mut combo_items: Vec<Value> = Vec::new();
                    if let Some(gc) = gem_combo_opt {
                        let socketed: HashSet<String> = GEAR_SLOTS
                            .iter()
                            .filter(|s| equipped_gear.get(**s).is_some_and(|v| simc_has_socket(v)))
                            .map(|s| s.to_string())
                            .collect();
                        combo_items.extend(build_gem_meta(gc, Some(&socketed)));
                    }
                    combo_metadata.insert(combo_name, combo_items);
                    combo_number += 1;
                } // end any_gem_change else
            }

            // For the first talent + baseline gear, we still need enchant/gem-only combos
            if talent_idx == 0 && has_enchant_gem {
                // Baseline gear + non-baseline enchant/gem combos
                for eg_idx in &eg_combos {
                    // Check if this eg combo actually changes any equipped slot
                    let any_change = GEAR_SLOTS.iter().any(|slot| {
                        let slot_str = slot.to_string();
                        equipped_gear
                            .get(&slot_str)
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
                            let val = gem_simc(&slot_str, modified.as_deref().unwrap_or(gear_val));
                            lines.push(format!("profileset.\"{}\"+={}={}", combo_name, slot, val));
                        } else if *slot == "off_hand" {
                            lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
                        }
                    }
                    lines.push(String::new());

                    let mut combo_items: Vec<Value> = build_eg_meta(eg_idx);
                    if let Some(gc) = gem_combo_opt {
                        let socketed: HashSet<String> = GEAR_SLOTS
                            .iter()
                            .filter(|s| {
                                let slot_str = s.to_string();
                                equipped_gear.get(&slot_str).is_some_and(|v| {
                                    let modified = apply_eg_combo(&slot_str, v, eg_idx);
                                    simc_has_socket(modified.as_deref().unwrap_or(v))
                                })
                            })
                            .map(|s| s.to_string())
                            .collect();
                        combo_items.extend(build_gem_meta(gc, Some(&socketed)));
                    }
                    if has_talent_variants {
                        let talent_spec: Option<&str> =
                            extract_spec_id_from_talent_string(talent_str)
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
                                gear_set
                                    .get(&slot_str)
                                    .and_then(|item| item.get("simc_string"))
                                    .and_then(|s| s.as_str())
                                    .or_else(|| equipped_gear.get(&slot_str).map(|s| s.as_str()))
                            };
                            simc.and_then(|s| apply_eg_combo(&slot_str, s, eg_idx))
                                .is_some()
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
                                let val =
                                    gem_simc(&slot_str, modified.as_deref().unwrap_or(gear_val));
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
                                    let item_id =
                                        item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
                                    let inv_type =
                                        game_data::get_inventory_type(item_id).unwrap_or(0);
                                    if inv_type == 17 && spec != "fury" {
                                        combo_mh_is_two_hand = true;
                                    }
                                }
                                if *slot == "off_hand" && combo_mh_is_two_hand {
                                    lines
                                        .push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
                                } else {
                                    let simc_str = item
                                        .get("simc_string")
                                        .and_then(|s| s.as_str())
                                        .unwrap_or("");
                                    let modified = apply_eg_combo(&slot_str, simc_str, eg_idx);
                                    let val = gem_simc(
                                        &slot_str,
                                        modified.as_deref().unwrap_or(simc_str),
                                    );
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
                        if let Some(talent_spec_id) = extract_spec_id_from_talent_string(talent_str)
                        {
                            if let Some(talent_spec_name) =
                                class_data::spec_id_to_name(talent_spec_id)
                            {
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
                    if let Some(gc) = gem_combo_opt {
                        let socketed: HashSet<String> = GEAR_SLOTS
                            .iter()
                            .filter(|s| {
                                let slot_str = s.to_string();
                                let simc = if *is_equipped_with_new_talent || gear_set.is_empty() {
                                    equipped_gear.get(&slot_str).map(|v| v.as_str())
                                } else {
                                    gear_set
                                        .get(&slot_str)
                                        .and_then(|item| item.get("simc_string"))
                                        .and_then(|s| s.as_str())
                                        .or_else(|| {
                                            equipped_gear.get(&slot_str).map(|v| v.as_str())
                                        })
                                };
                                simc.is_some_and(|v| {
                                    let modified = apply_eg_combo(&slot_str, v, eg_idx);
                                    simc_has_socket(modified.as_deref().unwrap_or(v))
                                })
                            })
                            .map(|s| s.to_string())
                            .collect();
                        combo_items.extend(build_gem_meta(gc, Some(&socketed)));
                    }

                    // Tag with talent build name and spec if comparing talents
                    if has_talent_variants {
                        let talent_spec: Option<&str> =
                            extract_spec_id_from_talent_string(talent_str)
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
    } // end gem_iter loop

    Ok((lines.join("\n"), total_combo_count, combo_metadata))
}
