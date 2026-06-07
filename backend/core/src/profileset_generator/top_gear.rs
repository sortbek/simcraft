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
use crate::types::class_data::{self};

/// Build a [`ProfilesetIteratorConfig`] for both the streaming/triage path and
/// the eager Top Gear generator (single pipeline).
///
/// When `items_by_slot` lacks an entry for a slot that appears in the equipped
/// gear parsed from `base_profile`, a minimal synthetic item is injected for
/// that slot so gem/enchant deltas can be applied to the equipped item. This
/// mirrors production behaviour (where `items_by_slot` always carries the
/// equipped item) and lets gem-only / enchant-only scenarios work when tests
/// pass an empty `items_by_slot` with a `base_profile` carrying the equipped
/// item directly.
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

    // Build slot_item_lists from the provided items_by_slot (same as before).
    let mut slot_item_lists: HashMap<String, Vec<Arc<Value>>> =
        build_slot_candidates(base_profile, items_by_slot, selected_items)
            .into_iter()
            .map(|(k, v)| (k, v.into_iter().map(Arc::new).collect()))
            .collect();

    // Inject equipped slots that are missing from slot_item_lists. This happens
    // in gem/enchant-only scenarios where the caller passes an empty
    // `items_by_slot` and relies on the base_profile's gear lines for the
    // equipped items. Without this injection the iterator has no slot to apply
    // gem/enchant deltas to and would emit nothing.
    for (slot, simc_str) in &equipped_gear {
        if slot_item_lists.contains_key(slot) {
            continue; // already populated — do not duplicate
        }
        // Build a minimal synthetic item Value from the simc string. The
        // iterator only needs: `simc_string`, `is_equipped`, `item_id`,
        // `sockets` (for gem apply), `enchant_id`, `gem_id`, and `origin`.
        let item_id = extract_item_id(simc_str);
        let enchant_id = extract_enchant_id(simc_str);
        let gem_id = extract_gem_id(simc_str);
        // Use the game-data socket count when items_by_slot provides it for
        // this slot, otherwise derive from the simc string (bonus-id +
        // existing gem count). This mirrors the eager path's fallback logic.
        let sockets = items_by_slot
            .get(slot)
            .and_then(|items| {
                items.iter().find(|it| {
                    it.get("is_equipped")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                })
            })
            .and_then(|it| it.get("sockets").and_then(|s| s.as_u64()))
            .map(|n| n as usize)
            .unwrap_or_else(|| simc_socket_count(simc_str));
        let synthetic = Arc::new(json!({
            "slot": slot,
            "simc_string": simc_str,
            "is_equipped": true,
            "item_id": item_id,
            "sockets": sockets as u64,
            "enchant_id": enchant_id,
            "gem_id": gem_id,
            "ilevel": 0,
            "name": "",
            "bonus_ids": [],
            "origin": "equipped",
        }));
        slot_item_lists.insert(slot.clone(), vec![synthetic]);
    }

    // Find varying slots (> 1 item), sorted for determinism
    let mut varying_slots: Vec<String> = slot_item_lists
        .iter()
        .filter(|(_, items)| items.len() > 1)
        .map(|(slot, _)| slot.clone())
        .collect();
    varying_slots.sort();

    // Build enchant axes (same logic as the original eager path)
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

    // Build (slot, socket_count) tuples — same logic as the original eager path.
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

    let socketed_ids_owned: std::collections::HashSet<u64> =
        socketed_item_ids.iter().copied().collect();
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

/// Count-only variant: builds the iterator config and counts the candidates.
/// Uses the O(axes) analytic upper-bound only for the limit gate, then walks
/// the full iterator for the exact count. This is a fast-path compared to
/// running the full emit pipeline.
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

    // Gate on the analytic upper bound before paying for iterator construction.
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
    Ok(super::iterator::ProfilesetIterator::new(cfg).count_emitted())
}

/// Generate top-gear profileset input, multiplied by talent builds and
/// enchant/gem variations. Delegates enumeration entirely to
/// [`ProfilesetIterator`] (single pipeline).
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

    // Gate on the analytic upper bound before paying for iterator construction.
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

    // Parse base profile for base-actor emit and baseline metadata.
    let (base_lines, equipped_gear, talents_string, spec) = parse_base_profile(base_profile);

    let effective_talents: Vec<(String, String)> = if talent_builds.is_empty() {
        vec![("".to_string(), talents_string.clone())]
    } else {
        talent_builds.to_vec()
    };
    let has_talent_variants = effective_talents.len() > 1;

    let base_talent = &effective_talents[0].1;
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

    // Emit the "# Base Actor" / "### Combo 1" block.
    lines.extend(super::emit::emit_base_actor(
        &base_lines,
        &equipped_gear,
        base_talent,
        &base_actor_spec,
        &spec,
    ));

    // Build slot_item_lists for paired display slots (finger/trinket baseline
    // metadata). Use build_slot_candidates so the same equipped-item resolution
    // as the iterator sees applies here too.
    let slot_item_lists_raw = build_slot_candidates(base_profile, items_by_slot, selected_items);

    // Baseline metadata for "Currently Equipped" / "Currently Equipped ({talent})"
    let paired_display_slots = ["finger1", "finger2", "trinket1", "trinket2"];
    {
        let mut baseline_items: Vec<Value> = Vec::new();
        for slot in &paired_display_slots {
            let slot = slot.to_string();
            if let Some(items) = slot_item_lists_raw.get(&slot) {
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

    // Build the iterator starting at Combo 2 (Combo 1 is the base actor above).
    let cfg = build_iterator_config(
        base_profile,
        items_by_slot,
        selected_items,
        talent_builds,
        gem_opts,
        catalyst_charges,
    );

    // Check if the iterator would emit nothing (same early-exit as before).
    // Construct fresh to peek — the cfg is Clone.
    {
        let peek_iter = super::iterator::ProfilesetIterator::new(cfg.clone());
        if peek_iter.count() == 0
            && !has_talent_variants
            && gem_opts.gem_options.is_empty()
            && gem_opts.enchants().values().all(|v| v.is_empty())
        {
            return Ok((base_profile.to_string(), 0, HashMap::new()));
        }
    }

    let mut iter = super::iterator::ProfilesetIterator::new(cfg);
    iter.set_next_name_idx(2);

    let mut count = 0usize;
    for cand in iter {
        lines.push(cand.profileset_simc);
        let meta: Vec<Value> = serde_json::from_value(cand.metadata)
            .unwrap_or_default();
        combo_metadata.insert(cand.profileset_name, meta);
        count += 1;
    }

    Ok((lines.join("\n"), count, combo_metadata))
}
