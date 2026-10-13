use std::collections::HashMap;

use actix_web::{web, HttpResponse};
use serde_json::{json, Value};

use crate::profileset_generator::{CraftedEmbellishment, CraftedStats};
use crate::types::{ItemOrigin, ParseResult, RawParsedItem, ResolvedItem};
use crate::{addon_parser, gear_resolver};

/// Map an inventory type to a representative gear slot for `RawParsedItem.raw_slot`.
/// The resolver fans items to all eligible slots via item_db; raw_slot is only a
/// fallback, so the first eligible slot from the canonical mapping is sufficient.
pub(super) fn primary_slot_for_inv_type(inv_type: u64) -> &'static str {
    crate::types::class_data::inv_type_to_slots(inv_type, "")
        .first()
        .copied()
        .unwrap_or("main_hand")
}

/// Build a loot-origin RawParsedItem from a DropFinder drop payload.
/// `bonus_ids` starts from the request verbatim (the frontend already composed
/// the chosen item-level track bonus + extra_bonus_ids), then takes the crafted
/// picks: missives for crafted gear, the drop's embellishment bonuses. A
/// flexible-stat non-crafted item takes the pair as `crafted_stats=` instead,
/// the same per-item dispatch as the droptimizer generator. Picks must already
/// be validated (the resolve_drops handler does it).
pub(super) fn drop_to_raw_item(
    drop: &Value,
    crafted_stats: Option<CraftedStats>,
    embellishments: &HashMap<u64, CraftedEmbellishment>,
) -> Option<RawParsedItem> {
    let item_id = drop.get("item_id").and_then(|v| v.as_u64())?;
    if item_id == 0 {
        return None;
    }
    let ilevel = drop.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0);
    let name = drop
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let inv_type = drop
        .get("inventory_type")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let mut bonus_ids: Vec<u64> = drop
        .get("bonus_ids")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|b| b.as_u64()).collect())
        .unwrap_or_default();

    // Crafted gear carries the pair as missive bonus ids; a flexible-stat raid
    // BOE has no missive and needs `crafted_stats=`. Any other item ignores it.
    // item_db is only consulted when a pair was given.
    let mut missives: &[u64] = &[];
    let mut stat_param: Option<[u64; 2]> = None;
    if let Some(cs) = &crafted_stats {
        if crate::item_db::is_crafted_item(item_id) {
            missives = &cs.bonus_ids;
        } else if crate::item_db::has_flexible_stats(item_id) {
            stat_param = Some(cs.stat_ids);
        }
    }
    let embellishment_ids: &[u64] = drop
        .get("embellishment_id")
        .and_then(|v| v.as_u64())
        .and_then(|id| embellishments.get(&id))
        .map_or(&[], |e| &e.bonus_ids);
    for &id in missives.iter().chain(embellishment_ids) {
        if !bonus_ids.contains(&id) {
            bonus_ids.push(id);
        }
    }

    // Same as the droptimizer path: fold in the item's own effect bonuses, which
    // the request never carries.
    let applied = crate::item_db::with_item_effect_bonuses(item_id, &bonus_ids);

    let bonus_str = applied
        .iter()
        .map(u64::to_string)
        .collect::<Vec<_>>()
        .join("/");
    let mut simc_string = format!(",id={}", item_id);
    if let Some([a, b]) = stat_param {
        simc_string.push_str(&format!(",crafted_stats={}/{}", a, b));
    }
    if !bonus_str.is_empty() {
        simc_string.push_str(&format!(",bonus_id={}", bonus_str));
    }

    Some(RawParsedItem {
        raw_slot: primary_slot_for_inv_type(inv_type).to_string(),
        simc_string,
        item_id,
        ilevel,
        name,
        bonus_ids,
        enchant_id: 0,
        gem_id: 0,
        origin: ItemOrigin::Bags,
        manual: false,
        source_item_id: 0,
    })
}

