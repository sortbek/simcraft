use std::collections::HashMap;

use actix_web::{web, HttpResponse};
use serde_json::{json, Value};

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
/// `bonus_ids` is taken verbatim (the frontend already composed the final list:
/// chosen item-level track bonus + extra_bonus_ids).
pub(super) fn drop_to_raw_item(drop: &Value) -> Option<RawParsedItem> {
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
    let bonus_ids: Vec<u64> = drop
        .get("bonus_ids")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|b| b.as_u64()).collect())
        .unwrap_or_default();

    let bonus_str = bonus_ids
        .iter()
        .map(u64::to_string)
        .collect::<Vec<_>>()
        .join("/");
    let simc_string = if bonus_str.is_empty() {
        format!(",id={}", item_id)
    } else {
        format!(",id={},bonus_id={}", item_id, bonus_str)
    };

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
    })
}

/// Resolve drops in isolation: parse the simc input only for character/spec
/// context, then resolve a ParseResult containing ONLY the drops (origin Loot).
/// resolve_gear places each drop as an alternative in every eligible slot
/// (rings -> finger1+finger2, trinkets -> trinket1+trinket2). The resolver
/// never infers variant status, so re-stamp is_void_forge / is_catalyst from
/// the drop payload (matched on item_id + sorted bonus_ids).
pub(super) fn resolve_drops_to_items(simc_input: &str, drops: &[Value]) -> Vec<ResolvedItem> {
    let parsed = addon_parser::parse_simc_input(simc_input);
    let raw_items: Vec<RawParsedItem> = drops.iter().filter_map(drop_to_raw_item).collect();
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

    // (item_id, sorted bonus_ids) -> (is_void_forge, is_catalyst)
    let mut flags: HashMap<(u64, Vec<u64>), (bool, bool)> = HashMap::new();
    for drop in drops {
        let Some(item_id) = drop.get("item_id").and_then(|v| v.as_u64()) else {
            continue;
        };
        let mut b: Vec<u64> = drop
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_u64()).collect())
            .unwrap_or_default();
        b.sort();
        let vf = drop.get("is_void_forge").and_then(|v| v.as_bool()).unwrap_or(false);
        let cat = drop.get("is_catalyst").and_then(|v| v.as_bool()).unwrap_or(false);
        flags.insert((item_id, b), (vf, cat));
    }

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
    let items = resolve_drops_to_items(&req.simc_input, &req.drop_items);
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
        let items = resolve_drops_to_items(MAGE_HEADER, &drops);
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
        let items = resolve_drops_to_items(MAGE_HEADER, &drops);
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
        let item = drop_to_raw_item(&drop).expect("some");
        assert_eq!(item.item_id, 212448);
        assert_eq!(item.raw_slot, "finger1");
        assert_eq!(item.origin, ItemOrigin::Bags);
        assert_eq!(item.simc_string, ",id=212448,bonus_id=10/20");
        assert_eq!(item.bonus_ids, vec![10, 20]);
    }

    #[test]
    fn drop_to_raw_item_no_bonus_omits_bonus_clause() {
        let drop = json!({ "item_id": 5, "inventory_type": 1, "bonus_ids": [] });
        let item = drop_to_raw_item(&drop).expect("some");
        assert_eq!(item.simc_string, ",id=5");
        assert_eq!(item.raw_slot, "head");
    }

    #[test]
    fn drop_to_raw_item_rejects_zero_id() {
        assert!(drop_to_raw_item(&json!({ "item_id": 0 })).is_none());
        assert!(drop_to_raw_item(&json!({})).is_none());
    }
}
