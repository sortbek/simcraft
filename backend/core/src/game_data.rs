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
    icon_file_ids_json, is_catalyst_tier_item, item_limit_categories_for, list_augments,
    list_enchants_for_slot, list_flasks, list_foods, list_gems, list_potions, list_temp_enchants,
    load, omnium_tree, talent_tree, upgrade_bonus_ids_to_max, upgrade_items_by_slot,
    upgrade_simc_input, CatalystTierItem,
};
pub use crate::types::class_data::{quality_name, QUALITY_NAMES};

pub fn get_instances() -> &'static Vec<Value> {
    item_db::instances()
}

/// Raid instances belonging to the current season.
///
/// A season's raid pool lists boss encounter IDs, unlike a dungeon pool whose
/// `encounters` are instance IDs, so membership is resolved by finding which
/// raids own those bosses. Returns empty when no raid pool is configured or the
/// pool is missing from the data; callers treat that as "no season filter".
pub fn season_raid_instance_ids() -> Vec<i64> {
    let instances = item_db::instances();
    let pool_id = match item_db::season_cfg()
        .get("raidPoolInstanceId")
        .and_then(|v| v.as_i64())
    {
        Some(id) => id,
        None => return Vec::new(),
    };

    let pool_bosses: std::collections::HashSet<i64> = instances
        .iter()
        .find(|i| i.get("id").and_then(|v| v.as_i64()) == Some(pool_id))
        .and_then(|i| i.get("encounters"))
        .and_then(|e| e.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|e| e.get("id").and_then(|v| v.as_i64()))
                .collect()
        })
        .unwrap_or_default();
    if pool_bosses.is_empty() {
        return Vec::new();
    }

    instances
        .iter()
        .filter(|i| i.get("type").and_then(|t| t.as_str()) == Some("raid"))
        .filter_map(|i| {
            let id = i.get("id").and_then(|v| v.as_i64())?;
            if id <= 0 {
                return None;
            }
            let owns_boss = i.get("encounters")?.as_array()?.iter().any(|e| {
                e.get("id")
                    .and_then(|v| v.as_i64())
                    .is_some_and(|eid| pool_bosses.contains(&eid))
            });
            if owns_boss {
                Some(id)
            } else {
                None
            }
        })
        .collect()
}

// ---- Drop Resolver ----