/// Resolve drops in isolation: parse the simc input only for character/spec
/// context, then resolve a ParseResult containing ONLY the drops (origin Loot).
/// resolve_gear places each drop as an alternative in every eligible slot
/// (rings -> finger1+finger2, trinkets -> trinket1+trinket2). The resolver
/// never infers variant status, so re-stamp is_void_forge / is_catalyst from
/// the drop payload (matched on item_id + sorted composed bonus_ids).
pub(super) fn resolve_drops_to_items(
    simc_input: &str,
    drops: &[Value],
    crafted_stats: Option<CraftedStats>,
    embellishments: &HashMap<u64, CraftedEmbellishment>,
) -> Vec<ResolvedItem> {
    let parsed = addon_parser::parse_simc_input(simc_input);
    let mut raw_items: Vec<RawParsedItem> = Vec::new();
    // (item_id, sorted bonus_ids) -> (is_void_forge, is_catalyst). Keyed on the
    // composed bonus ids (with crafted picks), the same list the resolver keeps.
    let mut flags: HashMap<(u64, Vec<u64>), (bool, bool)> = HashMap::new();
    for drop in drops {
        let Some(raw) = drop_to_raw_item(drop, crafted_stats, embellishments) else {
            continue;
        };
        let mut b = raw.bonus_ids.clone();
        b.sort();
        let vf = drop
            .get("is_void_forge")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let cat = drop
            .get("is_catalyst")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        flags.insert((raw.item_id, b), (vf, cat));
        raw_items.push(raw);
    }
    if raw_items.is_empty() {
        return Vec::new();
    }

    let drop_parse = ParseResult {
        items: raw_items,
        character: parsed.character,
        base_profile: String::new(),
        talent_loadouts: Vec::new(),
    };
    let resolved = gear_resolver::resolve_gear(&drop_parse);

    let mut out: Vec<ResolvedItem> = Vec::new();
    for slot_res in resolved.slots.into_values() {
        for mut alt in slot_res.alternatives {
            let mut key_b = alt.bonus_ids.clone();
            key_b.sort();
            if let Some(&(vf, cat)) = flags.get(&(alt.item_id, key_b)) {
                alt.is_void_forge = vf;
                alt.is_catalyst = cat;
            }
            out.push(alt);
        }
    }
    out
}

