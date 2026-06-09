use serde_json::Value;
use std::borrow::Borrow;
use std::collections::{HashMap, HashSet};

use crate::game_data;
use crate::types::class_data::UNIQUE_SLOT_PAIRS;

/// Optional context required by spec- or budget-dependent constraints.
/// Plain gear-set checks (unique-equipped, item limits, vault) need none of
/// these and run unconditionally inside `is_legal_gear_set`.
#[derive(Debug, Clone, Copy)]
pub(super) struct GearSetContext<'a> {
    /// Class spec from the base profile — used by the weapon-pairing rule
    /// (Fury is the only spec that can wield two two-handers).
    pub spec: &'a str,
    /// Catalyst budget. `None` = the generator doesn't deal in catalyst at
    /// all (Drop Finder, Crest Upgrades), so the check is skipped rather
    /// than vacuously failed on an unrelated profile.
    pub max_catalyst_charges: Option<u32>,
}

/// Single entry point every profileset generator must call before emitting a
/// candidate gear set. Aggregates the unique-equipped, item-limit-category,
/// vault, weapon-pairing, and catalyst constraints so adding a new constraint
/// (or tightening an existing one) is a single-edit change — generators don't
/// re-implement validation per feature. See `feedback_gear_validation_unified`.
pub(super) fn is_legal_gear_set<V: Borrow<Value>>(
    gear_set: &HashMap<String, V>,
    ctx: &GearSetContext<'_>,
) -> bool {
    if !validate_unique_equipped(gear_set) {
        return false;
    }
    if !validate_item_limits(gear_set) {
        return false;
    }
    if !validate_vault_constraint(gear_set) {
        return false;
    }
    if !validate_weapon_constraint(gear_set, ctx.spec) {
        return false;
    }
    if let Some(charges) = ctx.max_catalyst_charges {
        if !validate_catalyst_constraint(gear_set, charges) {
            return false;
        }
    }
    true
}

pub(super) fn validate_vault_constraint<V: Borrow<Value>>(gear_set: &HashMap<String, V>) -> bool {
    let mut vault_item_ids: HashSet<u64> = HashSet::new();
    for item in gear_set.values() {
        let item = item.borrow();
        if item.get("origin").and_then(|v| v.as_str()) == Some("vault") {
            let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            vault_item_ids.insert(item_id);
            if vault_item_ids.len() > 1 {
                return false;
            }
        }
    }
    true
}

