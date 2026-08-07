//! Game data facade — re-exports item_db lookups and contains drop-resolver logic.

use serde_json::Value;
use std::collections::HashMap;

use crate::item_db;
use crate::types::class_data;

// ---- Re-exports from item_db ----

pub use crate::item_db::{
    apply_copy_enchants, catalyst_currency_id, catalyst_tier_item, get_currency_info,
    get_enchant_info, get_gem_info, get_inventory_type, get_item_armor_subclass, get_item_info,
    get_item_limit_categories, get_upgrade_cost_between, get_upgrade_options, get_upgrade_tracks,
    is_catalyst_tier_item, item_limit_categories_for, list_augments, list_enchants_for_slot,
    list_flasks, list_foods, list_gems, list_potions, list_temp_enchants, load, talent_tree,
    upgrade_bonus_ids_to_max, upgrade_items_by_slot, upgrade_simc_input, CatalystTierItem,
};
pub use crate::types::class_data::{quality_name, QUALITY_NAMES};

pub fn get_instances() -> &'static Vec<Value> {
    item_db::instances()
}

// ---- Drop Resolver ----

pub fn get_instance_drops(
    instance_id: i64,
    class_name: Option<&str>,
    spec_name: Option<&str>,
) -> Option<serde_json::Map<String, Value>> {
    let instances = item_db::instances();
    let instance = instances
        .iter()
        .find(|i| i.get("id").and_then(|id| id.as_i64()) == Some(instance_id))?;

    let max_armor = class_name.and_then(class_data::class_max_armor);
    let allowed_weapons = class_name.and_then(class_data::class_allowed_weapons);
    let active_spec_names: Vec<&str> = spec_name
        .map(|s| s.split(',').map(|s| s.trim()).collect())
        .unwrap_or_default();
    let allowed_specs: Vec<u64> = match (class_name, spec_name) {
        (Some(c), Some(specs)) => specs
            .split(',')
            .flat_map(|s| class_data::class_spec_ids(c, Some(s.trim())))
            .collect(),
        (Some(c), None) => class_data::class_spec_ids(c, None),
        _ => Vec::new(),
    };

    let instance_name = instance
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();
    let is_meta = instance_id < 0;

    let encounters = instance.get("encounters")?.as_array()?;
    let encounter_ids: HashMap<i64, String> = encounters
        .iter()
        .filter_map(|e| {
            let id = e.get("id")?.as_i64()?;
            let name = e.get("name")?.as_str()?.to_string();
            Some((id, name))
        })
        .collect();

    // For meta-instances (pools), the encounter IDs are actually instance IDs.
    // Map each encounter ID to the instance name by direct ID lookup.
    let encounter_to_instance: HashMap<i64, String> = if is_meta {
        let mut map = HashMap::new();
        for inst in instances {
            let iid = inst.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            if iid <= 0 {
                continue;
            }
            if encounter_ids.contains_key(&iid) {
                let iname = inst
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                map.insert(iid, iname);
            }
        }
        map
    } else {
        HashMap::new()
    };

    let drops_map = item_db::drops_by_encounter();
    let armor_slot_types = class_data::ARMOR_INVENTORY_TYPES;
    let mut by_slot: HashMap<&str, Vec<Value>> = HashMap::new();
    let mut seen: std::collections::HashSet<u64> = std::collections::HashSet::new();

    for eid in encounter_ids.keys() {
        if let Some(items_list) = drops_map.get(eid) {
            for item in items_list {
                // For meta-instances, only include items sourced from this specific instance
                if is_meta {
                    let source_iid = item
                        .get("_source_instance_id")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    if source_iid != instance_id {
                        continue;
                    }
                }

                let item_id = item.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                if !seen.insert(item_id) {
                    continue;
                }

                let inv_type = item
                    .get("inventoryType")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);

                // Filter by armor type
                if let Some(max) = max_armor {
                    if armor_slot_types.contains(&inv_type)
                        && item.get("itemClass").and_then(|c| c.as_u64()) == Some(4)
                    {
                        let sub = item
                            .get("itemSubClass")
                            .and_then(|s| s.as_u64())
                            .unwrap_or(0);
                        if sub != 0 && sub != max {
                            continue;
                        }
                    }
                }

                // Filter by weapon/shield/off-hand eligibility per active spec
                let item_class = item.get("itemClass").and_then(|c| c.as_u64()).unwrap_or(0);
                let weapon_sub = item
                    .get("itemSubClass")
                    .and_then(|s| s.as_u64())
                    .unwrap_or(0);

                if item_class == 2 || inv_type == 14 || inv_type == 23 {
                    // Weapon, shield, or held off-hand — check spec profiles
                    if let Some(cn) = class_name {
                        if !active_spec_names.is_empty() {
                            let any_spec_can_use = active_spec_names.iter().any(|spec| {
                                if let Some(profile) = class_data::spec_weapon_profile(cn, spec) {
                                    if item_class == 2 {
                                        profile.weapon_subclasses.contains(&weapon_sub)
                                    } else if inv_type == 14 {
                                        profile.can_use_shield
                                    } else {
                                        profile.can_use_offhand
                                    }
                                } else {
                                    // Unknown spec — fall back to class-level check
                                    if let Some(weapons) = allowed_weapons {
                                        item_class != 2 || weapons.contains(&weapon_sub)
                                    } else {
                                        true
                                    }
                                }
                            });
                            if !any_spec_can_use {
                                continue;
                            }
                        } else if let Some(weapons) = allowed_weapons {
                            // No spec info — fall back to class-level weapon check
                            if item_class == 2 && !weapons.contains(&weapon_sub) {
                                continue;
                            }
                        }
                    }
                }

                // Filter by primary stat — rejects items whose fixed primary
                // stat (e.g. Strength) cannot serve any active spec. Items
                // without primary-stat entries (most cosmetics, some
                // effect-only trinkets) are passed through.
                if let (Some(cn), Some(item_stats)) =
                    (class_name, class_data::item_primary_stats(item))
                {
                    if !active_spec_names.is_empty() {
                        let any_spec_stat_match = active_spec_names.iter().any(|spec| {
                            class_data::spec_weapon_profile(cn, spec)
                                .map(|p| item_stats.contains(&p.primary_stat))
                                .unwrap_or(true)
                        });
                        if !any_spec_stat_match {
                            continue;
                        }
                    }
                }

                // Filter spec restrictions (items with explicit spec lists)
                if let Some(specs) = item.get("specs").and_then(|s| s.as_array()) {
                    if !allowed_specs.is_empty() {
                        let item_specs: Vec<u64> =
                            specs.iter().filter_map(|v| v.as_u64()).collect();
                        if !allowed_specs.iter().any(|s| item_specs.contains(s)) {
                            continue;
                        }
                    }
                }

                let slot = class_data::inventory_type_display_slot(inv_type);

                // Compute per-difficulty info. Special raids (e.g. Sporefall) carry
                // FIXED per-difficulty item levels with no upgrade track; normal raids
                // derive theirs from the upgrade tracks at the encounter's level.
                let upgrade_lvl = item_db::encounter_upgrade_level(*eid);
                let fixed_diff = item_db::encounter_fixed_difficulty(*eid);
                let track_map = item_db::upgrade_tracks();
                let tm = item_db::upgrade_track_max();
                let mut diff_info = serde_json::Map::new();
                if let Some(fixed) = fixed_diff.and_then(|v| v.as_object()) {
                    // Fixed-ilvl raid (e.g. Sporefused gear): copy each difficulty's
                    // {ilvl, bonus_id} verbatim. No "track" field → the upgrade slider
                    // is a no-op (resolve_upgrade returns these exactly as dropped).
                    for (diff, entry) in fixed {
                        let ilvl = entry.get("ilvl").and_then(|v| v.as_u64()).unwrap_or(0);
                        let bonus_id = entry.get("bonus_id").and_then(|v| v.as_u64()).unwrap_or(0);
                        let quality = entry.get("quality").and_then(|v| v.as_u64()).unwrap_or(4);
                        diff_info.insert(
                            diff.clone(),
                            serde_json::json!({
                                "ilvl": ilvl, "bonus_id": bonus_id, "quality": quality,
                            }),
                        );
                    }
                } else if let (Some(lvl), Some(tracks)) = (upgrade_lvl, track_map) {
                    for diff in &["lfr", "normal", "heroic", "mythic"] {
                        if let Some(track) = item_db::difficulty_track_name(diff) {
                            if let Some(&(ilvl, bonus_id, quality)) =
                                tracks.get(&(track.clone(), lvl, tm))
                            {
                                diff_info.insert(
                                    diff.to_string(),
                                    serde_json::json!({
                                        "ilvl": ilvl, "bonus_id": bonus_id, "quality": quality,
                                        "track": track, "level": lvl, "max_level": tm,
                                    }),
                                );
                            }
                        }
                    }
                }

                // Compute per-difficulty info for dungeons/M+
                let mut dungeon_info = serde_json::Map::new();
                if upgrade_lvl.is_none() && fixed_diff.is_none() {
                    dungeon_info.insert("normal".to_string(), serde_json::json!({
                        "ilvl": item_db::dungeon_normal_ilvl(), "bonus_id": 0, "quality": item_db::dungeon_normal_quality(),
                    }));
                    if let Some(tracks) = track_map {
                        if let Some(ddt) = item_db::season_cfg()
                            .get("dungeonDifficultyTracks")
                            .and_then(|v| v.as_object())
                        {
                            for (diff_key, entry) in ddt {
                                let track =
                                    entry.get("track").and_then(|v| v.as_str()).unwrap_or("");
                                let level =
                                    entry.get("level").and_then(|v| v.as_u64()).unwrap_or(0);
                                if let Some(&(ilvl, bonus_id, quality)) =
                                    tracks.get(&(track.to_string(), level, tm))
                                {
                                    dungeon_info.insert(
                                        diff_key.clone(),
                                        serde_json::json!({
                                            "ilvl": ilvl, "bonus_id": bonus_id, "quality": quality,
                                            "track": track, "level": level, "max_level": tm,
                                        }),
                                    );
                                } else if let Some(fixed_ilvl) =
                                    entry.get("fixedIlvl").and_then(|v| v.as_u64())
                                {
                                    let fixed_quality = entry
                                        .get("fixedQuality")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(3);
                                    dungeon_info.insert(
                                        diff_key.clone(),
                                        serde_json::json!({
                                            "ilvl": fixed_ilvl, "bonus_id": 0, "quality": fixed_quality,
                                        }),
                                    );
                                }
                            }
                        }
                    }
                }

                // Include item's spec restriction list (if any) for frontend off-spec indicators
                let item_specs: Vec<u64> = item
                    .get("specs")
                    .and_then(|s| s.as_array())
                    .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
                    .unwrap_or_default();

                let item_instance = if is_meta {
                    encounter_to_instance.get(eid).cloned().unwrap_or_default()
                } else {
                    instance_name.clone()
                };

                let mut item_json = serde_json::json!({
                    "item_id": item_id,
                    "name": item.get("name").and_then(|n| n.as_str()).unwrap_or(""),
                    "icon": item.get("icon").and_then(|i| i.as_str()).unwrap_or("inv_misc_questionmark"),
                    "quality": item.get("quality").and_then(|q| q.as_u64()).unwrap_or(1),
                    "ilevel": item.get("itemLevel").and_then(|i| i.as_u64()).unwrap_or(0),
                    "inventory_type": inv_type,
                    "encounter": encounter_ids.get(eid).cloned().unwrap_or_default(),
                    "encounter_id": *eid,
                    "instance_name": item_instance,
                });
                if !item_specs.is_empty() {
                    item_json["specs"] = serde_json::json!(item_specs);
                }

                // Check for embellishment (item_limit_category 512)
                let bonus_lists: Vec<u64> = item
                    .get("bonusLists")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
                    .unwrap_or_default();
                let limit_cats = item_db::item_limit_categories_for(item_id, &bonus_lists);
                if limit_cats.contains_key(&512) {
                    item_json["embellished"] = serde_json::json!(true);
                }

                // Compute off-spec flag: can the main spec use this item?
                if let (Some(cn), Some(main_spec)) =
                    (class_name, active_spec_names.first().copied())
                {
                    let main_spec_ids = class_data::class_spec_ids(cn, Some(main_spec));
                    let mut main_can_use = true;

                    // Check spec restrictions (if item has a specs list)
                    if !item_specs.is_empty()
                        && !main_spec_ids.iter().any(|id| item_specs.contains(id))
                    {
                        main_can_use = false;
                    }

                    // Check weapon/shield/offhand eligibility
                    if main_can_use && (item_class == 2 || inv_type == 14 || inv_type == 23) {
                        if let Some(profile) = class_data::spec_weapon_profile(cn, main_spec) {
                            main_can_use = if item_class == 2 {
                                profile.weapon_subclasses.contains(&weapon_sub)
                            } else if inv_type == 14 {
                                profile.can_use_shield
                            } else {
                                profile.can_use_offhand
                            };
                        }
                    }

                    if !main_can_use {
                        item_json["off_spec"] = serde_json::json!(true);
                    }
                }
                if !diff_info.is_empty() {
                    item_json["difficulty_info"] = Value::Object(diff_info);
                }
                if !dungeon_info.is_empty() {
                    item_json["dungeon_info"] = Value::Object(dungeon_info);
                }
                by_slot.entry(slot).or_default().push(item_json);
            }
        }
    }

    let mut ordered = serde_json::Map::new();
    for &slot in class_data::SLOT_DISPLAY_ORDER {
        if let Some(mut slot_items) = by_slot.remove(slot) {
            slot_items.sort_by(|a, b| {
                b.get("ilevel")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
                    .cmp(&a.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0))
            });
            ordered.insert(slot.to_string(), Value::Array(slot_items));
        }
    }
    for (slot, mut slot_items) in by_slot {
        slot_items.sort_by(|a, b| {
            b.get("ilevel")
                .and_then(|v| v.as_u64())
                .unwrap_or(0)
                .cmp(&a.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0))
        });
        ordered.insert(slot.to_string(), Value::Array(slot_items));
    }

    if ordered.is_empty() {
        None
    } else {
        Some(ordered)
    }
}

