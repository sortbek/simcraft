use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use super::base_profile::{item_meta, parse_base_profile};

use super::constraints::{
    gear_set_identity_key, is_legal_gear_set, main_hand_is_two_hand, GearSetContext,
};
use super::selection::build_slot_candidates;
use super::simc::{
    combinations, extract_enchant_id, extract_gem_id, extract_gem_ids, extract_item_id,
    extract_spec_id_from_talent_string, gem_color, is_diamond, set_enchant_id, set_gem_ids,
    simc_has_socket, simc_socket_count,
};
use super::{GemEnchantOptions, ProfilesetResult, MAX_COMBINATIONS};
use crate::game_data;
use crate::types::class_data::{self, GEAR_SLOTS};

struct EnchantAxis {
    slot: String,
    options: Vec<u64>,
}

/// One gem-combo entry: per slot, the list of gem ids (length = socket count
/// for that slot). Order inside the Vec doesn't matter for dedup — `gem_id=A/B`
/// and `gem_id=B/A` are equivalent in SimC and we collapse them. Used by the
/// eager `generate_top_gear_input_with_talents`; the streaming iterator path
/// in `build_iterator_config` below still uses single-gem-per-slot until the
/// iterator gains multi-socket support.
type GemCombo = HashMap<String, Vec<u64>>;

/// All k-element multisets (combinations with repetition) of `items`.
/// e.g. `multisets(&[A,B,C], 2)` -> AA, AB, AC, BB, BC, CC.
fn multisets<T: Clone>(items: &[T], k: usize) -> Vec<Vec<T>> {
    if k == 0 {
        return vec![vec![]];
    }
    if items.is_empty() {
        return vec![];
    }
    let mut result = Vec::new();
    for (i, item) in items.iter().enumerate() {
        // Repetition allowed → restart slice at `i` (not `i+1`) so the same
        // item can be picked again, while the index-based recursion still
        // pins the *order* and prevents emitting both `A,B` and `B,A`.
        for mut sub in multisets(&items[i..], k - 1) {
            sub.insert(0, item.clone());
            result.push(sub);
        }
    }
    result
}