pub(super) async fn resolve_drops(
    req: web::Json<crate::server::types::ResolveDropsRequest>,
) -> HttpResponse {
    // Same validation sequence as the droptimizer handler: fail loud on an
    // invalid pair or an unknown / inapplicable embellishment.
    let crafted_stats = match CraftedStats::resolve(req.preferred_crafted_stats) {
        Ok(cs) => cs,
        Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
    };
    // Only crafted items are listed as applicable, so this also enforces
    // crafted-only.
    let embellishments = match CraftedEmbellishment::resolve_picks(&req.drop_items) {
        Ok(e) => e,
        Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
    };
    let items = resolve_drops_to_items(
        &req.simc_input,
        &req.drop_items,
        crafted_stats,
        &embellishments,
    );
    HttpResponse::Ok().json(json!({ "items": items }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::ensure_game_data_loaded;
    use serde_json::json;

    // A minimal class/spec header so resolve_gear has character context.
    const MAGE_HEADER: &str = "mage=\"Test\"\nlevel=80\nspec=frost\n";

    #[test]
    fn resolve_drops_returns_enriched_alternative() {
        ensure_game_data_loaded();
        // RING_ITEM_ID must be a finger item (inventory_type 11) present in
        // backend/resources/data-compacted/equippable-items-full.json. Find one:
        //   grep -o '"[0-9]*":{"[^}]*"inventoryType":11' equippable-items-full.json | head
        const RING_ITEM_ID: u64 = 268290; // Sporecaller's Blooming Loop, inventoryType=11, no class restriction
        let drops = vec![json!({
            "item_id": RING_ITEM_ID,
            "inventory_type": 11,
            "bonus_ids": [],
            "ilevel": 600
        })];
        let items = resolve_drops_to_items(MAGE_HEADER, &drops, None, &HashMap::new());
        // A ring fans to BOTH finger slots.
        let slots: Vec<&str> = items.iter().map(|i| i.slot.as_str()).collect();
        assert!(slots.contains(&"finger1"), "got slots {:?}", slots);
        assert!(slots.contains(&"finger2"), "got slots {:?}", slots);
        assert!(items.iter().all(|i| i.item_id == RING_ITEM_ID));
        assert!(items.iter().all(|i| i.origin == ItemOrigin::Bags));
        assert!(items.iter().all(|i| !i.is_void_forge && !i.is_catalyst));
    }

    #[test]
    fn resolve_drops_stamps_variant_flags() {
        ensure_game_data_loaded();
        const HEAD_ITEM_ID: u64 = 263844; // Void Nemesis' Skullcap, inventoryType=1, cloth (subClass=1), no class restriction
        let drops = vec![json!({
            "item_id": HEAD_ITEM_ID,
            "inventory_type": 1,
            "bonus_ids": [],
            "ilevel": 600,
            "is_catalyst": true
        })];
        let items = resolve_drops_to_items(MAGE_HEADER, &drops, None, &HashMap::new());
        assert!(!items.is_empty());
        assert!(items.iter().all(|i| i.is_catalyst));
    }

    #[test]
    fn drop_to_raw_item_builds_simc_and_slot() {
        let drop = json!({
            "item_id": 212448,
            "ilevel": 639,
            "name": "Test Ring",
            "inventory_type": 11,
            "bonus_ids": [10, 20]
        });
        let item = drop_to_raw_item(&drop, None, &HashMap::new()).expect("some");
        assert_eq!(item.item_id, 212448);
        assert_eq!(item.raw_slot, "finger1");
        assert_eq!(item.origin, ItemOrigin::Bags);
        assert_eq!(item.simc_string, ",id=212448,bonus_id=10/20");
        assert_eq!(item.bonus_ids, vec![10, 20]);
    }

    #[test]
    fn drop_to_raw_item_no_bonus_omits_bonus_clause() {
        let drop = json!({ "item_id": 5, "inventory_type": 1, "bonus_ids": [] });
        let item = drop_to_raw_item(&drop, None, &HashMap::new()).expect("some");
        assert_eq!(item.simc_string, ",id=5");
        assert_eq!(item.raw_slot, "head");
    }

    const WARRIOR_HEADER: &str = "warrior=\"Test\"\nlevel=80\nspec=fury\n";
    const CRAFTED_BOOTS: u64 = 237828; // Spellbreaker's March, crafted plate boots
    const FLEXIBLE_BOE_NECK: u64 = 271638; // Bound Serpent's Jade Eye, raid BOE
    const FIXED_STAT_NECK: u64 = 268265; // ordinary raid neck, fixed secondaries

    fn pair(a: u64, b: u64) -> CraftedStats {
        CraftedStats::resolve(Some([a, b]))
            .expect("valid pair")
            .expect("pair given")
    }

    fn missives(cs: &CraftedStats) -> [u64; 2] {
        [
            crate::item_db::crafted_stat_bonus_id(cs.stat_ids[0]).expect("missive"),
            crate::item_db::crafted_stat_bonus_id(cs.stat_ids[1]).expect("missive"),
        ]
    }

    fn simc_bonus_ids(simc: &str) -> Vec<u64> {
        simc.split(',')
            .find_map(|part| part.strip_prefix("bonus_id="))
            .map(|ids| ids.split('/').filter_map(|b| b.parse().ok()).collect())
            .unwrap_or_default()
    }

    fn drop_json(item_id: u64, inv_type: u64) -> Value {
        json!({
            "item_id": item_id,
            "inventory_type": inv_type,
            "bonus_ids": [],
            "ilevel": 600
        })
    }

    #[test]
    fn crafted_drop_takes_the_pair_as_missive_bonus_ids() {
        ensure_game_data_loaded();
        let cs = pair(36, 49);
        let drops = vec![drop_json(CRAFTED_BOOTS, 8)];
        let items = resolve_drops_to_items(WARRIOR_HEADER, &drops, Some(cs), &HashMap::new());
        assert!(!items.is_empty());
        for item in &items {
            let in_simc = simc_bonus_ids(&item.simc_string);
            for m in missives(&cs) {
                assert!(item.bonus_ids.contains(&m), "{:?}", item.bonus_ids);
                assert!(in_simc.contains(&m), "{}", item.simc_string);
            }
            assert!(!item.simc_string.contains("crafted_stats="));
        }
    }

    #[test]
    fn crafted_drop_takes_the_embellishment_bonus_ids() {
        ensure_game_data_loaded();
        let arcanoweave = crate::item_db::crafted_embellishments()
            .iter()
            .find(|e| e.name == "Arcanoweave Lining")
            .expect("Arcanoweave Lining in season list");
        let embellishment = CraftedEmbellishment::resolve(Some(arcanoweave.id))
            .expect("known embellishment")
            .expect("pick given");
        let mut embellishments = HashMap::new();
        embellishments.insert(arcanoweave.id, embellishment);
        let mut drop = drop_json(CRAFTED_BOOTS, 8);
        drop["embellishment_id"] = json!(arcanoweave.id);
        let items = resolve_drops_to_items(WARRIOR_HEADER, &[drop], None, &embellishments);
        assert!(!items.is_empty());
        assert!(!arcanoweave.bonus_ids.is_empty());
        for item in &items {
            let in_simc = simc_bonus_ids(&item.simc_string);
            for id in &arcanoweave.bonus_ids {
                assert!(item.bonus_ids.contains(id), "{:?}", item.bonus_ids);
                assert!(in_simc.contains(id), "{}", item.simc_string);
            }
        }
    }

    #[test]
    fn flexible_boe_takes_the_pair_as_crafted_stats() {
        ensure_game_data_loaded();
        let cs = pair(36, 49);
        let drops = vec![drop_json(FLEXIBLE_BOE_NECK, 2)];
        let items = resolve_drops_to_items(MAGE_HEADER, &drops, Some(cs), &HashMap::new());
        assert!(!items.is_empty());
        for item in &items {
            assert!(
                item.simc_string.contains(",crafted_stats=36/49"),
                "{}",
                item.simc_string
            );
            let in_simc = simc_bonus_ids(&item.simc_string);
            for m in missives(&cs) {
                assert!(!item.bonus_ids.contains(&m), "{:?}", item.bonus_ids);
                assert!(!in_simc.contains(&m), "{}", item.simc_string);
            }
        }
    }

    #[test]
    fn ineligible_item_ignores_the_pair() {
        ensure_game_data_loaded();
        assert!(!crate::item_db::accepts_preferred_stats(FIXED_STAT_NECK));
        let drops = vec![drop_json(FIXED_STAT_NECK, 2)];
        let by_slot = |items: Vec<ResolvedItem>| {
            let mut v: Vec<Value> = items
                .iter()
                .map(|i| serde_json::to_value(i).unwrap())
                .collect();
            v.sort_by_key(|i| i["slot"].as_str().unwrap_or("").to_string());
            v
        };
        let with_pair = by_slot(resolve_drops_to_items(
            MAGE_HEADER,
            &drops,
            Some(pair(36, 49)),
            &HashMap::new(),
        ));
        let without = by_slot(resolve_drops_to_items(
            MAGE_HEADER,
            &drops,
            None,
            &HashMap::new(),
        ));
        assert!(!without.is_empty());
        assert_eq!(with_pair, without);
    }

    #[test]
    fn same_crafted_item_with_different_pairs_gets_different_uids() {
        ensure_game_data_loaded();
        let drops = vec![drop_json(CRAFTED_BOOTS, 8)];
        let a = resolve_drops_to_items(WARRIOR_HEADER, &drops, Some(pair(36, 49)), &HashMap::new());
        let b = resolve_drops_to_items(WARRIOR_HEADER, &drops, Some(pair(32, 40)), &HashMap::new());
        assert!(!a.is_empty() && !b.is_empty());
        for x in &a {
            assert!(b.iter().all(|y| y.uid != x.uid), "uid collision: {}", x.uid);
        }
    }

    #[test]
    fn drop_to_raw_item_rejects_zero_id() {
        assert!(drop_to_raw_item(&json!({ "item_id": 0 }), None, &HashMap::new()).is_none());
        assert!(drop_to_raw_item(&json!({}), None, &HashMap::new()).is_none());
    }
}
