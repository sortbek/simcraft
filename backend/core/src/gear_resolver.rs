//! Gear Resolver — takes flat parsed items + character info + item DB
//! and returns a fully enriched, slot-resolved gear layout.
//!
//! This is the single authority for slot eligibility, armor filtering,
//! dual-wield crossover, deduplication, and item enrichment.

use std::collections::{HashMap, HashSet};

use once_cell::sync::Lazy;
use regex::Regex;

use crate::item_db;
use crate::types::class_data::{self, ARMOR_SLOTS, GEAR_SLOTS};
use crate::types::*;

// Pattern intentionally omits ':' — preserves gear_resolver's original behavior.
static RE_BONUS_ID_NO_COLON: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"bonus_id=([0-9/]+)").unwrap());

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

    // Always resolve bonuses for season_id (needed for catalyst checks)
    let resolved = item_db::resolve_bonuses(&item.bonus_ids);
    let season_id = resolved.season_id.unwrap_or(0);

    let (name, icon, quality, tag, upgrade, sockets, db_ilevel) = if let Some(ref info) = info {
        (
            info.name.clone(),
            info.icon.clone(),
            info.quality,
            info.tag.clone(),
            info.upgrade.clone(),
            info.sockets,
            info.ilevel,
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
            resolved.quality.unwrap_or(1),
            resolved.tag.unwrap_or_default(),
            resolved.upgrade.unwrap_or_default(),
            resolved.sockets.unwrap_or(0),
            resolved.ilevel.unwrap_or(0),
        )
    };

    // When bonuses resolved an upgrade track or ilevel override, use the DB value
    // (handles upgrade sim). Otherwise prefer parsed ilevel from addon (game client truth).
    let ilevel = if !upgrade.is_empty() && db_ilevel > 0 {
        db_ilevel
    } else if item.ilevel > 0 {
        item.ilevel
    } else {
        db_ilevel
    };

    let (enchant_name, enchant_item_id) = if item.enchant_id > 0 {
        item_db::get_enchant_info(item.enchant_id)
            .map(|e| {
                let name = e
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                let item_id = e.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
                (name, item_id)
            })
            .unwrap_or_default()
    } else {
        (String::new(), 0)
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
        enchant_item_id,
        gem_name,
        gem_icon,
        season_id,
        is_catalyst: false,
        can_catalyst: false,
        is_void_forge: false,
        can_void_forge: false,
    }
}

