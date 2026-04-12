use serde_json::Value;
use std::collections::{HashMap, HashSet};

use crate::game_data;
use crate::types::class_data::{GEAR_SLOTS, UNIQUE_SLOT_PAIRS};

pub(super) fn validate_vault_constraint(gear_set: &HashMap<String, Value>) -> bool {
    let mut vault_item_ids: HashSet<u64> = HashSet::new();
    for item in gear_set.values() {
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

pub(super) fn validate_catalyst_constraint(
    gear_set: &HashMap<String, Value>,
    max_charges: u32,
) -> bool {
    let catalyst_count = gear_set
        .values()
        .filter(|item| {
            item.get("is_catalyst")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .count() as u32;
    catalyst_count <= max_charges
}

pub(super) fn validate_weapon_constraint(gear_set: &HashMap<String, Value>, spec: &str) -> bool {
    if spec == "fury" {
        return true;
    }
    let Some(mh) = gear_set.get("main_hand") else {
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
            let oh_id = oh_item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            oh_id == 0
        }
    }
}

fn item_identity(item: &Value) -> String {
    let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
    let mut bonus_ids: Vec<u64> = item
        .get("bonus_ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
        .unwrap_or_default();
    bonus_ids.sort();
    let bonus_key = bonus_ids
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(":");
    format!("{}:{}", item_id, bonus_key)
}

pub(super) fn gear_set_identity_key(gear_set: &HashMap<String, Value>) -> String {
    let paired: HashSet<&str> = UNIQUE_SLOT_PAIRS
        .iter()
        .flat_map(|(a, b)| [*a, *b])
        .collect();

    let mut parts: Vec<String> = Vec::new();
    let mut handled: HashSet<&str> = HashSet::new();

    for slot in GEAR_SLOTS {
        if handled.contains(slot) {
            continue;
        }
        if paired.contains(slot) {
            if let Some((s1, s2)) = UNIQUE_SLOT_PAIRS
                .iter()
                .find(|(a, b)| *a == *slot || *b == *slot)
            {
                handled.insert(s1);
                handled.insert(s2);
                let id1 = gear_set
                    .get(*s1)
                    .map(item_identity)
                    .unwrap_or_else(|| "none".to_string());
                let id2 = gear_set
                    .get(*s2)
                    .map(item_identity)
                    .unwrap_or_else(|| "none".to_string());
                let (a, b) = if id1 <= id2 { (id1, id2) } else { (id2, id1) };
                parts.push(format!("{}+{}={},{}", s1, s2, a, b));
            }
        } else {
            let id = gear_set
                .get(*slot)
                .map(item_identity)
                .unwrap_or_else(|| "none".to_string());
            parts.push(format!("{}={}", slot, id));
        }
    }

    parts.join("|")
}

pub(super) fn main_hand_is_two_hand(gear_set: &HashMap<String, Value>, spec: &str) -> bool {
    if spec == "fury" {
        return false;
    }
    let Some(mh) = gear_set.get("main_hand") else {
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

pub(super) fn validate_unique_equipped(gear_set: &HashMap<String, Value>) -> bool {
    for (slot1, slot2) in UNIQUE_SLOT_PAIRS {
        let item1 = gear_set.get(*slot1);
        let item2 = gear_set.get(*slot2);
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

pub(super) fn validate_item_limits(gear_set: &HashMap<String, Value>) -> bool {
    let mut category_counts: HashMap<u64, u64> = HashMap::new();
    let mut category_limits: HashMap<u64, u64> = HashMap::new();

    for item in gear_set.values() {
        let bonus_ids: Vec<u64> = item
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
            .unwrap_or_default();
        for (cat_id, max_qty) in game_data::get_item_limit_categories(&bonus_ids) {
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