/// Drops for one instance, filtered to what `class_name`/`spec_name` can use.
///
/// `loot_spec_filter` controls the two restrictions that are about the spec
/// rather than the character: the item's own spec allowlist (Blizzard's
/// personal-loot restriction) and its primary stat. With it off, everything the
/// class can physically equip is included — a Restoration Druid sees a
/// Strength/Agility trinket. Armor type and weapon eligibility filter either way.
pub fn get_instance_drops(
    instance_id: i64,
    class_name: Option<&str>,
    spec_name: Option<&str>,
    loot_spec_filter: bool,
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
    let raid_vault_tiers = item_db::raid_vault_difficulties();
    let armor_slot_types = class_data::ARMOR_INVENTORY_TYPES;
    let mut by_slot: HashMap<&str, Vec<Value>> = HashMap::new();
    let mut seen: std::collections::HashSet<u64> = std::collections::HashSet::new();

    // Sorted, because one item can be obtainable from more than one boss (a tier
    // piece from its own slot token, and again from the last boss's any-slot
    // token) and only the first is kept. HashMap order would re-attribute it on
    // every restart; this pins it to the same boss every time.
    let mut ordered_encounters: Vec<i64> = encounter_ids.keys().copied().collect();
    ordered_encounters.sort_unstable();

    for eid in &ordered_encounters {
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

                // A tier token cannot be worn: it grants one class's tier piece.
                // Resolve it so the boss lists what it actually hands this
                // character. Done after the pool filter, which reads the token's
                // own source, and before everything below, which reads the item.
                let token_target = item_db::tier_token_target(item, class_name);
                let from_tier_token = token_target.is_some();
                let item = token_target.unwrap_or(item);

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
                    // Weapon, shield, or held off-hand — check spec profiles.
                    // With the loot-spec filter off, drop to the class-level check:
                    // a spec's weapon profile is narrower than its class's, and
                    // "any gear your class can equip" has to mean exactly that.
                    if let Some(cn) = class_name {
                        if loot_spec_filter && !active_spec_names.is_empty() {
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
                        } else {
                            // No spec profile to consult — fall back to class level.
                            // Shields need their own check: they are itemClass 4
                            // with inv_type 14, so neither the weapon-subclass list
                            // nor the armor-type gate (which only covers
                            // ARMOR_INVENTORY_TYPES) would reject them.
                            if inv_type == 14 && !class_data::class_can_use_shield(cn) {
                                continue;
                            }
                            if let Some(weapons) = allowed_weapons {
                                if item_class == 2 && !weapons.contains(&weapon_sub) {
                                    continue;
                                }
                            }
                        }
                    }
                }

                // Filter by primary stat — rejects items whose fixed primary
                // stat (e.g. Strength) cannot serve any active spec. Items
                // without primary-stat entries (most cosmetics, some
                // effect-only trinkets) are passed through.
                // Guarded rather than folded into the if-let tuple: that form
                // builds every element first, so `item_primary_stats` would
                // allocate a HashSet per item even with the filter off.
                if loot_spec_filter && !active_spec_names.is_empty() {
                    if let (Some(cn), Some(item_stats)) =
                        (class_name, class_data::item_primary_stats(item))
                    {
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
                    if loot_spec_filter && !allowed_specs.is_empty() {
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

                // Difficulties that leave the track for this encounter only (S2:
                // Mythic on the last two Venomous Abyss bosses is a fixed Myth
                // 9/6 = 344). No "track" field → resolve_upgrade returns it as
                // dropped and the upgrade slider is a no-op, as for fixed raids.
                if let Some(over) =
                    item_db::encounter_difficulty_override(*eid).and_then(|v| v.as_object())
                {
                    for (diff, entry) in over {
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
                }

                // Bonus rolls pay the Great Vault item level for the difficulty
                // rolled on, so every tier is a FLAT rank: it replaces the
                // encounter's own upgrade level rather than stacking with it.
                // Only encounters a roll can actually be spent on get these keys
                // (raid trash cannot), and never fixed-ilvl raids, whose gear sits
                // off the tracks the vault pays on.
                if upgrade_lvl.is_some()
                    && fixed_diff.is_none()
                    && item_db::is_bonus_roll_raid_encounter(*eid)
                {
                    for vault in &raid_vault_tiers {
                        // A Very Rare drop keeps its own item level under a bonus
                        // roll, so the per-encounter override outranks the tier.
                        // Copied verbatim — no "track" field, so the upgrade
                        // slider stays a no-op and cannot walk it back down.
                        if let Some(entry) = item_db::encounter_difficulty_override(*eid)
                            .and_then(|v| v.get(&vault.base_difficulty))
                        {
                            diff_info.insert(vault.key.clone(), entry.clone());
                            continue;
                        }
                        let Some(track) = vault.track.as_deref() else {
                            continue;
                        };
                        if let Some(&(ilvl, bonus_id, quality)) =
                            track_map.and_then(|t| t.get(&(track.to_string(), vault.level, tm)))
                        {
                            diff_info.insert(
                                vault.key.clone(),
                                serde_json::json!({
                                    "ilvl": ilvl, "bonus_id": bonus_id, "quality": quality,
                                    "track": track, "level": vault.level, "max_level": tm,
                                }),
                            );
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
                    "instance_id": if is_meta && encounter_to_instance.contains_key(eid) { *eid } else { instance_id },
                });
                if !item_specs.is_empty() {
                    item_json["specs"] = serde_json::json!(item_specs);
                }
                // A token drop hands over the tier piece with its own secondaries,
                // unlike a catalyst conversion — the UI has to tell them apart.
                if from_tier_token {
                    item_json["from_tier_token"] = serde_json::json!(true);
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
                item_json["accepts_preferred_stats"] =
                    serde_json::json!(item_db::accepts_preferred_stats(item_id));
                // Nothing for the sim to value, so it comes back at zero: say so
                // rather than let the row read as a bad item.
                if item_db::has_no_sim_value(item_id) {
                    item_json["no_sim_value"] = serde_json::json!(true);
                }
                // Effect grants (e.g. Venomcursed procs) live in the item's own
                // bonusLists, never in the chosen upgrade bonus. Publish them so the
                // tooltip renders the item the sim actually runs.
                let effect_bonus_ids = item_db::item_effect_bonus_ids(item_id);
                if !effect_bonus_ids.is_empty() {
                    item_json["effect_bonus_ids"] = serde_json::json!(effect_bonus_ids);
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
    // Crafted gear can't be catalysed; owning the rule here covers every caller
    // (tier rows in the crafted pool would also break the crafted-only sim guard).
    if item_db::is_crafted_item(source_item_id) {
        return None;
    }
    // The conversion inherits the source's secondaries, so a set bonus is the
    // only thing it can add. Slots whose tier result carries no set id convert
    // into a strictly identical item — nothing to sim.
    if !tier.has_set {
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
    if let Some(name) = item.get("name").and_then(|n| n.as_str()) {
        obj.insert("source_name".to_string(), Value::String(name.to_string()));
    }
    // The tier piece is not embellished even if the source drop was; drop the
    // stale flag so it doesn't show the badge or count against the 2/2 limit.
    obj.remove("embellished");
    // Secondaries are inherited from the source drop, so eligibility follows it.
    obj.insert(
        "accepts_preferred_stats".to_string(),
        Value::Bool(item_db::accepts_preferred_stats(source_item_id)),
    );
    // The tier piece is a different item with its own stat block, so re-derive
    // rather than inherit the source's verdict.
    match item_db::has_no_sim_value(tier.item_id) {
        true => obj.insert("no_sim_value".to_string(), Value::Bool(true)),
        false => obj.remove("no_sim_value"),
    };
    // The conversion re-bases the stats, but a granted effect rides along: the
    // game keeps the source's, as an exported catalysed piece shows (tier legs
    // redirected from Chausses of Unbound Rancor still carry Venomcursed
    // Critical Strike). So the source's effects survive, and the tier piece's
    // own are merged on top rather than replacing them.
    let mut effects = item_db::item_effect_bonus_ids(source_item_id);
    for id in item_db::item_effect_bonus_ids(tier.item_id) {
        if !effects.contains(&id) {
            effects.push(id);
        }
    }
    if effects.is_empty() {
        obj.remove("effect_bonus_ids");
    } else {
        obj.insert("effect_bonus_ids".to_string(), serde_json::json!(effects));
    }
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
                    // One row per source: each is a different boss to farm.
                    if let Some(v) = build_catalyst_variant(item, cid, inv_type) {
                        variants.push(v);
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

    // Raids are season-scoped: restrict to this season's raids, which also skips
    // the raid meta-pools (themselves type "raid") that would otherwise be
    // scanned redundantly.
    let season_raids = if instance_type == "raid" {
        season_raid_instance_ids()
    } else {
        Vec::new()
    };

    for inst in instances {
        let itype = inst.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if itype != instance_type {
            continue;
        }
        let inst_id = inst.get("id").and_then(|id| id.as_i64()).unwrap_or(0);
        if !season_raids.is_empty() && !season_raids.contains(&inst_id) {
            continue;
        }
        if let Some(drops) = get_instance_drops(inst_id, class_name, spec_name, true) {
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
mod season_filter_tests {
    use super::*;
    use crate::test_support::ensure_game_data_loaded;

    /// The drop payload feeds the Wowhead tooltip, the sim candidate feeds SimC.
    /// If effect grants reach only the latter, an item tooltips without the proc
    /// it is simmed with — the divergence #157 reported.
    #[test]
    fn drop_payload_publishes_effect_bonuses() {
        ensure_game_data_loaded();
        // Aqirbane Reliquary carries the Venomcursed proc in its own bonusLists.
        const AQIRBANE: u64 = 268265;
        let expected = crate::item_db::item_effect_bonus_ids(AQIRBANE);
        assert!(!expected.is_empty(), "fixture item has no effect bonus");
        let drops = get_drops_by_type("raid", None, None).expect("raid drops");
        let item = drops
            .values()
            .filter_map(Value::as_array)
            .flatten()
            .find(|i| i.get("item_id").and_then(Value::as_u64) == Some(AQIRBANE))
            .expect("Aqirbane in raid drops");
        let published: Vec<u64> = item
            .get("effect_bonus_ids")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_u64).collect())
            .unwrap_or_default();
        assert_eq!(published, expected, "tooltip would miss the item's effect");
    }

    /// The raid pool lists boss encounter IDs, so the resolver has to map them
    /// back to the raids that own them.
    #[test]
    fn season_raid_ids_resolve_pool_bosses_to_owning_raids() {
        ensure_game_data_loaded();
        let mut ids = season_raid_instance_ids();
        ids.sort_unstable();
        assert_eq!(
            ids,
            vec![1317, 1320],
            "expected The Tidebound Grotto + The Venomous Abyss"
        );
    }

    #[test]
    fn raid_drops_exclude_previous_season_raids() {
        ensure_game_data_loaded();
        let drops = get_drops_by_type("raid", None, None).expect("raid drops");
        let source_ids = season_raid_instance_ids();
        for item in drops.values().filter_map(Value::as_array).flatten() {
            assert!(source_ids.contains(&item["instance_id"].as_i64().expect("source instance id")));
        }
        let names: std::collections::HashSet<String> = drops
            .values()
            .filter_map(|v| v.as_array())
            .flatten()
            .filter_map(|i| i.get("instance_name")?.as_str())
            .map(str::to_string)
            .collect();

        assert!(
            names.contains("The Venomous Abyss"),
            "current-season raid missing, got {names:?}"
        );
        for stale in ["The Voidspire", "March on Quel'Danas", "The Dreamrift"] {
            assert!(!names.contains(stale), "{stale} is last season's raid");
        }
        // Neither pool claims these, so the strict filter drops them too.
        for unpooled in ["World Bosses", "Sporefall"] {
            assert!(!names.contains(unpooled), "{unpooled} is not in-season");
        }
    }

    /// Every in-season raid boss needs an upgrade level, and it should agree
    /// with the `itemSequenceLevel` the data ships. Without an entry a boss
    /// silently resolves to the wrong item level.
    #[test]
    fn in_season_raid_bosses_have_upgrade_levels_matching_the_data() {
        ensure_game_data_loaded();
        let season_raids = season_raid_instance_ids();
        let mut checked = 0;

        for inst in item_db::instances() {
            let id = inst.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            if !season_raids.contains(&id) {
                continue;
            }
            for enc in inst
                .get("encounters")
                .and_then(|e| e.as_array())
                .into_iter()
                .flatten()
            {
                // Trash entries carry no sequence level.
                let Some(seq) = enc.get("itemSequenceLevel").and_then(|v| v.as_u64()) else {
                    continue;
                };
                let eid = enc.get("id").and_then(|v| v.as_i64()).unwrap();
                let name = enc.get("name").and_then(|v| v.as_str()).unwrap_or("?");
                assert_eq!(
                    item_db::encounter_upgrade_level(eid),
                    Some(seq),
                    "{name} ({eid}) upgrade level must match itemSequenceLevel"
                );
                checked += 1;
            }
        }
        assert_eq!(checked, 9, "expected 9 bosses across this season's raids");
    }

    /// The flag has to survive into the drop payload, not just the item DB.
    #[test]
    fn statless_drops_are_published_with_no_sim_value() {
        ensure_game_data_loaded();
        let drops = get_instance_drops(1313, None, None, true).expect("instance 1313 drops");
        let sigil = drops
            .values()
            .filter_map(|v| v.as_array())
            .flatten()
            .find(|i| i.get("item_id").and_then(|v| v.as_u64()) == Some(250224))
            .expect("Mindpiercer's Sigil drops here");
        assert_eq!(sigil["no_sim_value"], serde_json::json!(true));

        // Over-flagging is the real risk, so pin the negative too. 250244 shares
        // this instance's pools, so it is the one other row allowed to carry it.
        let flagged: Vec<u64> = drops
            .values()
            .filter_map(|v| v.as_array())
            .flatten()
            .filter(|i| i.get("no_sim_value").is_some())
            .filter_map(|i| i.get("item_id").and_then(|v| v.as_u64()))
            .collect();
        assert!(
            flagged.iter().all(|id| *id == 250224 || *id == 250244),
            "unexpected items flagged: {flagged:?}"
        );
    }

    /// Mythic loot from the last two Venomous Abyss bosses is Myth 9/6 (344),
    /// which is off the six-step Myth track, while their other difficulties stay
    /// on it.
    #[test]
    fn last_two_raid_bosses_drop_myth_9_of_6_on_mythic_only() {
        ensure_game_data_loaded();
        let drops = get_instance_drops(1320, None, None, true).expect("Venomous Abyss drops");

        let mut checked = 0;
        for item in drops.values().filter_map(|v| v.as_array()).flatten() {
            let eid = item
                .get("encounter_id")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            if eid != 2883 && eid != 2895 {
                continue;
            }
            let Some(info) = item.get("difficulty_info") else {
                continue;
            };
            let mythic = &info["mythic"];
            assert_eq!(mythic["ilvl"], serde_json::json!(344), "Mythic is Myth 9/6");
            assert_eq!(mythic["bonus_id"], serde_json::json!(13848));
            assert!(
                mythic.get("track").is_none(),
                "344 is off-track, so it must not be upgradeable"
            );
            // The other difficulties keep the normal track at step 4.
            assert_eq!(info["lfr"]["ilvl"], serde_json::json!(289));
            assert_eq!(info["normal"]["ilvl"], serde_json::json!(302));
            assert_eq!(info["heroic"]["ilvl"], serde_json::json!(315));
            assert_eq!(info["heroic"]["track"], serde_json::json!("Hero"));
            checked += 1;
        }
        assert!(checked > 0, "no loot found for the last two bosses");
    }

    /// Dungeon loot per keystone level, as the game lists it. +6 and +7 share
    /// 305 but +6 is already Hero 1/6, not Champion 5/6: same item level, but
    /// only Hero upgrades past 308.
    #[test]
    fn mythic_plus_drops_land_on_the_game_item_levels() {
        ensure_game_data_loaded();
        let drops = get_instance_drops(-1, None, None, false).expect("M+ pool drops");
        let info = drops
            .values()
            .filter_map(|v| v.as_array())
            .flatten()
            .find_map(|item| item.get("dungeon_info"))
            .expect("an M+ drop with dungeon info");

        for (key, ilvl, track, level) in [
            ("heroic", 276, "Adventurer", 4),
            ("mythic", 292, "Champion", 1),
            ("mythic+2", 295, "Champion", 2),
            ("mythic+3", 295, "Champion", 2),
            ("mythic+4", 298, "Champion", 3),
            ("mythic+5", 302, "Champion", 4),
            ("mythic+6", 305, "Hero", 1),
            ("mythic+7", 305, "Hero", 1),
            ("mythic+8", 308, "Hero", 2),
            ("mythic+9", 308, "Hero", 2),
            ("mythic+10", 311, "Hero", 3),
            ("vault+0", 302, "Champion", 4),
            ("vault+2-3", 305, "Champion", 5),
            ("vault+4-5", 308, "Champion", 6),
            ("vault+6", 311, "Hero", 3),
            ("vault+7-9", 315, "Hero", 4),
            ("vault+10-13", 318, "Myth", 1),
        ] {
            let got = &info[key];
            assert_eq!(got["ilvl"], serde_json::json!(ilvl), "{key} item level");
            assert_eq!(got["track"], serde_json::json!(track), "{key} track");
            assert_eq!(got["level"], serde_json::json!(level), "{key} track level");
        }
    }

    /// Off-track bonuses must be indexed as fixed-difficulty, or every feature
    /// gating on "current season AND a minimum track" silently drops this gear.
    #[test]
    fn off_track_override_bonuses_are_indexed_as_fixed_difficulty() {
        ensure_game_data_loaded();
        assert!(
            item_db::is_fixed_difficulty_bonus(13848),
            "Myth 9/6 (344) carries no track or seasonId of its own"
        );
    }

    /// Guards against the failure that motivated this change: a season rolls
    /// over, the pool IDs in season-config.json go stale, and they keep
    /// resolving against the previous season's pools instead of erroring.
    #[test]
    fn configured_pool_ids_all_exist() {
        ensure_game_data_loaded();
        let known: std::collections::HashSet<i64> = item_db::instances()
            .iter()
            .filter_map(|i| i.get("id")?.as_i64())
            .collect();
        let cfg = item_db::season_cfg();

        let raid_pool = cfg.get("raidPoolInstanceId").and_then(|v| v.as_i64());
        assert!(raid_pool.is_some(), "raidPoolInstanceId must be configured");
        assert!(
            known.contains(&raid_pool.unwrap()),
            "raidPoolInstanceId {raid_pool:?} does not exist"
        );

        let cats = cfg
            .get("dungeonCategories")
            .and_then(|v| v.as_array())
            .expect("dungeonCategories");
        for cat in cats {
            let id = cat
                .get("poolInstanceId")
                .and_then(|v| v.as_i64())
                .expect("poolInstanceId");
            let key = cat.get("key").and_then(|v| v.as_str()).unwrap_or("?");
            assert!(known.contains(&id), "pool {id} for '{key}' does not exist");
        }
    }

    /// The loaded data dir must carry the season's catalyst currency: without
    /// it charge parsing returns None and the Revival Catalyst toggle silently
    /// disappears from release builds. Tests load the compacted output, so a
    /// stale or mis-staged season-config.json fails here instead of shipping.
    #[test]
    fn season_config_defines_catalyst_currency() {
        ensure_game_data_loaded();
        assert_ne!(
            item_db::catalyst_currency_id(),
            0,
            "season-config.json in the loaded data dir lacks catalystCurrencyId"
        );
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
    fn catalyst_only_converts_into_a_set_piece() {
        ensure_game_data_loaded();
        let class_id = class_data::class_wow_id("death_knight").unwrap();
        let drop = |item_id: u64, inv: u64| {
            json!({
                "item_id": item_id, "name": "x", "icon": "x",
                "quality": 4, "ilevel": 334, "inventory_type": inv,
            })
        };
        // Head is a set slot: the conversion buys a set bonus, so it is worth simming.
        assert!(build_catalyst_variant(&drop(268229, 1), class_id, 1).is_some());
        // Waist converts too, but into a piece with no set id. Secondaries are
        // inherited either way, so the result is a strictly identical item.
        assert!(build_catalyst_variant(&drop(268244, 6), class_id, 6).is_none());

        // The set covers exactly head, shoulder, chest, legs and hands.
        for inv in [1, 3, 5, 7, 10] {
            assert!(
                item_db::catalyst_tier_item(class_id, inv).is_some_and(|t| t.has_set),
                "inv {inv} should convert into a set piece"
            );
        }
        for inv in [6, 8, 9, 16] {
            assert!(
                item_db::catalyst_tier_item(class_id, inv).is_some_and(|t| !t.has_set),
                "inv {inv} converts, but adds nothing"
            );
        }
    }

    #[test]
    fn catalyst_variant_keeps_the_source_items_granted_effect() {
        ensure_game_data_loaded();
        // Chausses of Unbound Rancor grants Venomcursed Critical Strike (13708).
        // The character's own export proves the game keeps it through the
        // conversion: tier legs 271473, redirected_base_stats=271878, still
        // carrying 13708. Only the stats are re-based; the effect rides along.
        let source_effects = item_db::item_effect_bonus_ids(271878);
        assert!(
            source_effects.contains(&13708),
            "fixture drifted: the source no longer grants the effect"
        );
        assert!(
            !item_db::item_effect_bonus_ids(271473).contains(&13708),
            "fixture drifted: the tier piece grants it on its own"
        );

        let class_id = class_data::class_wow_id("death_knight").unwrap();
        let item = json!({
            "item_id": 271878,
            "name": "Chausses of Unbound Rancor",
            "icon": "inv_legs",
            "quality": 4,
            "ilevel": 334,
            "inventory_type": 7,
            "effect_bonus_ids": source_effects,
        });
        let variant = build_catalyst_variant(&item, class_id, 7).expect("legs tier piece exists");
        let effects: Vec<u64> = variant
            .get("effect_bonus_ids")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_u64()).collect())
            .unwrap_or_default();
        assert!(
            effects.contains(&13708),
            "the catalysed piece must keep the source's effect, got {effects:?}"
        );
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
        assert_eq!(cat["source_name"], json!("Random Chest"));
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
    fn build_catalyst_variant_refuses_crafted_source() {
        crate::test_support::ensure_game_data_loaded();
        let item = serde_json::json!({ "item_id": 237830u64, "inventory_type": 5 });
        assert!(
            build_catalyst_variant(&item, 1, 5).is_none(),
            "crafted gear must not be catalysable"
        );
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
        let mut map = get_instance_drops(1307, Some("mage"), Some("frost"), true)
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
        let map = get_instance_drops(1307, Some("mage"), Some("frost"), true).unwrap();
        let mut copy = map.clone();
        add_drop_variants(&mut copy, Some("mage"), false, false);
        assert_eq!(
            copy, map,
            "roster path (both false) must leave map unchanged"
        );
    }

    #[test]
    fn add_drop_variants_emits_one_catalyst_row_per_source() {
        ensure_game_data_loaded();
        let mut map = serde_json::Map::new();
        map.insert(
            "Head".to_string(),
            json!([
                { "item_id": 900001, "name": "Helm A", "icon": "i",
                  "ilevel": 700, "inventory_type": 1, "encounter": "Boss A" },
                { "item_id": 900002, "name": "Helm B", "icon": "i",
                  "ilevel": 700, "inventory_type": 1, "encounter": "Boss B" },
                { "item_id": 900003, "name": "Helm C", "icon": "i",
                  "ilevel": 690, "inventory_type": 1, "encounter": "Boss C" },
            ]),
        );

        add_drop_variants(&mut map, Some("mage"), false, true);

        let mut sources: Vec<u64> = map["Head"]
            .as_array()
            .expect("head slot array")
            .iter()
            .filter(|i| i.get("is_catalyst").and_then(|v| v.as_bool()) == Some(true))
            .filter_map(|i| i.get("source_item_id").and_then(|v| v.as_u64()))
            .collect();
        sources.sort_unstable();
        assert_eq!(
            sources,
            vec![900001, 900002, 900003],
            "each eligible source needs its own catalyst row"
        );
    }
}

#[cfg(test)]
mod bonus_roll_tests {
    use super::*;
    use crate::test_support::ensure_game_data_loaded;
    use serde_json::json;
    use std::collections::BTreeSet;

    /// Every drop the raid endpoint serves, paired with its encounter id.
    fn season_raid_items() -> Vec<(i64, Value)> {
        let drops = get_drops_by_type("raid", None, None).expect("season raids have drops");
        drops
            .values()
            .filter_map(|items| items.as_array())
            .flatten()
            .map(|item| {
                let eid = item
                    .get("encounter_id")
                    .and_then(|v| v.as_i64())
                    .expect("drops carry encounter_id");
                (eid, item.clone())
            })
            .collect()
    }

    fn vault_entry<'a>(item: &'a Value, tier: &str) -> Option<&'a Value> {
        item.get("difficulty_info")?.get(tier)
    }

    /// Whether a bonus roll on this encounter pays a ladder rank. Fixed-ilvl
    /// raids sit off the tracks the vault pays on, so they are excluded even
    /// when the extract lists them as rollable.
    fn pays_a_vault_rank(encounter_id: i64) -> bool {
        item_db::is_bonus_roll_raid_encounter(encounter_id)
            && item_db::encounter_fixed_difficulty(encounter_id).is_none()
    }

    #[test]
    fn exactly_the_bonus_rollable_bosses_carry_a_flat_tier() {
        ensure_game_data_loaded();
        // Bosses drop at different upgrade levels within a difficulty, but a
        // bonus roll pays one Great Vault item level for the whole tier.
        let mut rollable = 0;
        for (eid, item) in season_raid_items() {
            let entry = vault_entry(&item, "vault-heroic");
            if !pays_a_vault_rank(eid) {
                assert!(
                    entry.is_none(),
                    "encounter {eid} cannot be rolled on, so it must carry no tier"
                );
                continue;
            }
            rollable += 1;
            let entry =
                entry.unwrap_or_else(|| panic!("bonus-rollable encounter {eid} lost its tier"));
            assert_eq!(entry["ilvl"], serde_json::json!(318), "encounter {eid}");
            assert_eq!(
                entry["bonus_id"],
                serde_json::json!(12849),
                "encounter {eid}"
            );
            assert_eq!(entry["track"], serde_json::json!("Myth"), "encounter {eid}");
            assert_eq!(entry["level"], serde_json::json!(1), "encounter {eid}");
        }
        assert!(rollable > 0, "no raid item was bonus-rollable");
    }

    #[test]
    fn every_raid_vault_tier_matches_its_configured_rank() {
        ensure_game_data_loaded();
        // Pins the whole ladder: Champion 1/6, Hero 1/6, Myth 1/6, Myth 6/6.
        let expected = [
            ("vault-lfr", 292, 12833),
            ("vault-normal", 305, 12841),
            ("vault-heroic", 318, 12849),
            ("vault-mythic", 334, 12854),
        ];
        let items = season_raid_items();
        for (tier, ilvl, bonus_id) in expected {
            let mut checked = 0;
            for (eid, item) in &items {
                if !pays_a_vault_rank(*eid) {
                    continue;
                }
                // The Very Rare bosses leave the ladder on Mythic; covered below.
                if tier == "vault-mythic" && item_db::encounter_difficulty_override(*eid).is_some()
                {
                    continue;
                }
                checked += 1;
                let entry = vault_entry(item, tier)
                    .unwrap_or_else(|| panic!("encounter {eid} is missing tier {tier}"));
                assert_eq!(entry["ilvl"], serde_json::json!(ilvl), "{tier} on {eid}");
                assert_eq!(
                    entry["bonus_id"],
                    serde_json::json!(bonus_id),
                    "{tier} on {eid}"
                );
            }
            assert!(checked > 0, "no raid item carried tier {tier}");
        }
    }

    #[test]
    fn configured_mythic_overrides_survive_the_mythic_vault_tier() {
        ensure_game_data_loaded();
        let items = season_raid_items();
        let in_pool: BTreeSet<i64> = items.iter().map(|(eid, _)| *eid).collect();
        // Covers every override the season declares for a boss in this pool, so
        // losing one is a failure rather than a gap another boss papers over. An
        // exception missing from the config cannot be detected here — that is
        // the data pipeline's job.
        let expected: BTreeSet<i64> = item_db::season_cfg()
            .get("encounterDifficultyOverride")
            .and_then(|v| v.as_object())
            .map(|map| {
                map.iter()
                    .filter(|(_, value)| value.get("mythic").is_some())
                    .filter_map(|(key, _)| key.parse::<i64>().ok())
                    .filter(|eid| in_pool.contains(eid) && pays_a_vault_rank(*eid))
                    .collect()
            })
            .unwrap_or_default();
        assert!(
            !expected.is_empty(),
            "this season declares no Mythic overrides inside the raid pool"
        );

        let mut verified = BTreeSet::new();
        for (eid, item) in &items {
            let Some(over) =
                item_db::encounter_difficulty_override(*eid).and_then(|v| v.get("mythic"))
            else {
                continue;
            };
            let entry = vault_entry(item, "vault-mythic")
                .unwrap_or_else(|| panic!("encounter {eid} lost its vault-mythic entry"));
            assert_eq!(entry, over, "encounter {eid} must keep its override ilvl");
            assert!(
                entry.get("track").is_none(),
                "the override stays off-track so the upgrade slider cannot walk it down"
            );
            verified.insert(*eid);
        }
        assert_eq!(
            verified, expected,
            "every overridden boss in the pool must be covered"
        );
    }

    /// Tier comes from a token that nobody can equip. The loot table has to show
    /// the piece the token actually hands this character, or the five set slots
    /// are simply missing from the raid.
    #[test]
    fn tier_tokens_are_listed_as_the_piece_they_grant() {
        ensure_game_data_loaded();
        let drops =
            get_drops_by_type("raid", Some("death_knight"), None).expect("season raids have drops");
        let items: Vec<&Value> = drops
            .values()
            .filter_map(|v| v.as_array())
            .flatten()
            .collect();

        // The whole Baleful Grave-Knight set, each credited to a boss that can
        // actually grant it. Several are reachable from two bosses — their own
        // slot token and the last boss's any-slot Curio — and only one row
        // survives the per-item dedupe, so assert membership rather than one boss.
        for (item_id, granted_by) in [
            (271474u64, &[2887i64, 2895][..]),
            (271472, &[2894, 2895][..]),
            (271477, &[2882, 2895][..]),
            (271473, &[2871, 2895][..]),
            (271475, &[2874, 2895][..]),
        ] {
            let row = items
                .iter()
                .find(|i| i.get("item_id").and_then(|v| v.as_u64()) == Some(item_id))
                .unwrap_or_else(|| panic!("tier piece {item_id} is missing from the raid"));
            let encounter = row
                .get("encounter_id")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            assert!(
                granted_by.contains(&encounter),
                "tier piece {item_id} credited to {encounter}, which cannot grant it"
            );
            assert!(
                row.get("is_catalyst").is_none(),
                "{item_id} drops directly here, it is not a catalyst row"
            );
        }

        // And the unwearable tokens themselves never reach the table.
        for token_id in [270914u64, 270915, 270916, 270917] {
            assert!(
                !items
                    .iter()
                    .any(|i| i.get("item_id").and_then(|v| v.as_u64()) == Some(token_id)),
                "token {token_id} should have resolved to a tier piece"
            );
        }
    }

    /// Token-derived drops carry their own secondaries; catalyst conversions do
    /// not. The flag is what lets the UI say which of two same-named rows is which.
    #[test]
    fn only_token_derived_drops_are_flagged() {
        ensure_game_data_loaded();
        let drops = get_instance_drops(1320, Some("death_knight"), Some("Unholy"), false)
            .expect("Venomous Abyss drops");
        let heads = drops["Head"].as_array().expect("head slot");
        let flagged: Vec<u64> = heads
            .iter()
            .filter(|i| i.get("from_tier_token").and_then(|v| v.as_bool()) == Some(true))
            .filter_map(|i| i.get("item_id").and_then(|v| v.as_u64()))
            .collect();
        // 271474 is only reachable through Venomforged Effigy, so it is the one
        // head the flag belongs on; Skullguard drops as itself and must not carry it.
        assert!(
            flagged.contains(&271474),
            "token-granted tier head should be flagged, got {flagged:?}"
        );
        assert!(
            !flagged.contains(&268229),
            "a plain drop must not be flagged as a token grant"
        );
    }

    /// A token serves several classes and grants each a different piece.
    #[test]
    fn a_tier_token_grants_each_class_its_own_piece() {
        ensure_game_data_loaded();
        let token = json!({ "id": 270917 });
        let for_class = |class: &str| {
            item_db::tier_token_target(&token, Some(class))
                .and_then(|v| v.get("id"))
                .and_then(|v| v.as_u64())
        };
        // Venomforged Effigy serves warrior, paladin and death knight.
        assert_eq!(for_class("death_knight"), Some(271474));
        assert_eq!(for_class("warrior"), Some(271456));
        assert_eq!(for_class("paladin"), Some(271465));
        // A class the token does not serve, and an unknown character, get nothing.
        assert_eq!(for_class("mage"), None);
        assert_eq!(item_db::tier_token_target(&token, None), None);
        // An ordinary drop is not a token.
        assert_eq!(
            item_db::tier_token_target(&json!({ "id": 268250 }), Some("death_knight")),
            None
        );
    }

    #[test]
    fn raid_trash_gets_no_vault_tiers() {
        ensure_game_data_loaded();
        // Trash has no bonus roll, so it must not appear in a Bonus Rolls pool.
        let trash: Vec<_> = season_raid_items()
            .into_iter()
            .filter(|(eid, _)| *eid < 0)
            .collect();
        assert!(!trash.is_empty(), "expected a synthetic trash encounter");
        for (eid, item) in trash {
            assert!(
                !item_db::is_bonus_roll_raid_encounter(eid),
                "encounter {eid} should not be bonus-rollable"
            );
            for tier in ["vault-lfr", "vault-normal", "vault-heroic", "vault-mythic"] {
                assert!(
                    vault_entry(&item, tier).is_none(),
                    "trash encounter {eid} must not carry {tier}"
                );
            }
        }
    }

    #[test]
    fn lair_raid_is_in_the_pool_and_previous_tiers_are_not() {
        ensure_game_data_loaded();
        let encounters: BTreeSet<i64> = season_raid_items()
            .into_iter()
            .map(|(eid, _)| eid)
            .collect();
        assert!(
            encounters.contains(&2849),
            "Nymrissa Wavecaller (lair raid) belongs to this tier"
        );
        assert!(
            !encounters.contains(&2711),
            "Sporefall is a previous tier and must not reach the raid pool"
        );
    }
}