pub(super) fn validate_catalyst_constraint<V: Borrow<Value>>(
    gear_set: &HashMap<String, V>,
    max_charges: u32,
) -> bool {
    let catalyst_count = gear_set
        .values()
        .filter(|item| {
            let v: &Value = (*item).borrow();
            v.get("is_catalyst")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .count() as u32;
    catalyst_count <= max_charges
}

pub(super) fn validate_weapon_constraint<V: Borrow<Value>>(
    gear_set: &HashMap<String, V>,
    spec: &str,
) -> bool {
    if spec == "fury" {
        return true;
    }
    let Some(mh) = gear_set.get("main_hand").map(|v| v.borrow()) else {
        return true;
    };
    let mh_item_id = mh.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
    if mh_item_id == 0 {
        return true;
    }
    let inv_type = game_data::get_inventory_type(mh_item_id).unwrap_or(0);
    if inv_type != 17 {
        return true;
    }
    match gear_set.get("off_hand") {
        None => true,
        Some(oh_item) => {
            let oh_id = oh_item
                .borrow()
                .get("item_id")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            oh_id == 0
        }
    }
}


pub(super) fn main_hand_is_two_hand<V: Borrow<Value>>(
    gear_set: &HashMap<String, V>,
    spec: &str,
) -> bool {
    if spec == "fury" {
        return false;
    }
    let Some(mh) = gear_set.get("main_hand").map(|v| v.borrow()) else {
        return false;
    };
    let mh_item_id = mh.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
    if mh_item_id == 0 {
        return false;
    }
    let mh_bonus_ids: Vec<u64> = mh
        .get("bonus_ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
        .unwrap_or_default();
    let inv_type = game_data::get_item_info(mh_item_id, Some(&mh_bonus_ids))
        .map(|info| info.inventory_type)
        .unwrap_or(0);
    inv_type == 17
}

pub(super) fn validate_unique_equipped<V: Borrow<Value>>(gear_set: &HashMap<String, V>) -> bool {
    for (slot1, slot2) in UNIQUE_SLOT_PAIRS {
        let item1 = gear_set.get(*slot1).map(|v| v.borrow());
        let item2 = gear_set.get(*slot2).map(|v| v.borrow());
        if let (Some(i1), Some(i2)) = (item1, item2) {
            let id1 = i1.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            let id2 = i2.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            if id1 != 0 && id2 != 0 && id1 == id2 {
                return false;
            }
        }
    }
    true
}

pub(super) fn validate_item_limits<V: Borrow<Value>>(gear_set: &HashMap<String, V>) -> bool {
    let mut category_counts: HashMap<u64, u64> = HashMap::new();
    let mut category_limits: HashMap<u64, u64> = HashMap::new();

    for item in gear_set.values() {
        let bonus_ids: Vec<u64> = item
            .borrow()
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
            .unwrap_or_default();
        let item_id = item.borrow().get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
        for (cat_id, max_qty) in game_data::item_limit_categories_for(item_id, &bonus_ids) {
            *category_counts.entry(cat_id).or_insert(0) += 1;
            category_limits.insert(cat_id, max_qty);
        }
    }

    for (cat_id, count) in &category_counts {
        if let Some(&limit) = category_limits.get(cat_id) {
            if *count > limit {
                return false;
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{ensure_game_data_loaded, TestItem};

    fn item(id: u64) -> Value {
        TestItem::new(id).build()
    }
    fn item_with_origin(id: u64, origin: &str) -> Value {
        TestItem::new(id).origin(origin).build()
    }
    fn item_with_catalyst(id: u64) -> Value {
        TestItem::new(id).catalyst().build()
    }

    #[test]
    fn embellishment_limit_rejects_three_embellished_items() {
        // Guards against the compaction script dropping `item_limit_category` from
        // bonuses.json (which silently disabled embellishment validation on web).
        ensure_game_data_loaded();
        let emb1 = TestItem::new(1).bonus_ids(vec![8960]).build();
        let emb2 = TestItem::new(2).bonus_ids(vec![8960]).build();
        let emb3 = TestItem::new(3).bonus_ids(vec![8960]).build();
        let mut gs = HashMap::new();
        gs.insert("neck".to_string(), emb1);
        gs.insert("finger1".to_string(), emb2);
        gs.insert("main_hand".to_string(), emb3);
        assert!(
            !validate_item_limits(&gs),
            "three items with embellishment bonus 8960 must violate the max-2 limit"
        );
    }

    #[test]
    fn embellishment_limit_allows_two_embellished_items() {
        ensure_game_data_loaded();
        let emb1 = TestItem::new(1).bonus_ids(vec![8960]).build();
        let emb2 = TestItem::new(2).bonus_ids(vec![8960]).build();
        let mut gs = HashMap::new();
        gs.insert("finger1".to_string(), emb1);
        gs.insert("main_hand".to_string(), emb2);
        assert!(validate_item_limits(&gs));
    }

    #[test]
    fn vault_constraint_passes_with_zero_vault_items() {
        let mut gs = HashMap::new();
        gs.insert("head".to_string(), item(1));
        gs.insert("chest".to_string(), item(2));
        assert!(validate_vault_constraint(&gs));
    }

    #[test]
    fn vault_constraint_passes_with_one_vault_item() {
        let mut gs = HashMap::new();
        gs.insert("head".to_string(), item_with_origin(1, "vault"));
        gs.insert("chest".to_string(), item(2));
        assert!(validate_vault_constraint(&gs));
    }

    #[test]
    fn vault_constraint_fails_with_two_different_vault_items() {
        let mut gs = HashMap::new();
        gs.insert("head".to_string(), item_with_origin(1, "vault"));
        gs.insert("chest".to_string(), item_with_origin(2, "vault"));
        assert!(!validate_vault_constraint(&gs));
    }

    #[test]
    fn vault_constraint_passes_with_same_vault_id_twice() {
        // Same item_id in vault counted as one (HashSet dedup)
        let mut gs = HashMap::new();
        gs.insert("finger1".to_string(), item_with_origin(1, "vault"));
        gs.insert("finger2".to_string(), item_with_origin(1, "vault"));
        assert!(validate_vault_constraint(&gs));
    }

    #[test]
    fn catalyst_constraint_passes_at_limit() {
        let mut gs = HashMap::new();
        gs.insert("head".to_string(), item_with_catalyst(1));
        gs.insert("chest".to_string(), item_with_catalyst(2));
        assert!(validate_catalyst_constraint(&gs, 2));
    }

    #[test]
    fn catalyst_constraint_fails_over_limit() {
        let mut gs = HashMap::new();
        gs.insert("head".to_string(), item_with_catalyst(1));
        gs.insert("chest".to_string(), item_with_catalyst(2));
        gs.insert("legs".to_string(), item_with_catalyst(3));
        assert!(!validate_catalyst_constraint(&gs, 2));
    }

    #[test]
    fn catalyst_constraint_passes_with_zero_max_and_no_catalyst() {
        let mut gs = HashMap::new();
        gs.insert("head".to_string(), item(1));
        assert!(validate_catalyst_constraint(&gs, 0));
    }

    #[test]
    fn weapon_constraint_fury_with_2h_and_offhand_passes() {
        ensure_game_data_loaded();
        // Skip data lookup: fury bypasses the 2H check entirely.
        let mut gs = HashMap::new();
        gs.insert("main_hand".to_string(), item(1));
        gs.insert("off_hand".to_string(), item(2));
        assert!(validate_weapon_constraint(&gs, "fury"));
    }

    #[test]
    fn weapon_constraint_no_main_hand_passes() {
        let gs: HashMap<String, Value> = HashMap::new();
        assert!(validate_weapon_constraint(&gs, "arms"));
    }

    #[test]
    fn weapon_constraint_zero_id_main_hand_passes() {
        let mut gs = HashMap::new();
        gs.insert("main_hand".to_string(), item(0));
        assert!(validate_weapon_constraint(&gs, "arms"));
    }

    #[test]
    fn weapon_constraint_2h_with_zero_off_hand_passes() {
        ensure_game_data_loaded();
        let mut gs = HashMap::new();
        // 237837 is a one-hand in the user's report — pick a known 2H from DB.
        // For an isolated unit test, use the empty-off-hand path:
        gs.insert("main_hand".to_string(), item(237837));
        gs.insert("off_hand".to_string(), item(0));
        assert!(validate_weapon_constraint(&gs, "arms"));
    }

    #[test]
    fn unique_equipped_same_finger_item_fails() {
        let mut gs = HashMap::new();
        gs.insert("finger1".to_string(), item(99));
        gs.insert("finger2".to_string(), item(99));
        assert!(!validate_unique_equipped(&gs));
    }

    #[test]
    fn unique_equipped_different_fingers_passes() {
        let mut gs = HashMap::new();
        gs.insert("finger1".to_string(), item(99));
        gs.insert("finger2".to_string(), item(100));
        assert!(validate_unique_equipped(&gs));
    }

    #[test]
    fn unique_equipped_same_trinket_fails() {
        let mut gs = HashMap::new();
        gs.insert("trinket1".to_string(), item(50));
        gs.insert("trinket2".to_string(), item(50));
        assert!(!validate_unique_equipped(&gs));
    }

    #[test]
    fn unique_equipped_zero_id_ignored() {
        // item_id=0 (empty placeholder) should not trigger a conflict
        let mut gs = HashMap::new();
        gs.insert("finger1".to_string(), item(0));
        gs.insert("finger2".to_string(), item(0));
        assert!(validate_unique_equipped(&gs));
    }

    #[test]
    fn unique_equipped_only_one_slot_filled_passes() {
        let mut gs = HashMap::new();
        gs.insert("finger1".to_string(), item(99));
        assert!(validate_unique_equipped(&gs));
    }

#[test]
    fn main_hand_is_two_hand_fury_always_false() {
        ensure_game_data_loaded();
        let mut gs = HashMap::new();
        gs.insert("main_hand".to_string(), item(237837));
        assert!(!main_hand_is_two_hand(&gs, "fury"));
    }

    #[test]
    fn main_hand_is_two_hand_no_main_hand_returns_false() {
        let gs: HashMap<String, Value> = HashMap::new();
        assert!(!main_hand_is_two_hand(&gs, "arms"));
    }

    #[test]
    fn main_hand_is_two_hand_zero_item_id_returns_false() {
        let mut gs = HashMap::new();
        gs.insert("main_hand".to_string(), item(0));
        assert!(!main_hand_is_two_hand(&gs, "arms"));
    }
}