// ---- Drop Variants (opt-in, Drop Finder only) ----

/// Inventory types eligible for Void Forge: trinket + weapons + off-hand
/// (matches gear-resolver VF_SLOTS: main_hand/off_hand/trinkets). Derived from
/// the canonical inv-type classifier so it can't drift from the slot mapping.
fn is_void_forge_inv_type(inv_type: u64) -> bool {
    matches!(
        class_data::inventory_type_display_slot(inv_type),
        "Main Hand" | "Off Hand" | "Trinket"
    )
}

/// Recompute a per-difficulty info map for a Void Forged variant. For each
/// `(diff, entry)` with a `track`, if the track has a voidforge mapping, emit
/// `diff -> { ilvl, bonus_id, quality: 4 }` (no `track` — it's beyond the track
/// so the upgrade slider is a no-op). Returns None if the resulting map is empty.
fn void_forge_info_map(info: &Value) -> Option<serde_json::Map<String, Value>> {
    let entries = info.as_object()?;
    let mut out = serde_json::Map::new();
    for (diff, entry) in entries {
        let track = match entry.get("track").and_then(|v| v.as_str()) {
            Some(t) => t,
            None => continue,
        };
        if let Some((vf_bonus, vf_ilvl)) = item_db::void_forge_for_track(track) {
            out.insert(
                diff.clone(),
                serde_json::json!({ "ilvl": vf_ilvl, "bonus_id": vf_bonus, "quality": 4 }),
            );
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Build a Void Forged variant of a drop item, or None if it can't be void forged.
fn build_void_forge_variant(item: &Value) -> Option<Value> {
    let diff_info = item.get("difficulty_info").and_then(void_forge_info_map);
    let dungeon_info = item.get("dungeon_info").and_then(void_forge_info_map);
    if diff_info.is_none() && dungeon_info.is_none() {
        return None;
    }

    let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);

    // Top-level ilevel = max vf ilvl across the variant maps.
    let max_ilvl = [diff_info.as_ref(), dungeon_info.as_ref()]
        .into_iter()
        .flatten()
        .flat_map(|m| m.values())
        .filter_map(|v| v.get("ilvl").and_then(|i| i.as_u64()))
        .max()
        .unwrap_or(0);

    let mut variant = item.clone();
    let obj = variant.as_object_mut()?;
    obj.insert("is_void_forge".to_string(), Value::Bool(true));
    obj.insert("source_item_id".to_string(), serde_json::json!(item_id));
    obj.insert("ilevel".to_string(), serde_json::json!(max_ilvl));
    match diff_info {
        Some(m) => obj.insert("difficulty_info".to_string(), Value::Object(m)),
        None => obj.remove("difficulty_info"),
    };
    match dungeon_info {
        Some(m) => obj.insert("dungeon_info".to_string(), Value::Object(m)),
        None => obj.remove("dungeon_info"),
    };
    Some(variant)
}

/// Build a Catalyst variant of a drop item (converts to the class's tier piece),
/// or None if no tier item exists or the item already is the tier piece.
fn build_catalyst_variant(item: &Value, class_id: u64, inv_type: u64) -> Option<Value> {
    let tier = item_db::catalyst_tier_item(class_id, inv_type)?;
    let source_item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
    if source_item_id == tier.item_id {
        return None;
    }

    let mut variant = item.clone();
    let obj = variant.as_object_mut()?;
    obj.insert("item_id".to_string(), serde_json::json!(tier.item_id));
    obj.insert("name".to_string(), Value::String(tier.name.clone()));
    obj.insert("icon".to_string(), Value::String(tier.icon.clone()));
    obj.insert("is_catalyst".to_string(), Value::Bool(true));
    obj.insert(
        "source_item_id".to_string(),
        serde_json::json!(source_item_id),
    );
    // The tier piece is not embellished even if the source drop was; drop the
    // stale flag so it doesn't show the badge or count against the 2/2 limit.
    obj.remove("embellished");
    if tier.has_set {
        obj.insert(
            "extra_bonus_ids".to_string(),
            serde_json::json!([item_db::tier_set_bonus_id()]),
        );
    }
    Some(variant)
}

/// Append opt-in Void Forged (weapons/trinkets) and/or Catalyst (tier armor)
/// variant rows to a drops-by-slot map IN PLACE. Both the Drop Finder and roster
/// runs (via `build_drop_items`) call this; it's a no-op when both flags are
/// false, so default drops are unchanged.
pub fn add_drop_variants(
    by_slot: &mut serde_json::Map<String, Value>,
    class_name: Option<&str>,
    include_void_forge: bool,
    include_catalyst: bool,
) {
    if !include_void_forge && !include_catalyst {
        return;
    }
    let class_id = class_name.and_then(class_data::class_wow_id);

    for value in by_slot.values_mut() {
        let arr = match value.as_array_mut() {
            Some(a) => a,
            None => continue,
        };
        let mut variants: Vec<Value> = Vec::new();
        // Many source items in a slot convert to the SAME class tier piece; keep
        // only the first so we don't emit duplicate identical catalyst rows/sims.
        let mut catalyst_tier_seen: std::collections::HashSet<u64> =
            std::collections::HashSet::new();
        for item in arr.iter() {
            let inv_type = item
                .get("inventory_type")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);

            if include_void_forge && is_void_forge_inv_type(inv_type) {
                if let Some(v) = build_void_forge_variant(item) {
                    variants.push(v);
                }
            }
            if include_catalyst {
                if let Some(cid) = class_id {
                    if let Some(v) = build_catalyst_variant(item, cid, inv_type) {
                        let tier_id = v.get("item_id").and_then(|x| x.as_u64()).unwrap_or(0);
                        if catalyst_tier_seen.insert(tier_id) {
                            variants.push(v);
                        }
                    }
                }
            }
        }
        if !variants.is_empty() {
            arr.extend(variants);
            // Variants (esp. the higher-ilvl Void Forged rows) were appended after
            // the slot was ilvl-sorted; restore descending-ilvl order.
            arr.sort_by(|a, b| {
                b.get("ilevel")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
                    .cmp(&a.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0))
            });
        }
    }
}

