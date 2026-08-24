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
static RE_BONUS_ID_NO_COLON: Lazy<Regex> = Lazy::new(|| Regex::new(r"bonus_id=([0-9/]+)").unwrap());

/// Suffix for manual (user-edited) items so gem/enchant variants of the same
/// base item keep distinct uids and dedup keys. Must stay deterministic from
/// the simc string alone: build_modified_item reproduces it for the frontend.
pub(crate) fn manual_suffix(simc: &str) -> String {
    let gems = crate::simc_string::extract_gem_ids(simc)
        .iter()
        .map(|g| g.to_string())
        .collect::<Vec<_>>()
        .join("/");
    format!(
        ":m:e{}:g{}",
        crate::simc_string::extract_enchant_id(simc),
        gems
    )
}

/// Build a stable UID for deduplication: "item_id:sorted_bonus_ids:origin:raw_slot"
fn make_uid(item: &RawParsedItem) -> String {
    let mut sorted = item.bonus_ids.clone();
    sorted.sort();
    let bonus_key = sorted
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(":");
    let mut uid = format!(
        "{}:{}:{}:{}",
        item.item_id,
        bonus_key,
        item.origin.as_str(),
        item.raw_slot
    );
    if item.manual {
        uid.push_str(&manual_suffix(&item.simc_string));
    }
    uid
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
    let mut key = format!("{}:{}", item.item_id, bonus_key);
    if item.manual {
        key.push_str(&manual_suffix(&item.simc_string));
    }
    key
}

/// Enchant display name + scroll item id (empty/0 when unenchanted).
fn enchant_display(enchant_id: u64) -> (String, u64) {
    if enchant_id == 0 {
        return (String::new(), 0);
    }
    item_db::get_enchant_info(enchant_id)
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
}

/// Gem display name + icon (empty when unsocketed).
fn gem_display(gem_id: u64) -> (String, String) {
    if gem_id == 0 {
        return (String::new(), String::new());
    }
    item_db::get_gem_info(gem_id)
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

    let (enchant_name, enchant_item_id) = enchant_display(item.enchant_id);
    let (gem_name, gem_icon) = gem_display(item.gem_id);

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
        gem_ids: crate::simc_string::extract_gem_ids(&item.simc_string),
        is_manual: item.manual,
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
        source_item_id: 0,
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
    // Catalysed pieces keep the source item's secondary stats.
    simc_parts.push(item_db::redirected_base_stats_fragment(
        true,
        source.item_id,
    ));
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
    // Source id included: two sources convert to the same tier piece but keep
    // their own secondaries, so they are distinct items.
    let uid = format!(
        "{}:{}:{}:{}:{}",
        tier_item_id,
        bonus_key,
        source.origin.as_str(),
        slot,
        source.item_id
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
        // The built string emits at most the source's single gem.
        gem_ids: if source.gem_id > 0 {
            vec![source.gem_id]
        } else {
            Vec::new()
        },
        is_manual: source.is_manual,
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
        source_item_id: source.item_id,
        can_catalyst: false,
        is_void_forge: false,
        can_void_forge: false,
    }
}

/// Build a user-edited copy of an item with the given gems and enchant applied.
/// The uid carries the manual suffix so the copy round-trips through
/// `# manual.{slot}=` lines and resolve with an identical identity.
pub fn build_modified_item(
    source: &ResolvedItem,
    gem_ids: &[u64],
    enchant_id: u64,
) -> ResolvedItem {
    let with_gems = crate::simc_string::set_gem_ids(&source.simc_string, gem_ids);
    let new_simc = if enchant_id > 0 {
        crate::simc_string::set_enchant_id(&with_gems, enchant_id)
    } else {
        crate::simc_string::strip_enchant_id(&with_gems)
    };

    let (enchant_name, enchant_item_id) = enchant_display(enchant_id);
    let first_gem = gem_ids.first().copied().unwrap_or(0);
    let (gem_name, gem_icon) = gem_display(first_gem);

    let mut sorted = source.bonus_ids.clone();
    sorted.sort();
    let bonus_key = sorted
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(":");
    let uid = format!(
        "{}:{}:{}:{}{}",
        source.item_id,
        bonus_key,
        ItemOrigin::Bags.as_str(),
        source.slot,
        manual_suffix(&new_simc)
    );

    ResolvedItem {
        uid,
        simc_string: new_simc,
        origin: ItemOrigin::Bags,
        enchant_id,
        gem_id: first_gem,
        gem_ids: gem_ids.to_vec(),
        is_manual: true,
        enchant_name,
        enchant_item_id,
        gem_name,
        gem_icon,
        is_catalyst: false,
        source_item_id: 0,
        can_catalyst: false,
        is_void_forge: false,
        can_void_forge: false,
        ..source.clone()
    }
}