/// Determine eligible slots for an item using the item DB's inventory_type.
/// Falls back to raw_slot + paired slots if no DB info available.
fn eligible_slots(item: &RawParsedItem, spec: &str) -> Vec<String> {
    if let Some(inv_type) = item_db::get_inventory_type(item.item_id) {
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
    resolve_gear_impl(parse_result, None)
}

/// Resolve gear with optional catalyst alternative generation.
/// `catalyst_charges` should be pre-parsed from the raw simc input.
pub fn resolve_gear_with_catalyst(
    parse_result: &ParseResult,
    catalyst_charges: Option<u32>,
) -> ResolveGearResponse {
    resolve_gear_impl(parse_result, catalyst_charges)
}

fn resolve_gear_impl(
    parse_result: &ParseResult,
    catalyst_charges: Option<u32>,
) -> ResolveGearResponse {
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
                let inv_type = item_db::get_inventory_type(mh.item_id).unwrap_or(0);
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
                let inv_type = item_db::get_inventory_type(oh.item_id).unwrap_or(0);
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
            if let Some(raw) = item_db::get_raw_item(item.item_id) {
                let item_class = raw.get("itemClass").and_then(|v| v.as_u64()).unwrap_or(0);
                let item_subclass = raw
                    .get("itemSubClass")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                if item_class == 2 && !weapons.contains(&item_subclass) {
                    weapon_excluded = true;
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
            .sort_by_key(|a| std::cmp::Reverse(a.ilevel));
    }

    // Mark items that can be converted via catalyst
    if let Some(class_id) = class_data::class_wow_id(class_name) {
        mark_catalyst_eligible(&mut slots, class_id);
    }

    // Mark items eligible for Void Forge conversion (per-item button).
    mark_void_forge_eligible(&mut slots);

    // Catalyst pass: generate tier alternatives for non-tier items in tier slots
    if catalyst_charges.is_some() {
        if let Some(class_id) = class_data::class_wow_id(class_name) {
            generate_catalyst_alternatives(&mut slots, class_id);
        }
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
        catalyst_charges,
    }
}

/// Inventory type for each slot (used for catalyst item lookup).
pub fn slot_to_inv_type(slot: &str) -> Option<u64> {
    match slot {
        "head" => Some(1),
        "shoulder" => Some(3),
        "chest" => Some(5),
        "hands" => Some(10),
        "legs" => Some(7),
        "back" => Some(16),
        "wrist" => Some(9),
        "feet" => Some(8),
        "waist" => Some(6),
        _ => None,
    }
}

/// Check if an item is on veteran track or higher.
fn is_minimum_veteran(upgrade: &str) -> bool {
    item_db::is_minimum_track(upgrade, "Veteran")
}

/// Build a catalyst variant of a source item for a given slot.
pub fn build_catalyst_item(
    source: &ResolvedItem,
    tier_info: &item_db::CatalystTierItem,
    slot: &str,
) -> ResolvedItem {
    let tier_item_id = tier_info.item_id;

    // Build catalyst bonus_ids: keep only ilevel-related bonuses from the source,
    // then add the tier set marker bonus for tier set items.
    let mut catalyst_bonus_ids = item_db::filter_ilevel_bonus_ids(&source.bonus_ids);
    if tier_info.has_set {
        catalyst_bonus_ids.push(item_db::tier_set_bonus_id());
    }
    catalyst_bonus_ids.sort();

    // Build simc_string
    let bonus_str = catalyst_bonus_ids
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join("/");
    let mut simc_parts = vec![format!(",id={}", tier_item_id)];
    if !bonus_str.is_empty() {
        simc_parts.push(format!(",bonus_id={}", bonus_str));
    }
    if source.enchant_id > 0 {
        simc_parts.push(format!(",enchant_id={}", source.enchant_id));
    }
    if source.gem_id > 0 {
        simc_parts.push(format!(",gem_id={}", source.gem_id));
    }
    let new_simc = simc_parts.join("");

    // Enrich from the tier item
    let (name, icon, quality, tag, upgrade) =
        if let Some(info) = item_db::get_item_info(tier_item_id, Some(&catalyst_bonus_ids)) {
            (info.name, info.icon, info.quality, info.tag, info.upgrade)
        } else {
            (
                tier_info.name.clone(),
                tier_info.icon.clone(),
                4,
                String::new(),
                String::new(),
            )
        };

    let bonus_key = catalyst_bonus_ids
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(":");
    let uid = format!(
        "{}:{}:{}:{}",
        tier_item_id,
        bonus_key,
        source.origin.as_str(),
        slot
    );

    ResolvedItem {
        uid,
        slot: slot.to_string(),
        item_id: tier_item_id,
        ilevel: source.ilevel,
        simc_string: new_simc,
        origin: source.origin,
        bonus_ids: catalyst_bonus_ids,
        enchant_id: source.enchant_id,
        gem_id: source.gem_id,
        name,
        icon,
        quality,
        quality_color: class_data::quality_color(quality).to_string(),
        tag,
        upgrade,
        sockets: 0,
        enchant_name: source.enchant_name.clone(),
        enchant_item_id: source.enchant_item_id,
        gem_name: source.gem_name.clone(),
        gem_icon: source.gem_icon.clone(),
        season_id: source.season_id,
        is_catalyst: true,
        can_catalyst: false,
        is_void_forge: false,
        can_void_forge: false,
    }
}

/// Mark all items that are eligible for catalyst conversion with `can_catalyst = true`.
fn mark_catalyst_eligible(slots: &mut HashMap<String, SlotResolution>, wow_class_id: u64) {
    let current_season = item_db::current_season_id();

    for (slot_key, slot_res) in slots.iter_mut() {
        let inv_type = match slot_to_inv_type(slot_key) {
            Some(t) => t,
            None => continue,
        };
        let tier_info = match item_db::catalyst_tier_item(wow_class_id, inv_type) {
            Some(t) => t,
            None => continue,
        };

        let check = |item: &ResolvedItem| -> bool {
            !item.is_catalyst
                && item.season_id == current_season
                && is_minimum_veteran(&item.upgrade)
                && item.item_id != tier_info.item_id
        };

        if let Some(ref mut eq) = slot_res.equipped {
            if check(eq) {
                eq.can_catalyst = true;
            }
        }
        for alt in &mut slot_res.alternatives {
            if check(alt) {
                alt.can_catalyst = true;
            }
        }
    }
}

/// Generate catalyst alternatives across all slots.
/// For each slot, checks every item (equipped + bag). If the item is minimum
/// veteran track and a catalyst conversion exists, creates the catalyst variant
/// unless an identical or higher-ilevel version already exists in that slot.
fn generate_catalyst_alternatives(slots: &mut HashMap<String, SlotResolution>, wow_class_id: u64) {
    let slot_keys: Vec<String> = slots.keys().cloned().collect();

    for slot_key in &slot_keys {
        let inv_type = match slot_to_inv_type(slot_key) {
            Some(t) => t,
            None => continue,
        };
        let tier_info = match item_db::catalyst_tier_item(wow_class_id, inv_type) {
            Some(t) => t,
            None => continue,
        };

        let slot_res = match slots.get(slot_key.as_str()) {
            Some(s) => s,
            None => continue,
        };

        // Collect all items in this slot (equipped + alternatives)
        let mut sources: Vec<ResolvedItem> = Vec::new();
        if let Some(ref eq) = slot_res.equipped {
            sources.push(eq.clone());
        }
        sources.extend(slot_res.alternatives.iter().cloned());

        // Collect existing item_ids and their ilevels in this slot for dedup
        let mut existing: HashMap<u64, u64> = HashMap::new();
        if let Some(ref eq) = slot_res.equipped {
            existing.insert(eq.item_id, eq.ilevel);
        }
        for alt in &slot_res.alternatives {
            let entry = existing.entry(alt.item_id).or_insert(0);
            if alt.ilevel > *entry {
                *entry = alt.ilevel;
            }
        }

        let current_season = item_db::current_season_id();

        // Find the best catalyst candidate: highest ilevel, tiebreak by upgrade track rank
        let mut best: Option<ResolvedItem> = None;

        for source in &sources {
            if source.is_catalyst {
                continue;
            }
            if source.season_id != current_season {
                continue;
            }
            if !is_minimum_veteran(&source.upgrade) {
                continue;
            }
            if source.item_id == tier_info.item_id {
                continue;
            }

            let catalyst_item = build_catalyst_item(source, tier_info, slot_key);

            // Skip if an existing (non-catalyst) item already has this tier item at same+ ilevel
            if let Some(&existing_ilevel) = existing.get(&catalyst_item.item_id) {
                if existing_ilevel >= catalyst_item.ilevel {
                    continue;
                }
            }

            let dominated = if let Some(ref current_best) = best {
                if catalyst_item.ilevel > current_best.ilevel {
                    false
                } else if catalyst_item.ilevel < current_best.ilevel {
                    true
                } else {
                    // Same ilevel — compare upgrade track rank (higher = better)
                    let new_rank = item_db::track_rank(&catalyst_item.upgrade).unwrap_or(0);
                    let cur_rank = item_db::track_rank(&current_best.upgrade).unwrap_or(0);
                    new_rank <= cur_rank
                }
            } else {
                false
            };

            if !dominated {
                best = Some(catalyst_item);
            }
        }

        if let Some(catalyst_item) = best {
            if let Some(slot_res) = slots.get_mut(slot_key.as_str()) {
                slot_res.alternatives.push(catalyst_item);
            }
        }
    }
}

/// Build a Void Forge variant of a source item: same item_id, swapped bonus_id,
/// recomputed ilevel and simc_string, tag and upgrade fields refreshed from the
/// VF bonus entry so the UI can distinguish it from the base item.
pub fn build_void_forge_item(source: &ResolvedItem, vf_bonus_id: u64) -> ResolvedItem {
    // Replace the matching base bonus_id with the VF variant.
    let vf_map = item_db::void_forge_map();
    let mut new_bonus_ids: Vec<u64> = source
        .bonus_ids
        .iter()
        .map(|b| vf_map.get(b).copied().unwrap_or(*b))
        .collect();
    new_bonus_ids.sort();

    // Recompute ilvl + tag + upgrade from the VF bonus entry.
    let mut ilevel = source.ilevel;
    let mut tag = source.tag.clone();
    let mut upgrade = source.upgrade.clone();
    if let Some(vf_value) = item_db::bonuses().get(&vf_bonus_id) {
        if let Some(amount) = vf_value
            .get("itemLevel")
            .and_then(|i| i.get("amount"))
            .and_then(|a| a.as_u64())
        {
            ilevel = amount;
        }
        if let Some(t) = vf_value.get("tag").and_then(|t| t.as_str()) {
            tag = t.to_string();
        }
        if let Some(u) = vf_value.get("upgrade").and_then(|u| u.as_str()) {
            upgrade = u.to_string();
        } else {
            upgrade = String::new();
        }
    }

    // Rewrite bonus_id=... in simc_string.
    let bonus_id_re = &*RE_BONUS_ID_NO_COLON;
    let bonus_id_str = new_bonus_ids
        .iter()
        .map(u64::to_string)
        .collect::<Vec<_>>()
        .join("/");
    let new_simc = bonus_id_re
        .replace(&source.simc_string, format!("bonus_id={}", bonus_id_str))
        .to_string();

    // Compute fresh uid based on the NEW bonus_ids — must match the frontend's
    // deterministic format (itemId:sortedBonusIds:origin:slot). Inheriting the
    // source's uid via ..source.clone() would collide with the base item and
    // make the VF alternative invisible to combo selection.
    let bonus_key = new_bonus_ids
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(":");
    let uid = format!(
        "{}:{}:{}:{}",
        source.item_id,
        bonus_key,
        source.origin.as_str(),
        source.slot
    );

    ResolvedItem {
        uid,
        bonus_ids: new_bonus_ids,
        ilevel,
        tag,
        upgrade,
        simc_string: new_simc,
        is_void_forge: true,
        can_void_forge: false,
        // Everything else copied from source — same item, just upgraded
        ..source.clone()
    }
}

/// Mark weapons and trinkets that have a Void Forge map key as `can_void_forge = true`.
/// This drives the per-item "Convert to Void Forge" button visibility on the frontend.
pub fn mark_void_forge_eligible(slots: &mut HashMap<String, SlotResolution>) {
    const VF_SLOTS: &[&str] = &["main_hand", "off_hand", "trinket1", "trinket2"];
    let vf_map = item_db::void_forge_map();
    if vf_map.is_empty() {
        return;
    }

    let mark = |item: &mut ResolvedItem| {
        if item.is_void_forge {
            return;
        }
        if !VF_SLOTS.contains(&item.slot.as_str()) {
            return;
        }
        if item.bonus_ids.iter().any(|b| vf_map.contains_key(b)) {
            item.can_void_forge = true;
        }
    };

    for slot in slots.values_mut() {
        if let Some(eq) = slot.equipped.as_mut() {
            mark(eq);
        }
        for alt in slot.alternatives.iter_mut() {
            mark(alt);
        }
    }
}

/// Generate Void Forge variants for weapons and trinkets whose bonus_ids
/// contain a VF map key. Appends to each slot's alternatives.
pub fn generate_void_forge_alternatives(slots: &mut HashMap<String, SlotResolution>) {
    const VF_SLOTS: &[&str] = &["main_hand", "off_hand", "trinket1", "trinket2"];
    let vf_map = item_db::void_forge_map();
    if vf_map.is_empty() {
        return;
    }

    for slot_name in VF_SLOTS {
        let Some(slot_res) = slots.get_mut(*slot_name) else {
            continue;
        };

        // Collect VF variants from both equipped and alternatives (but not from
        // existing catalyst variants — VF a catalyst-converted item is out of scope).
        let mut additions: Vec<ResolvedItem> = Vec::new();
        let mut consider = |item: &ResolvedItem| {
            if item.is_void_forge || item.is_catalyst {
                return;
            }
            // Find the first VF-mapped bonus_id on this item.
            let Some(vf_target) = item.bonus_ids.iter().find_map(|b| vf_map.get(b).copied()) else {
                return;
            };
            additions.push(build_void_forge_item(item, vf_target));
        };

        if let Some(eq) = slot_res.equipped.as_ref() {
            consider(eq);
        }
        for alt in slot_res.alternatives.iter() {
            consider(alt);
        }

        slot_res.alternatives.extend(additions);
    }
}