pub fn get_drops_by_type(
    instance_type: &str,
    class_name: Option<&str>,
    spec_name: Option<&str>,
) -> Option<serde_json::Map<String, Value>> {
    let instances = item_db::instances();
    let mut merged: HashMap<&str, Vec<Value>> = HashMap::new();
    let mut seen: std::collections::HashSet<u64> = std::collections::HashSet::new();

    for inst in instances {
        let itype = inst.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if itype != instance_type {
            continue;
        }
        let inst_id = inst.get("id").and_then(|id| id.as_i64()).unwrap_or(0);
        if let Some(drops) = get_instance_drops(inst_id, class_name, spec_name) {
            for (slot, items) in &drops {
                if let Some(arr) = items.as_array() {
                    for item in arr {
                        let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
                        if seen.insert(item_id) {
                            let slot_str = match slot.as_str() {
                                "Head" => "Head",
                                "Neck" => "Neck",
                                "Shoulder" => "Shoulder",
                                "Back" => "Back",
                                "Chest" => "Chest",
                                "Wrist" => "Wrist",
                                "Hands" => "Hands",
                                "Waist" => "Waist",
                                "Legs" => "Legs",
                                "Feet" => "Feet",
                                "Finger" => "Finger",
                                "Trinket" => "Trinket",
                                "One-Hand" => "One-Hand",
                                "Main Hand" => "Main Hand",
                                "Off Hand" => "Off Hand",
                                "Two-Hand" => "Two-Hand",
                                "Held In Off-Hand" => "Held In Off-Hand",
                                "Shield" => "Shield",
                                "Ranged" => "Ranged",
                                _ => "Other",
                            };
                            merged.entry(slot_str).or_default().push(item.clone());
                        }
                    }
                }
            }
        }
    }

    let mut ordered = serde_json::Map::new();
    for &slot in class_data::SLOT_DISPLAY_ORDER {
        if let Some(mut slot_items) = merged.remove(slot) {
            slot_items.sort_by(|a, b| {
                b.get("ilevel")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
                    .cmp(&a.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0))
            });
            ordered.insert(slot.to_string(), Value::Array(slot_items));
        }
    }

    if ordered.is_empty() {
        None
    } else {
        Some(ordered)
    }
}

