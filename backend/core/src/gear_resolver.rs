//! Gear Resolver — takes flat parsed items + character info + item DB
//! and returns a fully enriched, slot-resolved gear layout.
//!
//! This is the single authority for slot eligibility, armor filtering,
//! dual-wield crossover, deduplication, and item enrichment.

use std::collections::{HashMap, HashSet};

use crate::item_db;
use crate::types::class_data::{self, ARMOR_SLOTS, GEAR_SLOTS};
use crate::types::*;

/// Build a stable UID for deduplication: "item_id:sorted_bonus_ids:origin:raw_slot"
fn make_uid(item: &RawParsedItem) -> String {
    let mut sorted = item.bonus_ids.clone();
    sorted.sort();
    let bonus_key = sorted
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(":");
    format!(
        "{}:{}:{}:{}",
        item.item_id,
        bonus_key,
        item.origin.as_str(),
        item.raw_slot
    )
}

/// Dedup key: item_id + sorted bonus_ids (ignores origin/slot).
fn dedup_key(item: &RawParsedItem) -> String {
    let mut sorted = item.bonus_ids.clone();
    sorted.sort();
    let bonus_key = sorted
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(":");
    format!("{}:{}", item.item_id, bonus_key)
}

/// Enrich a raw item with display info from the item DB.
fn enrich(item: &RawParsedItem, slot: &str) -> ResolvedItem {
    let info = item_db::get_item_info(item.item_id, Some(&item.bonus_ids));

    let (name, icon, quality, tag, upgrade, sockets) = if let Some(ref info) = info {
        (
            info.get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("Unknown")
                .to_string(),
            info.get("icon")
                .and_then(|i| i.as_str())
                .unwrap_or("inv_misc_questionmark")
                .to_string(),
            info.get("quality").and_then(|q| q.as_u64()).unwrap_or(1),
            info.get("tag")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string(),
            info.get("upgrade")
                .and_then(|u| u.as_str())
                .unwrap_or("")
                .to_string(),
            info.get("sockets").and_then(|s| s.as_u64()).unwrap_or(0),
        )
    } else {
        let name = if item.name.is_empty() {
            format!("Item {}", item.item_id)
        } else {
            item.name.clone()
        };
        (
            name,
            "inv_misc_questionmark".to_string(),
            1,
            String::new(),
            String::new(),
            0,
        )
    };

    // Resolve ilevel: prefer DB-resolved (accounts for bonuses), fall back to parsed
    let ilevel = info
        .as_ref()
        .and_then(|i| i.get("ilevel").and_then(|v| v.as_u64()))
        .filter(|&v| v > 0)
        .unwrap_or(item.ilevel);

    let enchant_name = if item.enchant_id > 0 {
        item_db::get_enchant_info(item.enchant_id)
            .and_then(|e| {
                e.get("name")
                    .and_then(|n| n.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_default()
    } else {
        String::new()
    };

    let (gem_name, gem_icon) = if item.gem_id > 0 {
        item_db::get_gem_info(item.gem_id)
            .map(|g| {
                (
                    g.get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("")
                        .to_string(),
                    g.get("icon")
                        .and_then(|i| i.as_str())
                        .unwrap_or("")
                        .to_string(),
                )
            })
            .unwrap_or_default()
    } else {
        (String::new(), String::new())
    };

    ResolvedItem {
        uid: make_uid(item),
        slot: slot.to_string(),
        item_id: item.item_id,
        ilevel,
        simc_string: item.simc_string.clone(),
        origin: item.origin,
        bonus_ids: item.bonus_ids.clone(),
        enchant_id: item.enchant_id,
        gem_id: item.gem_id,
        name,
        icon,
        quality,
        quality_color: class_data::quality_color(quality).to_string(),
        tag,
        upgrade,
        sockets,
        enchant_name,
        gem_name,
        gem_icon,
    }
}

/// Determine eligible slots for an item using the item DB's inventory_type.
/// Falls back to raw_slot + paired slots if no DB info available.
fn eligible_slots(item: &RawParsedItem, spec: &str) -> Vec<String> {
    let info = item_db::get_item_info(item.item_id, Some(&item.bonus_ids));
    if let Some(ref info) = info {
        let inv_type = info
            .get("inventory_type")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        if inv_type > 0 {
            return class_data::inv_type_to_slots(inv_type, spec)
                .into_iter()
                .map(|s| s.to_string())
                .collect();
        }
    }
    // Fallback: use raw_slot + paired slot
    let mut slots = vec![item.raw_slot.clone()];
    if let Some(paired) = class_data::paired_slot(&item.raw_slot) {
        slots.push(paired.to_string());
    }
    slots
}

/// Resolve a flat list of parsed items into a slot-organized, enriched gear set.
pub fn resolve_gear(parse_result: &ParseResult) -> ResolveGearResponse {
    let character = &parse_result.character;
    let spec = character.spec.as_deref().unwrap_or("");
    let class_name = character.class_name.as_deref().unwrap_or("");
    let max_armor = character.max_armor();
    let allowed_weapons = class_data::class_allowed_weapons(class_name);
    let can_dw = character.can_dual_wield();

    let mut slots: HashMap<String, SlotResolution> = HashMap::new();
    let mut excluded: Vec<ExcludedItem> = Vec::new();

    // Track seen dedup keys per slot
    let mut seen_per_slot: HashMap<String, HashSet<String>> = HashMap::new();

    // Separate equipped and non-equipped items
    let equipped_items: Vec<&RawParsedItem> = parse_result
        .items
        .iter()
        .filter(|i| i.origin == ItemOrigin::Equipped)
        .collect();
    let other_items: Vec<&RawParsedItem> = parse_result
        .items
        .iter()
        .filter(|i| i.origin != ItemOrigin::Equipped)
        .collect();

    // Helper to get or create slot resolution
    fn get_slot<'a>(
        slots: &'a mut HashMap<String, SlotResolution>,
        s: &str,
    ) -> &'a mut SlotResolution {
        slots
            .entry(s.to_string())
            .or_insert_with(|| SlotResolution {
                equipped: None,
                alternatives: Vec::new(),
            })
    }

    fn get_seen<'a>(
        seen: &'a mut HashMap<String, HashSet<String>>,
        s: &str,
    ) -> &'a mut HashSet<String> {
        seen.entry(s.to_string()).or_default()
    }

    // Step 1: Place equipped items in their raw_slot
    for item in &equipped_items {
        if item.item_id == 0 {
            continue;
        }
        let slot = &item.raw_slot;
        if !GEAR_SLOTS.contains(&slot.as_str()) {
            continue;
        }

        let dk = dedup_key(item);
        get_seen(&mut seen_per_slot, slot).insert(dk);

        let resolved = enrich(item, slot);
        get_slot(&mut slots, slot).equipped = Some(resolved);
    }

    // Step 2: Dual-wield crossover — add equipped weapons as alternatives in the other hand
    if can_dw {
        let mh_equipped = equipped_items.iter().find(|i| i.raw_slot == "main_hand");
        let oh_equipped = equipped_items.iter().find(|i| i.raw_slot == "off_hand");

        // Main hand → off hand alternative
        if let Some(mh) = mh_equipped {
            if mh.item_id > 0 {
                let info = item_db::get_item_info(mh.item_id, Some(&mh.bonus_ids));
                let inv_type = info
                    .as_ref()
                    .and_then(|i| i.get("inventory_type").and_then(|v| v.as_u64()))
                    .unwrap_or(0);
                // Only one-hand weapons cross over (inv_type 13)
                if inv_type == 13 {
                    let dk = dedup_key(mh);
                    if !get_seen(&mut seen_per_slot, "off_hand").contains(&dk) {
                        get_seen(&mut seen_per_slot, "off_hand").insert(dk);
                        let mut resolved = enrich(mh, "off_hand");
                        resolved.origin = ItemOrigin::Equipped;
                        get_slot(&mut slots, "off_hand").alternatives.push(resolved);
                    }
                }
            }
        }

        // Off hand → main hand alternative
        if let Some(oh) = oh_equipped {
            if oh.item_id > 0 {
                let info = item_db::get_item_info(oh.item_id, Some(&oh.bonus_ids));
                let inv_type = info
                    .as_ref()
                    .and_then(|i| i.get("inventory_type").and_then(|v| v.as_u64()))
                    .unwrap_or(0);
                if inv_type == 13 {
                    let dk = dedup_key(oh);
                    if !get_seen(&mut seen_per_slot, "main_hand").contains(&dk) {
                        get_seen(&mut seen_per_slot, "main_hand").insert(dk);
                        let mut resolved = enrich(oh, "main_hand");
                        resolved.origin = ItemOrigin::Equipped;
                        get_slot(&mut slots, "main_hand")
                            .alternatives
                            .push(resolved);
                    }
                }
            }
        }
    }

    // Step 3: Place non-equipped items (bags + vault) in all eligible slots
    for item in &other_items {
        if item.item_id == 0 {
            continue;
        }

        let item_eligible = eligible_slots(item, spec);
        if item_eligible.is_empty() {
            continue;
        }

        // Armor type check
        let mut armor_excluded = false;
        if let Some(max) = max_armor {
            if let Some(sub) = item_db::get_item_armor_subclass(item.item_id) {
                if sub > 0 && sub > max {
                    armor_excluded = true;
                }
            }
        }

        // Weapon type check
        let mut weapon_excluded = false;
        if let Some(weapons) = allowed_weapons {
            let info = item_db::get_item_info(item.item_id, Some(&item.bonus_ids));
            if let Some(ref info) = info {
                let item_class = info.get("item_class").and_then(|v| v.as_u64()).unwrap_or(0);
                if item_class == 2 {
                    let weapon_sub = info
                        .get("item_subclass")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(999);
                    if !weapons.contains(&weapon_sub) {
                        weapon_excluded = true;
                    }
                }
            }
        }

        for slot in &item_eligible {
            if !GEAR_SLOTS.contains(&slot.as_str()) {
                continue;
            }

            // Only apply armor exclusion to armor slots
            if armor_excluded && ARMOR_SLOTS.contains(&slot.as_str()) {
                excluded.push(ExcludedItem {
                    uid: make_uid(item),
                    item_id: item.item_id,
                    name: item.name.clone(),
                    reason: "Wrong armor type".to_string(),
                });
                continue;
            }

            // Weapon type exclusion for weapon slots
            if weapon_excluded && matches!(slot.as_str(), "main_hand" | "off_hand") {
                excluded.push(ExcludedItem {
                    uid: make_uid(item),
                    item_id: item.item_id,
                    name: item.name.clone(),
                    reason: "Wrong weapon type".to_string(),
                });
                continue;
            }

            let dk = dedup_key(item);
            if get_seen(&mut seen_per_slot, slot).contains(&dk) {
                continue;
            }
            get_seen(&mut seen_per_slot, slot).insert(dk);

            let resolved = enrich(item, slot);
            get_slot(&mut slots, slot).alternatives.push(resolved);
        }
    }

    // Sort alternatives by ilevel descending
    for slot_res in slots.values_mut() {
        slot_res
            .alternatives
            .sort_by(|a, b| b.ilevel.cmp(&a.ilevel));
    }

    ResolveGearResponse {
        character: CharacterResolveInfo {
            class_name: character.class_name.clone(),
            spec: character.spec.clone(),
            can_dual_wield: can_dw,
        },
        base_profile: parse_result.base_profile.clone(),
        slots,
        excluded,
        talent_loadouts: parse_result.talent_loadouts.clone(),
    }
}