/// Whether an item can be fed to the catalyst: current-season gear on at least the
/// Veteran track, or current-season fixed-difficulty gear whose item level comes
/// from a bonus outside the upgrade-track system and so has no track or season id
/// (`is_fixed_difficulty_bonus` only indexes this season's encounters).
/// Crafted gear never qualifies.
fn is_catalyst_source(item: &ResolvedItem, tier_item_id: u64) -> bool {
    if item.is_catalyst || item.item_id == tier_item_id || item_db::is_crafted_item(item.item_id) {
        return false;
    }
    if item
        .bonus_ids
        .iter()
        .any(|&b| item_db::is_fixed_difficulty_bonus(b))
    {
        return true;
    }
    item.season_id == item_db::current_season_id() && is_minimum_veteran(&item.upgrade)
}

/// Mark all items that are eligible for catalyst conversion with `can_catalyst = true`.
fn mark_catalyst_eligible(slots: &mut HashMap<String, SlotResolution>, wow_class_id: u64) {
    for (slot_key, slot_res) in slots.iter_mut() {
        let inv_type = match slot_to_inv_type(slot_key) {
            Some(t) => t,
            None => continue,
        };
        let tier_info = match item_db::catalyst_tier_item(wow_class_id, inv_type) {
            Some(t) => t,
            None => continue,
        };

        if let Some(ref mut eq) = slot_res.equipped {
            if is_catalyst_source(eq, tier_info.item_id) {
                eq.can_catalyst = true;
            }
        }
        for alt in &mut slot_res.alternatives {
            if is_catalyst_source(alt, tier_info.item_id) {
                alt.can_catalyst = true;
            }
        }
    }
}