#[cfg(test)]
mod variant_tests {
    use super::*;
    use crate::test_support::ensure_game_data_loaded;
    use serde_json::json;

    #[test]
    fn build_void_forge_variant_upgrades_ilvl_and_strips_track() {
        ensure_game_data_loaded();
        // Synthetic raid weapon with a Myth-track difficulty entry.
        let item = json!({
            "item_id": 12345,
            "name": "Test Blade",
            "icon": "inv_sword_01",
            "quality": 4,
            "ilevel": 700,
            "inventory_type": 13,
            "difficulty_info": {
                "mythic": { "ilvl": 700, "bonus_id": 111, "quality": 4,
                            "track": "Myth", "level": 6, "max_level": 6 }
            }
        });
        let (vf_bonus, vf_ilvl) = item_db::void_forge_for_track("Myth").unwrap();
        let vf = build_void_forge_variant(&item).expect("Myth weapon should be void-forgeable");
        assert_eq!(vf["is_void_forge"], json!(true));
        assert_eq!(vf["source_item_id"], json!(12345));
        assert_eq!(vf["item_id"], json!(12345), "item_id unchanged");
        let entry = &vf["difficulty_info"]["mythic"];
        assert!(entry.get("track").is_none(), "track must be stripped");
        assert_eq!(entry["quality"], json!(4));
        assert_eq!(entry["bonus_id"].as_u64().unwrap(), vf_bonus);
        assert_eq!(entry["ilvl"].as_u64().unwrap(), vf_ilvl);
        assert!(vf_ilvl > 0, "void-forged ilvl should be > 0");
        assert_eq!(vf["ilevel"].as_u64().unwrap(), vf_ilvl);
    }

