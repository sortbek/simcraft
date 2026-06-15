use serde_json::{json, Value};
use crate::game_data;

/// Build droptimizer `drop_items` for one character: every eligible drop in the
/// instance at the chosen difficulty's item level + bonus id.
pub fn build_drop_items(instance_id: i64, difficulty: &str, class: &str, spec: &str) -> Vec<Value> {
    match game_data::get_instance_drops(instance_id, Some(class), Some(spec)) {
        Some(by_slot) => drop_items_from_slots(&by_slot, difficulty),
        None => Vec::new(),
    }
}

/// Pure transform: map the get_instance_drops output to droptimizer drop_items at
/// the given difficulty. Each item's ilvl/bonus come from `difficulty_info` (raids)
/// or `dungeon_info` (M+); falls back to the item's base `ilevel` and no bonus.
pub fn drop_items_from_slots(by_slot: &serde_json::Map<String, Value>, difficulty: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for items in by_slot.values() {
        let Some(arr) = items.as_array() else { continue };
        for item in arr {
            let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            if item_id == 0 {
                continue;
            }
            let diff = item
                .get("difficulty_info")
                .and_then(|d| d.get(difficulty))
                .or_else(|| item.get("dungeon_info").and_then(|d| d.get(difficulty)));
            let ilevel = diff
                .and_then(|d| d.get("ilvl"))
                .and_then(|v| v.as_u64())
                .or_else(|| item.get("ilevel").and_then(|v| v.as_u64()))
                .unwrap_or(0);
            let mut bonus_ids: Vec<u64> = Vec::new();
            if let Some(b) = diff
                .and_then(|d| d.get("bonus_id"))
                .and_then(|v| v.as_u64())
            {
                if b != 0 {
                    bonus_ids.push(b);
                }
            }
            out.push(json!({
                "item_id": item_id,
                "ilevel": ilevel,
                "name": item.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                "encounter": item.get("encounter").and_then(|v| v.as_str()).unwrap_or(""),
                "inventory_type": item.get("inventory_type").and_then(|v| v.as_u64()).unwrap_or(0),
                "bonus_ids": bonus_ids,
            }));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Map;

    // ---- Pure transform tests (no data-loading dependency) ----

    fn make_slot_map(items: Vec<Value>) -> serde_json::Map<String, Value> {
        let mut m = Map::new();
        m.insert("head".to_string(), Value::Array(items));
        m
    }

    #[test]
    fn difficulty_info_heroic_ilvl_and_bonus() {
        let item = json!({
            "item_id": 12345u64,
            "ilevel": 600u64,
            "name": "Test Helm",
            "encounter": "Boss One",
            "inventory_type": 1u64,
            "difficulty_info": {
                "heroic": { "ilvl": 639u64, "bonus_id": 10421u64, "quality": 4u64 },
                "normal": { "ilvl": 626u64, "bonus_id": 10000u64, "quality": 3u64 }
            }
        });
        let by_slot = make_slot_map(vec![item]);
        let result = drop_items_from_slots(&by_slot, "heroic");
        assert_eq!(result.len(), 1);
        let r = &result[0];
        assert_eq!(r.get("item_id").and_then(|v| v.as_u64()), Some(12345));
        assert_eq!(r.get("ilevel").and_then(|v| v.as_u64()), Some(639));
        assert_eq!(
            r.get("bonus_ids").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|b| b.as_u64()).collect::<Vec<_>>()),
            Some(vec![10421u64])
        );
    }

    #[test]
    fn fallback_to_base_ilevel_when_no_diff_info() {
        let item = json!({
            "item_id": 99u64,
            "ilevel": 580u64,
            "name": "Fixed Helm",
            "encounter": "Boss Two",
            "inventory_type": 1u64,
        });
        let by_slot = make_slot_map(vec![item]);
        let result = drop_items_from_slots(&by_slot, "heroic");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].get("ilevel").and_then(|v| v.as_u64()), Some(580));
        let bonus_ids = result[0]
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .unwrap();
        assert!(bonus_ids.is_empty(), "no bonus_id when diff info is absent");
    }

    #[test]
    fn dungeon_info_difficulty_ilvl_and_bonus() {
        // M+ / dungeon items carry per-difficulty data under `dungeon_info`.
        let item = json!({
            "item_id": 777u64,
            "ilevel": 600u64,
            "name": "Dungeon Ring",
            "encounter": "Some Dungeon",
            "inventory_type": 11u64,
            "dungeon_info": {
                "mythic": { "ilvl": 658u64, "bonus_id": 12345u64, "quality": 4u64 }
            }
        });
        let by_slot = make_slot_map(vec![item]);
        let result = drop_items_from_slots(&by_slot, "mythic");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].get("ilevel").and_then(|v| v.as_u64()), Some(658));
        let bonus_ids: Vec<u64> = result[0]
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .unwrap()
            .iter()
            .filter_map(|v| v.as_u64())
            .collect();
        assert_eq!(bonus_ids, vec![12345]);
    }

    #[test]
    fn item_with_zero_item_id_is_skipped() {
        let item = json!({
            "item_id": 0u64,
            "ilevel": 639u64,
            "name": "Bad Item",
            "encounter": "",
            "inventory_type": 1u64,
        });
        let by_slot = make_slot_map(vec![item]);
        let result = drop_items_from_slots(&by_slot, "heroic");
        assert!(result.is_empty());
    }

    // ---- Integration tests (require loaded game data) ----

    #[test]
    fn builds_drop_items_for_known_instance() {
        crate::test_support::ensure_game_data_loaded();
        // 1314 = The Dreamrift (raid, current tier), heroic difficulty
        let items = build_drop_items(1314, "heroic", "mage", "frost");
        assert!(!items.is_empty(), "expected drops for The Dreamrift (1314)");
        let first = &items[0];
        assert!(first.get("item_id").and_then(|v| v.as_u64()).unwrap() > 0);
        assert!(first.get("ilevel").and_then(|v| v.as_u64()).unwrap() > 0);
        assert!(first.get("name").is_some());
        assert!(first.get("encounter").is_some());
        assert!(first.get("inventory_type").is_some());
        assert!(first.get("bonus_ids").and_then(|v| v.as_array()).is_some());
    }

    #[test]
    fn unknown_instance_returns_empty() {
        crate::test_support::ensure_game_data_loaded();
        assert!(build_drop_items(-999999, "heroic", "mage", "frost").is_empty());
    }
}
