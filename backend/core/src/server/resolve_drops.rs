use crate::types::{ItemOrigin, RawParsedItem};
use serde_json::Value;

/// Map an inventory type to a representative gear slot for `RawParsedItem.raw_slot`.
/// The resolver fans items to all eligible slots via item_db; raw_slot is only a
/// fallback, so a single representative slot per inv_type is sufficient.
pub(super) fn primary_slot_for_inv_type(inv_type: u64) -> &'static str {
    match inv_type {
        1 => "head",
        2 => "neck",
        3 => "shoulder",
        5 | 20 => "chest",
        6 => "waist",
        7 => "legs",
        8 => "feet",
        9 => "wrist",
        10 => "hands",
        11 => "finger1",
        12 => "trinket1",
        16 => "back",
        14 | 22 | 23 => "off_hand",
        _ => "main_hand",
    }
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
        origin: ItemOrigin::Loot,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
        assert_eq!(item.origin, ItemOrigin::Loot);
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