fn dedupe_gem_assignments(combos: Vec<GemCombo>, max_diamonds: usize) -> Vec<GemCombo> {
    let mut seen: HashSet<Vec<u64>> = HashSet::new();
    let mut result = Vec::new();

    for combo in combos {
        let diamond_count = combo
            .values()
            .flat_map(|gids| gids.iter())
            .filter(|&&gid| is_diamond(gid))
            .count();
        if diamond_count > max_diamonds {
            continue;
        }

        // Gems are character-wide stats — placing a diamond in head vs neck
        // (or A,B vs B,A in a 2-socket item) yields identical DPS. Dedup on
        // the flat sorted gem list across all slots so we don't waste sim
        // budget on permutation duplicates.
        let mut key: Vec<u64> = combo
            .values()
            .flat_map(|gids| gids.iter().copied())
            .collect();
        key.sort();
        if seen.insert(key) {
            result.push(combo);
        }
    }

    result
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

    // Build cartesian product across varying slots
    let option_lists: Vec<&Vec<Arc<Value>>> = varying_slots
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
    let mut valid_combos: Vec<HashMap<String, Arc<Value>>> = Vec::new();
    let mut seen_combo_keys: HashSet<String> = HashSet::new();

    for combo_indices in &all_combos {
        // Build full gear set: start with equipped, override varying slots
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
    let gem_combos: Vec<GemCombo> = if !gem_options.is_empty() {
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

        // Helper: generate colored gem combos for a set of (slot, socket_count)
        // entries. In max_colors mode each *slot* picks a single color shared
        // across all of its sockets, and distinct slots pick distinct colors.
        // Within a slot, the K sockets become a K-multiset of that slot's color.
        let gen_color_combos =
            |slots: &[(String, usize)], gems: &[u64], max_colors: bool| -> Vec<GemCombo> {
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

                    // Precompute per-(color, socket_count) multisets so we don't
                    // regenerate the same list inside the slot loop below.
                    let mut multisets_cache: HashMap<(String, usize), Vec<Vec<u64>>> =
                        HashMap::new();
                    for (color, gems_for_color) in &by_color {
                        for (_, socket_count) in slots {
                            multisets_cache
                                .entry((color.clone(), *socket_count))
                                .or_insert_with(|| multisets(gems_for_color, *socket_count));
                        }
                    }

                    let mut result: Vec<GemCombo> = Vec::new();
                    for color_set in combinations(&colors, n_colors) {
                        let mut current: Vec<GemCombo> = vec![HashMap::new()];
                        for (slot_idx, (slot, socket_count)) in slots.iter().enumerate() {
                            let color = &color_set[slot_idx % color_set.len()];
                            let slot_multisets = &multisets_cache[&(color.clone(), *socket_count)];
                            let mut next = Vec::new();
                            for combo in &current {
                                for ms in slot_multisets {
                                    let mut c = combo.clone();
                                    c.insert(slot.clone(), ms.clone());
                                    next.push(c);
                                }
                            }
                            current = next;
                        }
                        result.extend(current);
                    }
                    dedupe_gem_assignments(result, 0)
                } else {
                    let mut result: Vec<GemCombo> = vec![HashMap::new()];
                    for (slot, socket_count) in slots {
                        let slot_multisets = multisets(gems, *socket_count);
                        let mut next = Vec::new();
                        for combo in &result {
                            for ms in &slot_multisets {
                                let mut c = combo.clone();
                                c.insert(slot.clone(), ms.clone());
                                next.push(c);
                            }
                        }
                        result = next;
                    }
                    dedupe_gem_assignments(result, 0)
                }
            };

        let build_diamond_placements = |gem_slots: &[(String, usize)],
                                        gems: &[u64],
                                        diamond_ids: &[u64],
                                        max_colors: bool|
         -> Vec<GemCombo> {
            let mut result: Vec<GemCombo> = Vec::new();
            for (d_slot_idx, (d_slot, d_socket_count)) in gem_slots.iter().enumerate() {
                let remaining: Vec<(String, usize)> = gem_slots
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != d_slot_idx)
                    .map(|(_, sw)| sw.clone())
                    .collect();
                let other_combos = gen_color_combos(&remaining, gems, max_colors);

                let other_socket_count = d_socket_count.saturating_sub(1);
                let same_slot_fillers: Vec<Vec<u64>> = if other_socket_count == 0 || gems.is_empty()
                {
                    vec![vec![]]
                } else {
                    multisets(gems, other_socket_count)
                };

                for &did in diamond_ids {
                    for base in &other_combos {
                        for filler in &same_slot_fillers {
                            let mut combo = base.clone();
                            let mut slot_gems = vec![did];
                            slot_gems.extend(filler.iter().copied());
                            combo.insert(d_slot.clone(), slot_gems);
                            result.push(combo);
                        }
                    }
                }
            }
            result
        };

        if gems.is_empty() && diamond_ids.is_empty() {
            Vec::new()
        } else if !diamond_ids.is_empty() && diamond_always_use {
            let placements = build_diamond_placements(&gem_slots, &gems, &diamond_ids, max_colors);
            dedupe_gem_assignments(placements, 1)
        } else if !diamond_ids.is_empty() {
            let mut result = if gems.is_empty() {
                Vec::new()
            } else {
                gen_color_combos(&gem_slots, &gems, max_colors)
            };
            result.extend(build_diamond_placements(
                &gem_slots,
                &gems,
                &diamond_ids,
                max_colors,
            ));
            dedupe_gem_assignments(result, 1)
        } else {
            gen_color_combos(&gem_slots, &gems, max_colors)
        }
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

    let limit =
        max_combos_override.unwrap_or(MAX_COMBINATIONS.load(std::sync::atomic::Ordering::Relaxed));
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
        lines.push("# Base Actor".to_string());
        lines.extend(base_lines.clone());
        lines.push("### Combo 1".to_string());
        for slot in GEAR_SLOTS {
            if let Some(gear_val) = equipped_gear.get(*slot) {
                lines.push(format!("{}={}", slot, gear_val));
            } else if *slot == "off_hand" {
                lines.push("off_hand=,".to_string());
            }
        }
        if !base_talent.is_empty() {
            lines.push(format!("talents={}", base_talent));
            if base_actor_spec != spec {
                lines.push(format!("spec={}", base_actor_spec));
            }
        }
        lines.push(String::new());
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

    // Helper: apply a gem combo assignment to a simc string for a slot.
    // Only writes gems when the socket is empty, or when replace_gems is on.
    // Truncates the gem list to the item's actual socket count so a 2-gem
    // combo applied to a 1-socket alternative emits a valid single-id line.
    let apply_gem = |slot: &str, simc: &str, gem_combo: &GemCombo| -> String {
        let socket_count = simc_socket_count(simc);
        if socket_count == 0 {
            return simc.to_string();
        }
        let already_gemmed = extract_gem_id(simc) > 0;
        if !replace_gems && already_gemmed {
            return simc.to_string();
        }
        match gem_combo.get(slot) {
            Some(gids) => {
                let take = gids.len().min(socket_count);
                set_gem_ids(simc, &gids[..take])
            }
            None => simc.to_string(),
        }
    };

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
                        .map(|gear_val| gem_simc(slot, gear_val) != *gear_val)
                        .unwrap_or(false)
                });
                if any_gem_change {
                    if !count_only {
                        let combo_name = format!("Combo {}", combo_number);
                        lines.push(format!("### {}", combo_name));
                        for slot in GEAR_SLOTS {
                            if let Some(gear_val) = equipped_gear.get(*slot) {
                                let val = gem_simc(slot, gear_val);
                                lines.push(format!(
                                    "profileset.\"{}\"+={}={}",
                                    combo_name, slot, val
                                ));
                            } else if *slot == "off_hand" {
                                lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
                            }
                        }
                        lines.push(String::new());
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
                        lines.push(format!("### {}", combo_name));

                        for slot in GEAR_SLOTS {
                            if let Some(gear_val) = equipped_gear.get(*slot) {
                                let modified = apply_enchant_combo(slot, gear_val, enchant_idx);
                                let val = gem_simc(slot, modified.as_deref().unwrap_or(gear_val));
                                lines.push(format!(
                                    "profileset.\"{}\"+={}={}",
                                    combo_name, slot, val
                                ));
                            } else if *slot == "off_hand" {
                                lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
                            }
                        }
                        lines.push(String::new());

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
                    lines.push(format!("### {}", combo_name));

                    if *is_equipped_with_new_talent {
                        // Same gear as base actor (possibly with enchant/gem overrides)
                        for slot in GEAR_SLOTS {
                            if let Some(gear_val) = equipped_gear.get(*slot) {
                                let modified = apply_enchant_combo(slot, gear_val, enchant_idx);
                                let val = gem_simc(slot, modified.as_deref().unwrap_or(gear_val));
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
                                    lines
                                        .push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
                                } else {
                                    let simc_str = item
                                        .get("simc_string")
                                        .and_then(|s| s.as_str())
                                        .unwrap_or("");
                                    let modified = apply_enchant_combo(slot, simc_str, enchant_idx);
                                    let val =
                                        gem_simc(slot, modified.as_deref().unwrap_or(simc_str));
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
                            if let Some(item) = gear_set.get(*slot) {
                                let is_equipped = item
                                    .get("is_equipped")
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(true);
                                if !is_equipped {
                                    combo_items.push(item_meta(item, slot));
                                }
                            }
                        }
                    }

                    // Add enchant/gem change metadata
                    if !is_enchant_baseline {
                        combo_items.extend(build_enchant_meta(enchant_idx));
                    }
                    if let Some(gc) = gem_combo_opt {
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
                        combo_items.extend(build_gem_meta(gc, Some(socketed)));
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

    let emitted_combo_count = combo_number - 2;
    Ok((lines.join("\n"), emitted_combo_count, combo_metadata))
}