    #[test]
    fn build_void_forge_variant_returns_none_without_track() {
        ensure_game_data_loaded();
        // Fixed-ilvl item: no "track" anywhere → not void-forgeable.
        let item = json!({
            "item_id": 1,
            "inventory_type": 13,
            "difficulty_info": { "mythic": { "ilvl": 700, "bonus_id": 0, "quality": 4 } }
        });
        assert!(build_void_forge_variant(&item).is_none());
    }

    #[test]
    fn build_catalyst_variant_converts_to_tier_piece() {
        ensure_game_data_loaded();
        let class_id = class_data::class_wow_id("mage").unwrap();
        let inv_type = 5u64; // chest
        let tier = item_db::catalyst_tier_item(class_id, inv_type)
            .expect("mage chest tier item should exist");
        let item = json!({
            "item_id": 999999,
            "name": "Random Chest",
            "icon": "inv_chest_01",
            "quality": 4,
            "ilevel": 700,
            "inventory_type": inv_type,
            "difficulty_info": {
                "mythic": { "ilvl": 700, "bonus_id": 111, "quality": 4,
                            "track": "Myth", "level": 6, "max_level": 6 }
            }
        });
        let cat = build_catalyst_variant(&item, class_id, inv_type).expect("should convert");
        assert_eq!(cat["is_catalyst"], json!(true));
        assert_eq!(cat["item_id"].as_u64().unwrap(), tier.item_id);
        assert_eq!(cat["source_item_id"], json!(999999));
        assert_eq!(cat["name"], json!(tier.name));
        // difficulty_info preserved (catalyst keeps ilvl + upgrade track).
        assert_eq!(cat["difficulty_info"], item["difficulty_info"]);
        if tier.has_set {
            let extra: Vec<u64> = cat["extra_bonus_ids"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_u64().unwrap())
                .collect();
            assert!(extra.contains(&item_db::tier_set_bonus_id()));
        }
    }