/// Generate catalyst alternatives across all slots.
/// For each slot, checks every item (equipped + bag). If the item is a valid
/// catalyst source (see `is_catalyst_source`) and a catalyst conversion exists,
/// creates the catalyst variant unless an identical or higher-ilevel version
/// already exists in that slot.
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

        // One conversion per source: sources that tie on ilevel still differ in
        // secondary stats (see `redirected_base_stats`), so collapsing to a
        // single "best" would pick one arbitrarily and hide the rest.
        let mut candidates: Vec<ResolvedItem> = Vec::new();

        for source in &sources {
            if !is_catalyst_source(source, tier_info.item_id) {
                continue;
            }

            let catalyst_item = build_catalyst_item(source, tier_info, slot_key);

            // Skip if an existing (non-catalyst) item already has this tier item at same+ ilevel
            if let Some(&existing_ilevel) = existing.get(&catalyst_item.item_id) {
                if existing_ilevel >= catalyst_item.ilevel {
                    continue;
                }
            }

            candidates.push(catalyst_item);
        }

        // Best-first and deterministic: ilevel, then upgrade track rank, then source id.
        candidates.sort_by_cached_key(|c| {
            (
                std::cmp::Reverse(c.ilevel),
                std::cmp::Reverse(item_db::track_rank(&c.upgrade).unwrap_or(0)),
                c.source_item_id,
            )
        });

        if let Some(slot_res) = slots.get_mut(slot_key.as_str()) {
            slot_res.alternatives.extend(candidates);
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
        gem_ids: crate::simc_string::extract_gem_ids(&new_simc),
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

#[cfg(test)]
mod catalyst_tests {
    use super::*;
    use crate::test_support::ensure_game_data_loaded;

    /// `(encounter_id, "mythic" bonus_id)` pairs from both fixed-difficulty
    /// config shapes (`encounterFixedDifficulty` + `encounterDifficultyOverride`).
    fn fixed_difficulty_encounter_bonuses() -> Vec<(i64, u64)> {
        ["encounterFixedDifficulty", "encounterDifficultyOverride"]
            .iter()
            .filter_map(|key| item_db::season_cfg().get(key)?.as_object())
            .flat_map(|encounters| {
                encounters.iter().filter_map(|(eid, diffs)| {
                    let bonus = diffs.get("mythic")?.get("bonus_id")?.as_u64()?;
                    Some((eid.parse::<i64>().ok()?, bonus))
                })
            })
            .collect()
    }

    /// A "mythic" bonus id from one of the *current season's* fixed-difficulty
    /// encounters (its encounter is in the season raid pool). These set an item
    /// level directly and carry no upgrade track, so they exercise the
    /// non-track catalyst path.
    ///
    /// `None` when the loaded season has no such encounter — fixed-difficulty
    /// encounters are an occasional feature, not a permanent one, so these tests
    /// report and skip rather than fail a season roll (and, via the pre-commit
    /// hook, block every commit until someone rewrites them).
    fn fixed_difficulty_bonus_id() -> Option<u64> {
        let pool = item_db::season_pool_encounter_ids();
        fixed_difficulty_encounter_bonuses()
            .into_iter()
            .find(|(eid, _)| pool.contains(eid))
            .map(|(_, bonus)| bonus)
    }

    /// A fixed-difficulty bonus id whose encounter is NOT in the current season
    /// raid pool (e.g. Sporefall's Sporefused gear after the S2 roll). `None`
    /// when every configured entry is current-season or no pool is configured.
    fn previous_season_fixed_difficulty_bonus_id() -> Option<u64> {
        let pool = item_db::season_pool_encounter_ids();
        if pool.is_empty() {
            return None;
        }
        fixed_difficulty_encounter_bonuses()
            .into_iter()
            .find(|(eid, _)| !pool.contains(eid))
            .map(|(_, bonus)| bonus)
    }

    /// `fixed_difficulty_bonus_id`, announcing the skip so a silently-inapplicable
    /// test can't masquerade as a passing one.
    fn fixed_difficulty_bonus_id_or_skip(test: &str) -> Option<u64> {
        let found = fixed_difficulty_bonus_id();
        if found.is_none() {
            eprintln!("SKIP {test}: loaded season defines no fixed-difficulty encounter");
        }
        found
    }

    /// Equipped head with `bonus_id`. The item id is synthetic: equipped items skip
    /// the DB-driven armor filter, so the bonus alone drives what's under test.
    fn resolved_head(bonus_id: u64) -> SlotResolution {
        let profile = format!(
            "druid=\"Test\"\nlevel=80\nspec=feral\n\nhead=,id=999001,bonus_id={}\n",
            bonus_id
        );
        let parsed = crate::addon_parser::parse_simc_input(&profile);
        resolve_gear_with_catalyst(&parsed, Some(1))
            .slots
            .remove("head")
            .expect("head slot resolved")
    }

    #[test]
    fn fixed_difficulty_gear_is_catalyst_eligible() {
        ensure_game_data_loaded();
        let Some(bonus_id) = fixed_difficulty_bonus_id_or_skip("catalyst_eligible") else {
            return;
        };
        let head = resolved_head(bonus_id);
        let equipped = head.equipped.as_ref().expect("equipped head");

        assert!(
            equipped.upgrade.is_empty(),
            "precondition: fixed-difficulty gear carries no upgrade track"
        );
        assert!(
            equipped.can_catalyst,
            "fixed-difficulty gear should be catalyst-eligible"
        );
    }

    #[test]
    fn fixed_difficulty_gear_gets_a_catalyst_alternative_at_its_own_ilevel() {
        ensure_game_data_loaded();
        let Some(bonus_id) = fixed_difficulty_bonus_id_or_skip("catalyst_alternative") else {
            return;
        };
        let head = resolved_head(bonus_id);
        let source_ilevel = head.equipped.as_ref().expect("equipped head").ilevel;

        let catalyst = head
            .alternatives
            .iter()
            .find(|a| a.is_catalyst)
            .expect("a catalyst alternative should be generated");
        assert_eq!(
            catalyst.ilevel, source_ilevel,
            "catalyst piece keeps the source item level"
        );
    }

    /// A Veteran-or-better upgrade-track bonus id for the given season, from the
    /// loaded bonus data. `None` when that season has no such track in the data.
    fn veteran_track_bonus_id(season_id: u64) -> Option<u64> {
        item_db::bonuses().iter().find_map(|(bid, bonus)| {
            let upgrade = bonus.get("upgrade")?;
            if upgrade.get("seasonId")?.as_u64()? != season_id {
                return None;
            }
            let full_name = upgrade.get("fullName")?.as_str()?;
            item_db::is_minimum_track(full_name, "Veteran").then_some(*bid)
        })
    }

    #[test]
    fn previous_season_gear_is_not_catalyst_eligible() {
        ensure_game_data_loaded();
        let current = item_db::current_season_id();

        // Current-season control first: proves this harness produces eligible
        // items at all, so the previous-season assertion can't pass vacuously.
        let current_bonus =
            veteran_track_bonus_id(current).expect("current season has Veteran+ track bonuses");
        let head = resolved_head(current_bonus);
        assert!(
            head.equipped.as_ref().expect("equipped head").can_catalyst,
            "current-season Veteran+ gear should be catalyst-eligible"
        );

        let Some(previous_bonus) = (1..current).rev().find_map(veteran_track_bonus_id) else {
            eprintln!("SKIP previous_season: loaded data has only one season of upgrade bonuses");
            return;
        };
        let head = resolved_head(previous_bonus);
        assert!(
            !head.equipped.as_ref().expect("equipped head").can_catalyst,
            "previous-season gear must not be catalyst-eligible"
        );
        assert!(
            !head.alternatives.iter().any(|a| a.is_catalyst),
            "previous-season gear must not generate catalyst alternatives"
        );
    }

    #[test]
    fn previous_season_fixed_difficulty_gear_is_not_catalyst_eligible() {
        ensure_game_data_loaded();
        let Some(bonus_id) = previous_season_fixed_difficulty_bonus_id() else {
            eprintln!(
                "SKIP previous_season_fixed_difficulty: config has no out-of-pool fixed-difficulty encounter"
            );
            return;
        };
        let head = resolved_head(bonus_id);
        assert!(
            !head.equipped.as_ref().expect("equipped head").can_catalyst,
            "previous-season fixed-difficulty gear must not be catalyst-eligible"
        );
        assert!(
            !head.alternatives.iter().any(|a| a.is_catalyst),
            "previous-season fixed-difficulty gear must not generate catalyst alternatives"
        );
    }

    #[test]
    fn catalyst_item_redirects_base_stats_to_the_source() {
        ensure_game_data_loaded();
        let profile = "mage=\"Test\"\nlevel=80\nspec=frost\n\nhead=,id=251199\n";
        let parsed = crate::addon_parser::parse_simc_input(profile);
        let resolved = resolve_gear_with_catalyst(&parsed, Some(1));
        let head = resolved.slots.get("head").expect("head slot resolved");
        let source = head.equipped.as_ref().expect("equipped head");

        let class_id = class_data::class_wow_id("mage").expect("mage class id");
        let tier = item_db::catalyst_tier_item(class_id, 1).expect("mage head tier item");
        let catalyst = build_catalyst_item(source, tier, "head");

        assert!(
            catalyst
                .simc_string
                .contains(&format!("redirected_base_stats={}", source.item_id)),
            "catalyst simc string must redirect base stats to the source item, got: {}",
            catalyst.simc_string
        );
        assert!(
            catalyst
                .simc_string
                .contains(&format!("id={}", catalyst.item_id)),
            "catalyst simc string keeps the tier item id, got: {}",
            catalyst.simc_string
        );
    }

    #[test]
    fn catalyst_copy_inherits_is_manual_from_its_source() {
        ensure_game_data_loaded();
        let profile = "mage=\"Test\"\nlevel=80\nspec=frost\n\nhead=,id=251199\n";
        let parsed = crate::addon_parser::parse_simc_input(profile);
        let resolved = resolve_gear_with_catalyst(&parsed, Some(1));
        let source = resolved.slots["head"]
            .equipped
            .as_ref()
            .expect("equipped head");

        let class_id = class_data::class_wow_id("mage").expect("mage class id");
        let tier = item_db::catalyst_tier_item(class_id, 1).expect("mage head tier item");

        assert!(!build_catalyst_item(source, tier, "head").is_manual);
        // The copy carries the source's enchant verbatim, so a manual source's
        // cleared enchant must stay exempt from copy-enchants after conversion.
        let manual = build_modified_item(source, &[], 0);
        assert!(build_catalyst_item(&manual, tier, "head").is_manual);
    }
}

#[cfg(test)]
mod gem_ids_tests {
    use super::*;
    use crate::test_support::ensure_game_data_loaded;

    #[test]
    fn enrich_populates_full_gem_id_list() {
        ensure_game_data_loaded();
        let profile = "druid=\"T\"\nlevel=80\nspec=feral\n\nneck=,id=999001,gem_id=213470/213473,enchant_id=7334\n";
        let parsed = crate::addon_parser::parse_simc_input(profile);
        let resolved = resolve_gear(&parsed);
        let equipped = resolved.slots["neck"]
            .equipped
            .as_ref()
            .expect("equipped neck");
        assert_eq!(equipped.gem_ids, vec![213470, 213473]);
        assert_eq!(equipped.gem_id, 213470);
    }
}

#[cfg(test)]
mod manual_item_tests {
    use super::*;
    use crate::test_support::ensure_game_data_loaded;

    const BASE: &str =
        "druid=\"T\"\nlevel=80\nspec=feral\n\nneck=,id=999001,gem_id=213470,enchant_id=7334\n";

    #[test]
    fn plain_bag_copy_with_same_bonus_ids_is_deduped() {
        ensure_game_data_loaded();
        let input = format!("{BASE}# neck=,id=999001,gem_id=213473,enchant_id=7334\n");
        let resolved = resolve_gear(&crate::addon_parser::parse_simc_input(&input));
        // Documents the existing dedup behavior the manual channel exists to bypass.
        assert!(resolved.slots["neck"].alternatives.is_empty());
    }

    #[test]
    fn manual_copy_survives_dedup_with_suffixed_uid() {
        ensure_game_data_loaded();
        let input =
            format!("{BASE}# manual.neck=,id=999001,gem_id=213473/213470,enchant_id=7340\n");
        let resolved = resolve_gear(&crate::addon_parser::parse_simc_input(&input));
        let alts = &resolved.slots["neck"].alternatives;
        assert_eq!(alts.len(), 1);
        assert_eq!(alts[0].uid, "999001::bags:neck:m:e7340:g213473/213470");
        assert_eq!(alts[0].gem_ids, vec![213473, 213470]);
        assert_eq!(alts[0].enchant_id, 7340);
    }

    #[test]
    fn manual_line_sets_is_manual() {
        ensure_game_data_loaded();
        let input = format!("{BASE}# manual.neck=,id=999001,enchant_id=7340\n");
        let resolved = resolve_gear(&crate::addon_parser::parse_simc_input(&input));
        assert!(resolved.slots["neck"].alternatives[0].is_manual);
        assert!(!resolved.slots["neck"].equipped.as_ref().unwrap().is_manual);
    }

    #[test]
    fn identical_manual_copies_collapse() {
        ensure_game_data_loaded();
        let line = "# manual.neck=,id=999001,gem_id=213473,enchant_id=7340\n";
        let input = format!("{BASE}{line}{line}");
        let resolved = resolve_gear(&crate::addon_parser::parse_simc_input(&input));
        assert_eq!(resolved.slots["neck"].alternatives.len(), 1);
    }

    #[test]
    fn distinct_manual_gem_variants_both_survive() {
        ensure_game_data_loaded();
        let input = format!(
            "{BASE}# manual.neck=,id=999001,gem_id=213473,enchant_id=7334\n# manual.neck=,id=999001,enchant_id=7334\n"
        );
        let resolved = resolve_gear(&crate::addon_parser::parse_simc_input(&input));
        assert_eq!(resolved.slots["neck"].alternatives.len(), 2);
    }

    #[test]
    fn build_modified_item_sets_and_clears() {
        ensure_game_data_loaded();
        let resolved = resolve_gear(&crate::addon_parser::parse_simc_input(BASE));
        let equipped = resolved.slots["neck"].equipped.clone().unwrap();

        let set = build_modified_item(&equipped, &[213473, 213470], 7340);
        assert!(set.simc_string.contains("gem_id=213473/213470"));
        assert!(set.simc_string.contains("enchant_id=7340"));
        assert_eq!(set.gem_ids, vec![213473, 213470]);
        assert_eq!(set.gem_id, 213473);
        assert_eq!(set.enchant_id, 7340);
        assert_eq!(set.origin, ItemOrigin::Bags);

        let cleared = build_modified_item(&equipped, &[], 0);
        assert!(!cleared.simc_string.contains("gem_id="));
        assert!(!cleared.simc_string.contains("enchant_id="));
        assert!(cleared.gem_ids.is_empty());
        assert_eq!(cleared.enchant_id, 0);
        assert_eq!(cleared.gem_name, "");
        assert_eq!(cleared.enchant_name, "");
    }

    #[test]
    fn modified_item_uid_round_trips_through_resolve() {
        ensure_game_data_loaded();
        let resolved = resolve_gear(&crate::addon_parser::parse_simc_input(BASE));
        let equipped = resolved.slots["neck"].equipped.clone().unwrap();
        let modified = build_modified_item(&equipped, &[213473, 213470], 7340);

        let with_manual = format!("{BASE}# manual.neck={}\n", modified.simc_string);
        let re_resolved = resolve_gear(&crate::addon_parser::parse_simc_input(&with_manual));
        let alt = re_resolved.slots["neck"]
            .alternatives
            .iter()
            .find(|a| a.uid == modified.uid);
        assert!(
            alt.is_some(),
            "manual copy must resolve with an identical uid"
        );
    }
}
