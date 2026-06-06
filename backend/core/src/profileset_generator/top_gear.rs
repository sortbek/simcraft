use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use super::base_profile::{item_meta, parse_base_profile};

use super::constraints::{
    gear_set_identity_key, is_legal_gear_set, main_hand_is_two_hand, GearSetContext,
};
use super::selection::build_slot_candidates;
use super::simc::{
    extract_enchant_id, extract_gem_id, extract_gem_ids, extract_item_id,
    extract_spec_id_from_talent_string, is_diamond, set_enchant_id,
    simc_has_socket, simc_socket_count,
};
use crate::profileset_generator::gem_combos::GemCombo;
use super::{GemEnchantOptions, ProfilesetResult, MAX_COMBINATIONS};
use crate::game_data;
use crate::types::class_data::{self, GEAR_SLOTS};

struct EnchantAxis {
    slot: String,
    options: Vec<u64>,
}

/// Build a [`ProfilesetIteratorConfig`] for the streaming/triage path.
///
/// Mirrors the axis-building logic from [`generate_top_gear_input_with_talents`]
/// (enchant axes, gem combo list, slot item lists, varying slots) without
/// running the full eager generator. Called by the Top Gear handler when the
/// estimated combo count exceeds [`TRIAGE_THRESHOLD`].
pub(crate) fn build_iterator_config(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
    talent_builds: &[(String, String)],
    gem_opts: &GemEnchantOptions,
    catalyst_charges: Option<u32>,
) -> super::iterator::ProfilesetIteratorConfig {
    use super::iterator::{EnchantAxis, GemCombosResolver, ProfilesetIteratorConfig};

    let enchant_selections = gem_opts.enchants();
    let gem_options = gem_opts.gem_options;
    let socketed_item_ids = gem_opts.sockets();
    let replace_gems = gem_opts.replace_gems;
    let diamond_always_use = gem_opts.diamond_always_use;
    let max_colors = gem_opts.max_colors;

    let (_, equipped_gear, _, spec) = parse_base_profile(base_profile);

    // Build slot_item_lists (same as eager path)
    let slot_item_lists: HashMap<String, Vec<Arc<Value>>> =
        build_slot_candidates(base_profile, items_by_slot, selected_items)
            .into_iter()
            .map(|(k, v)| (k, v.into_iter().map(Arc::new).collect()))
            .collect();

    // Find varying slots (> 1 item), sorted for determinism
    let mut varying_slots: Vec<String> = slot_item_lists
        .iter()
        .filter(|(_, items)| items.len() > 1)
        .map(|(slot, _)| slot.clone())
        .collect();
    varying_slots.sort();

    // Build enchant axes (same logic as eager path's eg_axes, "enchant" kind only)
    let mut enchant_axes: Vec<EnchantAxis> = Vec::new();
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
        // Index 0 = equipped baseline
        if current > 0 {
            options.push(current);
        } else {
            options.push(0); // placeholder for "no enchant"
        }
        for &id in ids {
            if id != current {
                options.push(id);
            }
        }
        if options.len() <= 1 {
            continue;
        }
        enchant_axes.push(EnchantAxis {
            slot: slot.clone(),
            options,
        });
    }
    enchant_axes.sort_by(|a, b| a.slot.cmp(&b.slot));

    // Build (slot, socket_count) tuples. Socket count is the max across the
    // equipped item and any selected alt for the slot — same logic as the
    // eager path so a 1-socket alt + 2-socket alt slot generates size-2
    // multisets and the 1-socket alt is truncated at apply time.
    let gem_combos: Vec<crate::profileset_generator::gem_combos::GemCombo> =
        if !gem_options.is_empty() {
            let mut gem_slots: Vec<(String, usize)> = Vec::new();
            for slot in crate::types::class_data::GEAR_SLOTS {
                let slot_str = slot.to_string();
                let equipped_count = equipped_gear
                    .get(&slot_str)
                    .map(|simc| {
                        let item_id = extract_item_id(simc);
                        if !socketed_item_ids.contains(&item_id) {
                            return 0;
                        }
                        if !replace_gems && extract_gem_id(simc) != 0 {
                            return 0; // Already gemmed; preserve as-is.
                        }
                        simc_socket_count(simc)
                    })
                    .unwrap_or(0);
                let alt_count = items_by_slot
                    .get(&slot_str)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| {
                                let has_gem =
                                    item.get("gem_id").and_then(|g| g.as_u64()).unwrap_or(0) > 0;
                                if !replace_gems && has_gem {
                                    return None;
                                }
                                item.get("sockets")
                                    .and_then(|s| s.as_u64())
                                    .map(|n| n as usize)
                            })
                            .max()
                            .unwrap_or(0)
                    })
                    .unwrap_or(0);
                let socket_count = equipped_count.max(alt_count);
                if socket_count > 0 {
                    gem_slots.push((slot_str, socket_count));
                }
            }

            let mut gems: Vec<u64> = Vec::new();
            for &gid in gem_options {
                if !gems.contains(&gid) {
                    gems.push(gid);
                }
            }
            if !replace_gems {
                // Scan every socket on every equipped item — a 2-socket neck
                // can hide a diamond at index 1, which single-gem extract
                // would miss.
                let has_equipped_diamond = equipped_gear
                    .values()
                    .flat_map(|simc| extract_gem_ids(simc))
                    .any(is_diamond);
                if has_equipped_diamond {
                    gems.retain(|g| !is_diamond(*g));
                }
            }

            let diamond_ids: Vec<u64> = gems.iter().filter(|&&g| is_diamond(g)).copied().collect();
            gems.retain(|g| !is_diamond(*g));

            let builder = crate::profileset_generator::gem_combos::GemCombosBuilder {
                gem_options: &gems,
                gem_slots: &gem_slots,
                diamond_ids: &diamond_ids,
                diamond_always_use,
                max_colors,
            };
            crate::profileset_generator::gem_combos::enumerate_all(&builder)
        } else {
            Vec::new()
        };

    let gem_combo_count = gem_combos.len();
    let gem_combos_resolver = GemCombosResolver::new(gem_combos);

    // Socketed item ids as HashSet<u64> (already available)
    let socketed_ids_owned: std::collections::HashSet<u64> =
        socketed_item_ids.iter().copied().collect();

    // Talent builds: if empty, pass empty vec (iterator treats as single-pass)
    let talent_builds_owned: Vec<(String, String)> = talent_builds.to_vec();

    ProfilesetIteratorConfig {
        spec,
        base_profile: Arc::from(base_profile),
        slot_item_lists,
        varying_slots,
        enchant_axes,
        gem_combo_count,
        gem_combos_resolver,
        socketed_item_ids: socketed_ids_owned,
        talent_builds: talent_builds_owned,
        max_catalyst_charges: catalyst_charges,
    }
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
        &GemEnchantOptions::default(),
        false,
    )
}