    #[test]
    fn build_catalyst_variant_returns_none_when_already_tier() {
        ensure_game_data_loaded();
        let class_id = class_data::class_wow_id("mage").unwrap();
        let inv_type = 5u64;
        let tier = item_db::catalyst_tier_item(class_id, inv_type).unwrap();
        let item = json!({ "item_id": tier.item_id, "inventory_type": inv_type });
        assert!(build_catalyst_variant(&item, class_id, inv_type).is_none());
    }

    #[test]
    fn add_drop_variants_adds_vf_and_catalyst_siblings() {
        ensure_game_data_loaded();
        // 1307 = The Voidspire, a current raid with weapons + tier armor.
        let mut map = get_instance_drops(1307, Some("mage"), Some("frost"))
            .expect("Voidspire should have mage/frost drops");
        let before: usize = map
            .values()
            .filter_map(|v| v.as_array())
            .map(|a| a.len())
            .sum();

        add_drop_variants(&mut map, Some("mage"), true, true);

        let mut vf_count = 0;
        let mut cat_count = 0;
        for value in map.values() {
            for item in value.as_array().into_iter().flatten() {
                if item.get("is_void_forge").and_then(|v| v.as_bool()) == Some(true) {
                    vf_count += 1;
                }
                if item.get("is_catalyst").and_then(|v| v.as_bool()) == Some(true) {
                    cat_count += 1;
                }
            }
        }
        let after: usize = map
            .values()
            .filter_map(|v| v.as_array())
            .map(|a| a.len())
            .sum();
        assert!(vf_count > 0, "expected at least one void-forge sibling");
        assert!(cat_count > 0, "expected at least one catalyst sibling");
        assert_eq!(after, before + vf_count + cat_count);
    }

    #[test]
    fn add_drop_variants_noop_when_both_false() {
        ensure_game_data_loaded();
        let map = get_instance_drops(1307, Some("mage"), Some("frost")).unwrap();
        let mut copy = map.clone();
        add_drop_variants(&mut copy, Some("mage"), false, false);
        assert_eq!(
            copy, map,
            "roster path (both false) must leave map unchanged"
        );
    }
}
