use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

use super::base_profile::{item_meta, parse_base_profile};
use super::selection::build_slot_candidates;
use super::simc::{
    extract_enchant_id, extract_gem_id, extract_gem_ids, extract_item_id,
    extract_spec_id_from_talent_string, is_diamond, simc_socket_count,
};
use super::{GemEnchantOptions, ProfilesetResult, MAX_COMBINATIONS};
use crate::types::class_data;

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
    let mut slot_item_lists: HashMap<String, Vec<Arc<Value>>> =
        build_slot_candidates(base_profile, items_by_slot, selected_items)
            .into_iter()
            .map(|(k, v)| (k, v.into_iter().map(Arc::new).collect()))
            .collect();

    // Ensure every slot that has an enchant or gem axis is represented in
    // slot_item_lists even when items_by_slot omits it. The iterator builds
    // its slot_simc map from slot_item_lists, so a slot missing from there
    // would silently produce no simc lines even when the enchant/gem axis
    // requests an override. Synthesise a one-entry list from equipped_gear.
    let needs_coverage: Vec<String> = enchant_selections
        .iter()
        .filter(|(_, ids)| !ids.is_empty())
        .map(|(slot, _)| slot.clone())
        .chain(
            crate::types::class_data::GEAR_SLOTS.iter().filter_map(|slot| {
                let slot_str = slot.to_string();
                if equipped_gear.contains_key(&slot_str)
                    && !socketed_item_ids.is_empty()
                {
                    Some(slot_str)
                } else {
                    None
                }
            }),
        )
        .collect();
    for slot in needs_coverage {
        if slot_item_lists.contains_key(&slot) {
            continue;
        }
        if let Some(simc) = equipped_gear.get(&slot) {
            let item_id = extract_item_id(simc);
            let enchant_id = extract_enchant_id(simc);
            let gem_id = extract_gem_id(simc);
            let synthetic = Arc::new(serde_json::json!({
                "slot": slot,
                "simc_string": simc,
                "is_equipped": true,
                "origin": "equipped",
                "item_id": item_id,
                "ilevel": 0,
                "name": "",
                "bonus_ids": [],
                "enchant_id": enchant_id,
                "gem_id": gem_id,
                "sockets": simc_socket_count(simc),
            }));
            slot_item_lists.insert(slot, vec![synthetic]);
        }
    }

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
    )
}

/// Count-only variant: builds the iterator config and returns the exact
/// emitted profileset count. Uses the same analytic limit gate as the full
/// generator so the two always agree on whether a request is over-limit.
pub fn count_top_gear_combos_with_talents(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
    max_combos_override: Option<usize>,
    talent_builds: &[(String, String)],
    catalyst_charges: Option<u32>,
    gem_opts: &GemEnchantOptions,
) -> Result<usize, String> {
    let limit = max_combos_override
        .unwrap_or(MAX_COMBINATIONS.load(std::sync::atomic::Ordering::Relaxed));

    // Fast upper-bound gate: O(axes), no enumeration.
    if limit > 0 {
        let est = super::estimate_top_gear_combo_count(
            items_by_slot,
            selected_items,
            gem_opts.enchants(),
            gem_opts.gem_options,
            gem_opts.sockets(),
            talent_builds.len().max(1),
        );
        if est > limit as u64 {
            return Err(format!(
                "Too many combinations ({est}). Maximum is {limit}. Please deselect some items."
            ));
        }
    }

    let cfg = build_iterator_config(
        base_profile,
        items_by_slot,
        selected_items,
        talent_builds,
        gem_opts,
        catalyst_charges,
    );
    let n_axes =
        cfg.varying_slots.len() + cfg.enchant_axes.len() + 1 /* gem */ + 1 /* talent */;
    let base_actor_cursor = vec![0usize; n_axes];
    let count = super::iterator::ProfilesetIterator::new(cfg)
        .filter(|cand| {
            !(!talent_builds.is_empty() && cand.cursor_at_emission == base_actor_cursor)
        })
        .count();
    Ok(count)
}