/// Count-only variant: runs the full generator pipeline but skips building any
/// output strings or metadata. Used by the live combo-count endpoint, which is
/// hit on every selection change in the UI and would otherwise re-do all the
/// per-emit formatting work just to discard it.
pub fn count_top_gear_combos_with_talents(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
    max_combos_override: Option<usize>,
    talent_builds: &[(String, String)],
    catalyst_charges: Option<u32>,
    gem_opts: &GemEnchantOptions,
) -> Result<usize, String> {
    generate_top_gear_input_with_talents(
        base_profile,
        items_by_slot,
        selected_items,
        max_combos_override,
        talent_builds,
        catalyst_charges,
        gem_opts,
        true,
    )
    .map(|(_, count, _)| count)
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
    gem_opts: &GemEnchantOptions,
    count_only: bool,
) -> ProfilesetResult {
    let enchant_selections = gem_opts.enchants();
    let gem_options = gem_opts.gem_options;
    let socketed_item_ids = gem_opts.sockets();
    let replace_gems = gem_opts.replace_gems;
    let diamond_always_use = gem_opts.diamond_always_use;
    let max_colors = gem_opts.max_colors;
    // Extract base profile info (non-gear lines) and equipped gear
    let (base_lines, equipped_gear, talents_string, spec) = parse_base_profile(base_profile);

    // Items wrap in Arc so the per-combo `gear_set` build can do cheap O(1)
    // refcount clones instead of deep-cloning each JSON Value 16 times per combo.
    let slot_item_lists: HashMap<String, Vec<Arc<Value>>> =
        build_slot_candidates(base_profile, items_by_slot, selected_items)
            .into_iter()
            .map(|(k, v)| (k, v.into_iter().map(Arc::new).collect()))
            .collect();

    // Find slots that have alternatives (more than just equipped)
    let varying_slots: Vec<String> = slot_item_lists
        .iter()
        .filter(|(_, items)| items.len() > 1)
        .map(|(slot, _)| slot.clone())
        .collect();

    // Sort for deterministic ordering
    let mut varying_slots = varying_slots;
    varying_slots.sort();

    let has_enchant_axes_input =
        enchant_selections.values().any(|v| !v.is_empty()) || !gem_options.is_empty();

    if varying_slots.is_empty() && talent_builds.len() <= 1 && !has_enchant_axes_input {
        return Ok((base_profile.to_string(), 0, HashMap::new()));
    }

    // Lazily enumerate the cartesian product across varying slots in
    // lexicographic order (first varying slot most significant). Building the
    // full `Vec<Vec<usize>>` up front would allocate the entire raw product —
    // which for large selections dwarfs the valid set and can exhaust memory
    // before the limit check ever runs. Iterating in place keeps memory flat
    // and lets us bail the moment the valid count exceeds the limit.
    let option_lists: Vec<&Vec<Arc<Value>>> = varying_slots
        .iter()
        .map(|slot| slot_item_lists.get(slot).unwrap())
        .collect();
    let radices: Vec<usize> = option_lists.iter().map(|o| o.len()).collect();
    let n_axes = radices.len();

    let limit =
        max_combos_override.unwrap_or(MAX_COMBINATIONS.load(std::sync::atomic::Ordering::Relaxed));

    // Build one candidate gear set from a combo's per-axis indices, returning
    // None for sets that are illegal or identical to the all-equipped baseline.
    let make_gear_set = |combo_indices: &[usize]| -> Option<HashMap<String, Arc<Value>>> {
        let mut gear_set: HashMap<String, Arc<Value>> = HashMap::new();
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
                gear_set.insert(slot, Arc::clone(default));
            }
        }

        // Apply the combo choices
        for (i, slot) in varying_slots.iter().enumerate() {
            let item = &option_lists[i][combo_indices[i]];
            gear_set.insert(slot.clone(), Arc::clone(item));
        }

        // For non-Fury specs, a 2H main hand forces an empty off hand.
        // Normalize here so count and generated combos align.
        if main_hand_is_two_hand(&gear_set, &spec) {
            gear_set.remove("off_hand");
        }

        if !is_legal_gear_set(
            &gear_set,
            &GearSetContext {
                spec: &spec,
                max_catalyst_charges: catalyst_charges,
            },
        ) {
            return None;
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
            return None;
        }

        Some(gear_set)
    };

    let mut valid_combos: Vec<HashMap<String, Arc<Value>>> = Vec::new();
    let mut seen_combo_keys: HashSet<String> = HashSet::new();
    let mut combo_indices = vec![0usize; n_axes];

    loop {
        if let Some(gear_set) = make_gear_set(&combo_indices) {
            let combo_key = gear_set_identity_key(&gear_set);
            if seen_combo_keys.insert(combo_key) {
                valid_combos.push(gear_set);
                // total_combo_count >= gear_combo_count always, so once the
                // gear axis alone overflows the limit the whole job does too.
                // Stop here and report the O(axes) upper-bound estimate rather
                // than pay for an exact total we've already proven is too big.
                if limit > 0 && valid_combos.len() > limit {
                    let est = super::estimate_top_gear_combo_count(
                        items_by_slot,
                        selected_items,
                        enchant_selections,
                        gem_options,
                        socketed_item_ids,
                        talent_builds.len().max(1),
                    );
                    return Err(format!(
                        "Too many combinations ({est}). Maximum is {limit}. Please deselect some items."
                    ));
                }
            }
        }

        // Advance the mixed-radix counter (rightmost axis least significant)
        // to reproduce the old eager product's lexicographic ordering.
        if n_axes == 0 {
            break;
        }
        let mut i = n_axes;
        let mut carried = true;
        while i > 0 {
            i -= 1;
            combo_indices[i] += 1;
            if combo_indices[i] < radices[i] {
                carried = false;
                break;
            }
            combo_indices[i] = 0;
        }
        if carried {
            break;
        }
    }

    let gear_combo_count = valid_combos.len(); // excludes baseline

    // Build enchant variation axes. Each axis = (slot, options) where options
    // includes the equipped value at index 0.
    let mut enchant_axes: Vec<EnchantAxis> = Vec::new();
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
        enchant_axes.push(EnchantAxis {
            slot: slot.clone(),
            options,
        });
    }
    enchant_axes.sort_by(|a, b| a.slot.cmp(&b.slot));

    // Build gem combinations as a list of per-socket assignments.
    // Each entry: HashMap<slot, Vec<gem_item_id>> — one gem id per socket on
    // that slot's item. A 2-socket neck contributes a length-2 Vec.
    let gem_combos: Vec<crate::profileset_generator::gem_combos::GemCombo> =
        if !gem_options.is_empty() {
        // For each slot, compute (slot, socket_count). The count is the max
        // number of sockets across the equipped item and any selected alts —
        // a slot with a 1-socket alt and a 2-socket alt is generated as size
        // 2; at apply time the per-item simc line is truncated to its real
        // socket count so the smaller item still gets a valid `gem_id=A`.
        let mut gem_slots: Vec<(String, usize)> = Vec::new();
        for slot in crate::types::class_data::GEAR_SLOTS {
            let slot_str = slot.to_string();
            // Equipped item contribution
            let equipped_count = equipped_gear
                .get(&slot_str)
                .map(|simc| {
                    let item_id = extract_item_id(simc);
                    if !socketed_item_ids.contains(&item_id) {
                        return 0;
                    }
                    if !replace_gems && extract_gem_id(simc) != 0 {
                        return 0; // Already gemmed; preserve as-is.
                    }
                    simc_socket_count(simc)
                })
                .unwrap_or(0);
            // Alternatives contribution
            let alt_count = items_by_slot
                .get(&slot_str)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| {
                            let has_gem =
                                item.get("gem_id").and_then(|g| g.as_u64()).unwrap_or(0) > 0;
                            if !replace_gems && has_gem {
                                return None;
                            }
                            item.get("sockets")
                                .and_then(|s| s.as_u64())
                                .map(|n| n as usize)
                        })
                        .max()
                        .unwrap_or(0)
                })
                .unwrap_or(0);
            let socket_count = equipped_count.max(alt_count);
            if socket_count > 0 {
                gem_slots.push((slot_str, socket_count));
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
            // Scan every socket on every equipped item — a 2-socket neck can
            // hide a diamond at index 1, which single-gem extract would miss.
            let has_equipped_diamond = equipped_gear
                .values()
                .flat_map(|simc| extract_gem_ids(simc))
                .any(is_diamond);
            if has_equipped_diamond {
                gems.retain(|g| !is_diamond(*g));
            }
        }

        // Diamonds are unique-equipped: at most one per gear set.
        // When diamond_always_use is enabled, require exactly one if any are selected.
        let diamond_ids: Vec<u64> = gems.iter().filter(|&&g| is_diamond(g)).copied().collect();
        gems.retain(|g| !is_diamond(*g));

        let builder = crate::profileset_generator::gem_combos::GemCombosBuilder {
            gem_options: &gems,
            gem_slots: &gem_slots,
            diamond_ids: &diamond_ids,
            diamond_always_use,
            max_colors,
        };
        crate::profileset_generator::gem_combos::enumerate_all(&builder)
    } else {
        Vec::new()
    };
    let has_gem_combos = !gem_combos.is_empty();

    // Cartesian product of enchant axes (excluding the all-equipped baseline).
    let has_enchant_axes = !enchant_axes.is_empty();
    let enchant_combos: Vec<Vec<usize>> = if has_enchant_axes {
        let mut all: Vec<Vec<usize>> = vec![vec![]];
        for axis in &enchant_axes {
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
        let baseline: Vec<usize> = vec![0; enchant_axes.len()];
        all.into_iter().filter(|c| *c != baseline).collect()
    } else {
        Vec::new()
    };
    let enchant_combo_count = enchant_combos.len();

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
    let enchant_plus_baseline = enchant_combo_count + 1;
    let talent_count = effective_talents.len();
    let non_gem_combos = gear_plus_baseline * enchant_plus_baseline * talent_count - 1;
    let total_combo_count = if has_gem_combos {
        gem_combos.len() * gear_plus_baseline * enchant_plus_baseline * talent_count
    } else {
        non_gem_combos
    };

    // `limit` is computed once above (before the gear loop) and reused here for
    // the full gear×enchant×gem×talent total.
    if limit > 0 && total_combo_count > limit {
        return Err(format!(
            "Too many combinations ({}). Maximum is {}. Please deselect some items.",
            total_combo_count, limit
        ));
    }

    if gear_combo_count == 0 && !has_talent_variants && enchant_combo_count == 0 && !has_gem_combos
    {
        return Ok((base_profile.to_string(), 0, HashMap::new()));
    }

    // Build output: base profile as Combo 1, then profilesets
    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: HashMap<String, Vec<Value>> = HashMap::new();
    let paired_display_slots = ["finger1", "finger2", "trinket1", "trinket2"];

    let base_talent = &effective_talents[0].1;
    // Determine the base actor's effective spec (might differ from original if first talent build is another spec)
    let base_actor_spec: String = if !base_talent.is_empty() {
        extract_spec_id_from_talent_string(base_talent)
            .and_then(class_data::spec_id_to_name)
            .map(|s| s.to_string())
            .unwrap_or_else(|| spec.clone())
    } else {
        spec.clone()
    };

    if !count_only {
        // Write clean base profile (non-gear lines + equipped gear)
        lines.extend(super::emit::emit_base_actor(
            &base_lines,
            &equipped_gear,
            base_talent,
            &base_actor_spec,
            &spec,
        ));
    }

    // Build baseline metadata for "Currently Equipped"
    if !count_only {
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
            let talent_spec: Option<&str> =
                extract_spec_id_from_talent_string(&effective_talents[0].1)
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
    }

    let mut combo_number = 2usize;

    // Enchant combo list including the baseline (index 0 per axis = equipped).
    // `enchant_combos` excludes baseline; this list includes it as the first entry.
    let enchant_baseline: Vec<usize> = vec![0; enchant_axes.len()];
    let enchant_all_combos: Vec<Vec<usize>> = if has_enchant_axes {
        let mut v = vec![enchant_baseline.clone()];
        v.extend(enchant_combos.iter().cloned());
        v
    } else {
        vec![vec![]]
    };

    // Apply an enchant combo to a simc string for a given slot. Returns the
    // modified string, or None if this combo doesn't touch this slot.
    let apply_enchant_combo = |slot: &str, simc: &str, indices: &[usize]| -> Option<String> {
        let mut result = simc.to_string();
        let mut changed = false;
        for (axis_idx, &option_idx) in indices.iter().enumerate() {
            let axis = &enchant_axes[axis_idx];
            if option_idx == 0 || axis.slot != slot {
                continue; // Baseline (equipped enchant) or wrong slot.
            }
            result = set_enchant_id(&result, axis.options[option_idx]);
            changed = true;
        }
        if changed {
            Some(result)
        } else {
            None
        }
    };

    let build_enchant_meta = |indices: &[usize]| -> Vec<Value> {
        let mut meta = Vec::new();
        for (axis_idx, &option_idx) in indices.iter().enumerate() {
            if option_idx == 0 {
                continue; // Baseline enchant = equipped, no metadata change.
            }
            let axis = &enchant_axes[axis_idx];
            let new_val = axis.options[option_idx];
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
        meta
    };

    // Per-slot socket count for equipped items. Primary source: each item's authoritative
    // `"sockets"` field in game data (from slot_item_lists). Fallback: `simc_socket_count`
    // from the equipped simc string, which covers bonus-id sockets and existing gem counts
    // for items that aren't in slot_item_lists (e.g. when items_by_slot is empty).
    let equipped_sockets: HashMap<String, usize> = GEAR_SLOTS
        .iter()
        .filter_map(|slot| {
            // Primary: game-data "sockets" field from slot_item_lists
            let from_items = slot_item_lists
                .get(*slot)
                .and_then(|items| items.iter().find(|it| {
                    it.get("is_equipped").and_then(|v| v.as_bool()).unwrap_or(false)
                }))
                .and_then(|it| it.get("sockets"))
                .and_then(|s| s.as_u64())
                .unwrap_or(0) as usize;
            // Fallback: derive from simc string (bonus_id resolved + existing gem count)
            let sockets = if from_items > 0 {
                from_items
            } else {
                equipped_gear
                    .get(*slot)
                    .map(|s| simc_socket_count(s))
                    .unwrap_or(0)
            };
            if sockets > 0 {
                Some((slot.to_string(), sockets))
            } else {
                None
            }
        })
        .collect();

    // Helper: build gem metadata for a gem combo, filtered to only slots that
    // actually have a socket. If socketed_slots is None, include all gems.
    // Emits one entry per socket so a 2-socket neck produces two metadata rows.
    let build_gem_meta =
        |gem_combo: &GemCombo, socketed_slots: Option<&HashSet<String>>| -> Vec<Value> {
            let mut meta = Vec::new();
            for (slot, gids) in gem_combo {
                if let Some(valid) = socketed_slots {
                    if !valid.contains(slot) {
                        continue;
                    }
                }
                for &gid in gids {
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
            }
            meta
        };

    // Build gem combo list including baseline (empty = no gem changes)
    let gem_iter: Vec<Option<&GemCombo>> = if has_gem_combos {
        // No baseline for gem combos — gems always get applied
        gem_combos.iter().map(Some).collect()
    } else {
        vec![None] // No gem combos selected: single pass with no gem changes
    };

    // For each gem combo × talent × gear × enchant, generate a profileset
    let empty_gear_set: HashMap<String, Arc<Value>> = HashMap::new();

    // Cache socketed-slot sets keyed by (gear_set pointer, enchant_idx). The set
    // depends only on gear+eg, not on the current gem combo, so once computed
    // it's reused across all gem_iter passes.
    let mut socketed_cache: HashMap<(usize, Vec<usize>), HashSet<String>> = HashMap::new();

    for gem_combo_opt in &gem_iter {
        // Helper: apply gem combo to a simc string for a slot (equipped-gear paths only).
        // Uses the slot's equipped_sockets count (from game-data `"sockets"` field).
        let gem_simc_equipped = |slot: &str, simc: &str| -> String {
            if let Some(gc) = gem_combo_opt {
                let sockets = equipped_sockets.get(slot).copied().unwrap_or(0);
                super::emit::apply_item_gems(simc, sockets, slot, gc, replace_gems)
            } else {
                simc.to_string()
            }
        };

        for (talent_idx, (talent_name, talent_str)) in effective_talents.iter().enumerate() {
            // Build gear iterator: for first talent, skip baseline gear; for others, include it.
            let gear_iter: Vec<(bool, &HashMap<String, Arc<Value>>)> = if talent_idx == 0 {
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
                    equipped_gear
                        .get(*slot)
                        .map(|gear_val| gem_simc_equipped(slot, gear_val) != *gear_val)
                        .unwrap_or(false)
                });
                if any_gem_change {
                    if !count_only {
                        let combo_name = format!("Combo {}", combo_number);
                        // Build slot_simc map: equipped gear with gem combo applied.
                        let slot_simc: HashMap<String, String> = GEAR_SLOTS
                            .iter()
                            .filter_map(|slot| {
                                equipped_gear
                                    .get(*slot)
                                    .map(|gear_val| (slot.to_string(), gem_simc_equipped(slot, gear_val)))
                            })
                            .collect();
                        let combo_talent_spec: Option<&str> =
                            extract_spec_id_from_talent_string(talent_str)
                                .and_then(class_data::spec_id_to_name);
                        lines.extend(super::emit::emit_profileset(
                            &combo_name,
                            &slot_simc,
                            talent_str,
                            combo_talent_spec,
                            &base_actor_spec,
                        ));
                        let mut combo_items: Vec<Value> = Vec::new();
                        if let Some(gc) = gem_combo_opt {
                            let socketed: HashSet<String> = GEAR_SLOTS
                                .iter()
                                .filter(|s| {
                                    equipped_gear.get(**s).is_some_and(|v| simc_has_socket(v))
                                })
                                .map(|s| s.to_string())
                                .collect();
                            combo_items.extend(build_gem_meta(gc, Some(&socketed)));
                        }
                        combo_metadata.insert(combo_name, combo_items);
                    }
                    combo_number += 1;
                }
            }

            // For the first talent + baseline gear, emit enchant-only combos.
            if talent_idx == 0 && has_enchant_axes {
                for enchant_idx in &enchant_combos {
                    // Check if this eg combo actually changes any equipped slot
                    let any_change = GEAR_SLOTS.iter().any(|slot| {
                        equipped_gear
                            .get(*slot)
                            .and_then(|gear_val| apply_enchant_combo(slot, gear_val, enchant_idx))
                            .is_some()
                    });
                    if !any_change {
                        continue; // Skip: no equipped items have empty sockets for this gem
                    }

                    if !count_only {
                        let combo_name = format!("Combo {}", combo_number);
                        // Build slot_simc: equipped gear with enchant + gem applied.
                        let slot_simc: HashMap<String, String> = GEAR_SLOTS
                            .iter()
                            .filter_map(|slot| {
                                equipped_gear.get(*slot).map(|gear_val| {
                                    let modified = apply_enchant_combo(slot, gear_val, enchant_idx);
                                    let val =
                                        gem_simc_equipped(slot, modified.as_deref().unwrap_or(gear_val));
                                    (slot.to_string(), val)
                                })
                            })
                            .collect();
                        let enchant_talent_spec: Option<&str> =
                            extract_spec_id_from_talent_string(talent_str)
                                .and_then(class_data::spec_id_to_name);
                        lines.extend(super::emit::emit_profileset(
                            &combo_name,
                            &slot_simc,
                            talent_str,
                            enchant_talent_spec,
                            &base_actor_spec,
                        ));
                        let mut combo_items: Vec<Value> = build_enchant_meta(enchant_idx);
                        if let Some(gc) = gem_combo_opt {
                            let socketed: HashSet<String> = GEAR_SLOTS
                                .iter()
                                .filter(|s| {
                                    let slot_str = s.to_string();
                                    equipped_gear.get(&slot_str).is_some_and(|v| {
                                        let modified =
                                            apply_enchant_combo(&slot_str, v, enchant_idx);
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
                    }
                    combo_number += 1;
                }
            }

            for (is_equipped_with_new_talent, gear_set) in &gear_iter {
                // For each gear combo, iterate over all enchant/gem combos (including baseline)
                let enchant_iter: &[Vec<usize>] =
                    if *is_equipped_with_new_talent && !has_enchant_axes {
                        // Only baseline enchants with new talent + equipped gear
                        &enchant_all_combos[..1]
                    } else {
                        &enchant_all_combos
                    };

                // Resolve the simc string for `slot` in this gear combo: prefer the
                // gear_set entry, fall back to the equipped item, return None if neither.
                let simc_for_slot = |slot_str: &str| -> Option<&str> {
                    if *is_equipped_with_new_talent || gear_set.is_empty() {
                        equipped_gear.get(slot_str).map(|s| s.as_str())
                    } else {
                        gear_set
                            .get(slot_str)
                            .and_then(|item| item.get("simc_string"))
                            .and_then(|s| s.as_str())
                            .or_else(|| equipped_gear.get(slot_str).map(|s| s.as_str()))
                    }
                };

                for enchant_idx in enchant_iter {
                    let is_enchant_baseline = !has_enchant_axes || *enchant_idx == enchant_baseline;

                    // Skip: first talent + equipped gear + baseline enchants (that's the base actor)
                    if talent_idx == 0 && *is_equipped_with_new_talent && is_enchant_baseline {
                        continue;
                    }

                    // For non-baseline gem combos, check if the gem actually applies to any
                    // item in this gear set. If no item has an empty socket, skip.
                    if !is_enchant_baseline {
                        let any_change = GEAR_SLOTS.iter().any(|slot| {
                            simc_for_slot(slot)
                                .and_then(|s| apply_enchant_combo(slot, s, enchant_idx))
                                .is_some()
                        });
                        if !any_change {
                            continue;
                        }
                    }

                    if count_only {
                        combo_number += 1;
                        continue;
                    }

                    let combo_name = format!("Combo {}", combo_number);

                    // Resolve talent spec for spec= override line.
                    let combo_talent_spec: Option<&str> =
                        extract_spec_id_from_talent_string(talent_str)
                            .and_then(class_data::spec_id_to_name);

                    // Build slot_simc map for simc line emit.
                    let slot_simc: HashMap<String, String> = if *is_equipped_with_new_talent {
                        // Same gear as base actor with enchant/gem overrides.
                        GEAR_SLOTS
                            .iter()
                            .filter_map(|slot| {
                                equipped_gear.get(*slot).map(|gear_val| {
                                    let modified =
                                        apply_enchant_combo(slot, gear_val, enchant_idx);
                                    let val =
                                        gem_simc_equipped(slot, modified.as_deref().unwrap_or(gear_val));
                                    (slot.to_string(), val)
                                })
                            })
                            .collect()
                    } else {
                        // Different gear combination with enchant/gem overrides.
                        // Detect 2H main_hand to force empty off_hand (kept out of
                        // slot_simc so emit_profileset emits the empty fallback).
                        let mut combo_mh_is_two_hand = false;
                        let mut map: HashMap<String, String> = HashMap::new();
                        for slot in GEAR_SLOTS {
                            if let Some(item) = gear_set.get(*slot) {
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
                                    // Force empty off_hand — do NOT add a value so the
                                    // emit fallback fires (same as absent from gear_set).
                                    // But we must still mark it absent for the fallback to
                                    // work. Don't insert — emit_profileset handles it.
                                } else {
                                    let simc_str = item
                                        .get("simc_string")
                                        .and_then(|s| s.as_str())
                                        .unwrap_or("");
                                    let item_sockets = item
                                        .get("sockets")
                                        .and_then(|s| s.as_u64())
                                        .unwrap_or(0) as usize;
                                    let modified =
                                        apply_enchant_combo(slot, simc_str, enchant_idx);
                                    let val = if let Some(gc) = gem_combo_opt {
                                        super::emit::apply_item_gems(
                                            modified.as_deref().unwrap_or(simc_str),
                                            item_sockets,
                                            slot,
                                            gc,
                                            replace_gems,
                                        )
                                    } else {
                                        modified.unwrap_or_else(|| simc_str.to_string())
                                    };
                                    map.insert(slot.to_string(), val);
                                }
                            }
                            // off_hand absent → emit_profileset emits empty fallback line.
                        }
                        map
                    };
                    lines.extend(super::emit::emit_profileset(
                        &combo_name,
                        &slot_simc,
                        talent_str,
                        combo_talent_spec,
                        &base_actor_spec,
                    ));

                    // Build metadata for this combo using the shared builder.
                    let enchant_entries: Vec<Value> = if !is_enchant_baseline {
                        build_enchant_meta(enchant_idx)
                    } else {
                        Vec::new()
                    };
                    let gem_entries: Vec<Value> = if let Some(gc) = gem_combo_opt {
                        // Cache key: (gear_set ptr, enchant_idx). Valid because every
                        // gear_set in gear_iter references either empty_gear_set
                        // (stack-stable within this fn) or a valid_combos entry
                        // (heap-stable for the function's lifetime).
                        let cache_key = (*gear_set as *const _ as usize, enchant_idx.clone());
                        let socketed = socketed_cache.entry(cache_key).or_insert_with(|| {
                            GEAR_SLOTS
                                .iter()
                                .filter(|slot| {
                                    simc_for_slot(slot).is_some_and(|v| {
                                        let modified = apply_enchant_combo(slot, v, enchant_idx);
                                        simc_has_socket(modified.as_deref().unwrap_or(v))
                                    })
                                })
                                .map(|s| s.to_string())
                                .collect()
                        });
                        build_gem_meta(gc, Some(socketed))
                    } else {
                        Vec::new()
                    };

                    // Build the gear-item rows for the metadata.
                    let gear_item_rows: Vec<(String, bool, &Value)> =
                        if *is_equipped_with_new_talent {
                            paired_display_slots
                                .iter()
                                .filter_map(|slot| {
                                    let slot = slot.to_string();
                                    slot_item_lists
                                        .get(&slot)
                                        .and_then(|items| items.first())
                                        .map(|item| (slot, true, item.as_ref()))
                                })
                                .collect()
                        } else {
                            let mut rows: Vec<(String, bool, &Value)> = Vec::new();
                            // Paired display slots first.
                            for slot in &paired_display_slots {
                                let slot = slot.to_string();
                                if let Some(item) = gear_set.get(&slot) {
                                    let is_kept = item
                                        .get("is_equipped")
                                        .and_then(|v| v.as_bool())
                                        .unwrap_or(false);
                                    rows.push((slot, is_kept, item.as_ref()));
                                }
                            }
                            // Non-paired non-equipped items.
                            for slot in GEAR_SLOTS {
                                if paired_display_slots.contains(slot) {
                                    continue;
                                }
                                if let Some(item) = gear_set.get(*slot) {
                                    let is_equipped = item
                                        .get("is_equipped")
                                        .and_then(|v| v.as_bool())
                                        .unwrap_or(true);
                                    if !is_equipped {
                                        rows.push((slot.to_string(), false, item.as_ref()));
                                    }
                                }
                            }
                            rows
                        };

                    let talent_info: Option<(&str, Option<&str>)> = if has_talent_variants {
                        Some((talent_name, combo_talent_spec))
                    } else {
                        None
                    };
                    let include_off_hand_synthetic = !gear_set.contains_key("off_hand");

                    let combo_items = super::emit::build_combo_metadata(
                        &gear_item_rows,
                        &enchant_entries,
                        &gem_entries,
                        talent_info,
                        include_off_hand_synthetic,
                    );

                    combo_metadata.insert(combo_name, combo_items);
                    combo_number += 1;
                }
            }
        }
    } // end gem_iter loop

    let emitted_combo_count = combo_number - 2;
    Ok((lines.join("\n"), emitted_combo_count, combo_metadata))
}