/// Generate top-gear profileset input, optionally multiplying by talent builds
/// and enchant/gem variations. Delegates all combo enumeration to
/// [`ProfilesetIterator`] so there is exactly one enumeration path.
#[allow(clippy::too_many_arguments)]
pub fn generate_top_gear_input_with_talents(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
    max_combos_override: Option<usize>,
    talent_builds: &[(String, String)],
    catalyst_charges: Option<u32>,
    gem_opts: &GemEnchantOptions,
) -> ProfilesetResult {
    let limit = max_combos_override
        .unwrap_or(MAX_COMBINATIONS.load(std::sync::atomic::Ordering::Relaxed));

    // Fast upper-bound gate: O(axes), no enumeration.
    if limit > 0 {
        let est = super::estimate_top_gear_combo_count(
            items_by_slot,
            selected_items,
            gem_opts.enchants(),
            gem_opts.gem_options,
            gem_opts.sockets(),
            talent_builds.len().max(1),
        );
        if est > limit as u64 {
            return Err(format!(
                "Too many combinations ({est}). Maximum is {limit}. Please deselect some items."
            ));
        }
    }

    // Parse base profile: non-gear lines, equipped gear, talent string, spec.
    let (base_lines, equipped_gear, talents_string, spec) = parse_base_profile(base_profile);

    // Resolve talent builds.
    let effective_talents: Vec<(String, String)> = if talent_builds.is_empty() {
        vec![("".to_string(), talents_string.clone())]
    } else {
        talent_builds
            .iter()
            .map(|(name, ts)| (name.clone(), ts.clone()))
            .collect()
    };
    let has_talent_variants = effective_talents.len() > 1;

    let enchant_selections = gem_opts.enchants();
    let has_enchant_axes_input =
        enchant_selections.values().any(|v| !v.is_empty()) || !gem_opts.gem_options.is_empty();

    // Build slot_item_lists to check for varying slots (needed for early-exit).
    let slot_item_lists_raw =
        build_slot_candidates(base_profile, items_by_slot, selected_items);
    let has_varying_slots = slot_item_lists_raw.values().any(|items| items.len() > 1);

    if !has_varying_slots && !has_talent_variants && !has_enchant_axes_input {
        return Ok((base_profile.to_string(), 0, HashMap::new()));
    }

    let base_talent = &effective_talents[0].1;
    // Determine the base actor's effective spec (might differ from original if
    // first talent build is another spec).
    let base_actor_spec: String = if !base_talent.is_empty() {
        extract_spec_id_from_talent_string(base_talent)
            .and_then(class_data::spec_id_to_name)
            .map(|s| s.to_string())
            .unwrap_or_else(|| spec.clone())
    } else {
        spec.clone()
    };

    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: HashMap<String, Vec<Value>> = HashMap::new();
    let paired_display_slots = ["finger1", "finger2", "trinket1", "trinket2"];

    // ── 1. Base actor block ──────────────────────────────────────────────────
    lines.extend(super::emit::emit_base_actor(
        &base_lines,
        &equipped_gear,
        base_talent,
        &base_actor_spec,
        &spec,
    ));

    // ── 2. "Currently Equipped" baseline metadata ────────────────────────────
    {
        // Rebuild slot_item_lists as Arc for item_meta access.
        let slot_item_lists: HashMap<String, Vec<std::sync::Arc<Value>>> = slot_item_lists_raw
            .into_iter()
            .map(|(k, v)| (k, v.into_iter().map(std::sync::Arc::new).collect()))
            .collect();

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

    // ── 3. Delegate profileset enumeration to the iterator ───────────────────
    //
    // The iterator starts naming from `Combo 1`; we offset to `Combo 2` because
    // the base actor is `Combo 1` in the eager output format.
    let cfg = build_iterator_config(
        base_profile,
        items_by_slot,
        selected_items,
        talent_builds,
        gem_opts,
        catalyst_charges,
    );
    let n_axes = cfg.varying_slots.len() + cfg.enchant_axes.len() + 1 /* gem */ + 1 /* talent */;
    let base_actor_cursor: Vec<usize> = vec![0usize; n_axes];
    let mut iter = super::iterator::ProfilesetIterator::new(cfg);
    iter.set_next_name_idx(2);

    let mut count = 0usize;
    for cand in iter {
        // When talent_builds is non-empty the iterator does not skip
        // (baseline gear + first talent), because `talent_string` is
        // non-empty and the iterator's skip condition requires it to be
        // empty. But the base actor block already covers that combination
        // (it is written as "### Combo 1" in the output). Skip it here so
        // we don't emit a duplicate profileset.
        if !talent_builds.is_empty()
            && cand.cursor_at_emission == base_actor_cursor
        {
            // This candidate is the base actor equivalent; keep the name
            // counter in sync by NOT incrementing (the name was NOT used).
            continue;
        }
        lines.push(cand.profileset_simc);
        let meta: Vec<Value> = serde_json::from_value(cand.metadata)
            .map_err(|e| format!("metadata deserialize error: {e}"))?;
        combo_metadata.insert(cand.profileset_name, meta);
        count += 1;
    }

    if count == 0 && !has_talent_variants && !has_enchant_axes_input {
        return Ok((base_profile.to_string(), 0, HashMap::new()));
    }

    Ok((lines.join("\n"), count, combo_metadata))
}
