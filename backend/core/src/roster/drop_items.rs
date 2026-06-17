use serde_json::{json, Value};
use crate::game_data;

/// Build droptimizer `drop_items` for one character: every eligible drop in the
/// instance at the chosen difficulty's item level + bonus id.
///
/// `upgrade_level` bumps every drop to that track level (0 = as dropped, mirroring
/// Drop Finder's `resolveUpgrade`). `encounter_ids` restricts to selected bosses by
/// encounter id (empty = all bosses). `tracks` is `game_data::get_upgrade_tracks()`
/// output, passed in so callers can compute it once across many members.
pub fn build_drop_items(
    instance_id: i64,
    difficulty: &str,
    class: &str,
    spec: &str,
    upgrade_level: u64,
    encounter_ids: &[i64],
    tracks: &Value,
) -> Vec<Value> {
    match game_data::get_instance_drops(instance_id, Some(class), Some(spec)) {
        Some(by_slot) => {
            drop_items_from_slots(&by_slot, difficulty, upgrade_level, encounter_ids, tracks)
        }
        None => Vec::new(),
    }
}

/// Resolve an item's (ilvl, bonus_id) at the requested `upgrade_level`, mirroring the
/// frontend `resolveUpgrade`. `base` is the per-difficulty track info (from
/// `difficulty_info`/`dungeon_info`); `tracks` is `get_upgrade_tracks()` output.
///
/// PARITY: this and `drop_items_from_slots` reimplement the upgrade-track math from
/// the canonical frontend spec `resolveUpgrade` in
/// `frontend/src/app/components/loot/types.ts`. Any change to the algorithm there
/// (track lookup, fallback order, level matching) MUST be mirrored here, and vice
/// versa, or the two will drift. The `upgrade_level_*` tests below cover the algorithm.
fn resolve_upgrade(
    base: Option<&Value>,
    upgrade_level: u64,
    tracks: &Value,
    item: &Value,
) -> (u64, u64) {
    let base_ilvl = base
        .and_then(|b| b.get("ilvl"))
        .and_then(|v| v.as_u64())
        .or_else(|| item.get("itemLevel").and_then(|v| v.as_u64()))
        .or_else(|| item.get("ilevel").and_then(|v| v.as_u64()))
        .unwrap_or(0);
    let base_bonus = base
        .and_then(|b| b.get("bonus_id"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    if upgrade_level == 0 {
        return (base_ilvl, base_bonus);
    }
    let Some(track) = base.and_then(|b| b.get("track")).and_then(|v| v.as_str()) else {
        return (base_ilvl, base_bonus);
    };
    let entry = tracks
        .get(track)
        .and_then(|t| t.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|e| e.get("level").and_then(|v| v.as_u64()) == Some(upgrade_level))
        });
    match entry {
        Some(e) => {
            let ilvl = e
                .get("ilvl")
                .and_then(|v| v.as_u64())
                .unwrap_or(base_ilvl);
            let bonus = e
                .get("bonus_id")
                .and_then(|v| v.as_u64())
                .unwrap_or(base_bonus);
            (ilvl, bonus)
        }
        None => (base_ilvl, base_bonus),
    }
}

/// Pure transform: map the get_instance_drops output to droptimizer drop_items at
/// the given difficulty. Each item's ilvl/bonus come from `difficulty_info` (raids)
/// or `dungeon_info` (M+), resolved to `upgrade_level` (0 = as dropped); falls back
/// to the item's base `ilevel` and no bonus. `encounter_ids` (empty = all) restricts
/// output to those bosses by encounter id.
pub fn drop_items_from_slots(
    by_slot: &serde_json::Map<String, Value>,
    difficulty: &str,
    upgrade_level: u64,
    encounter_ids: &[i64],
    tracks: &Value,
) -> Vec<Value> {
    let mut out = Vec::new();
    for items in by_slot.values() {
        let Some(arr) = items.as_array() else { continue };
        for item in arr {
            let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            if item_id == 0 {
                continue;
            }
            if !encounter_ids.is_empty() {
                let eid = item.get("encounter_id").and_then(|v| v.as_i64());
                match eid {
                    Some(id) if encounter_ids.contains(&id) => {}
                    _ => continue,
                }
            }
            let base = item
                .get("difficulty_info")
                .and_then(|d| d.get(difficulty))
                .or_else(|| item.get("dungeon_info").and_then(|d| d.get(difficulty)));
            let (ilevel, bonus) = resolve_upgrade(base, upgrade_level, tracks, item);
            let mut bonus_ids: Vec<u64> = Vec::new();
            if bonus != 0 {
                bonus_ids.push(bonus);
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

    fn empty_tracks() -> Value {
        json!({})
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
        let result = drop_items_from_slots(&by_slot, "heroic", 0, &[], &empty_tracks());
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
        let result = drop_items_from_slots(&by_slot, "heroic", 0, &[], &empty_tracks());
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
        let result = drop_items_from_slots(&by_slot, "mythic", 0, &[], &empty_tracks());
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
        let result = drop_items_from_slots(&by_slot, "heroic", 0, &[], &empty_tracks());
        assert!(result.is_empty());
    }

    #[test]
    fn upgrade_level_resolves_to_track_entry() {
        let item = json!({
            "item_id": 12345u64,
            "ilevel": 639u64,
            "name": "Test Helm",
            "encounter": "Boss One",
            "encounter_id": 100i64,
            "inventory_type": 1u64,
            "difficulty_info": {
                "heroic": { "ilvl": 639u64, "bonus_id": 111u64, "track": "Hero", "level": 3u64, "max_level": 6u64 }
            }
        });
        let tracks = json!({
            "Hero": [
                { "level": 3u64, "ilvl": 639u64, "bonus_id": 111u64, "max_level": 6u64 },
                { "level": 6u64, "ilvl": 678u64, "bonus_id": 222u64, "max_level": 6u64 }
            ]
        });
        let by_slot = make_slot_map(vec![item]);
        let result = drop_items_from_slots(&by_slot, "heroic", 6, &[], &tracks);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].get("ilevel").and_then(|v| v.as_u64()), Some(678));
        let bonus_ids: Vec<u64> = result[0]
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .unwrap()
            .iter()
            .filter_map(|v| v.as_u64())
            .collect();
        assert_eq!(bonus_ids, vec![222]);
    }

    #[test]
    fn upgrade_level_zero_is_as_dropped() {
        let item = json!({
            "item_id": 12345u64,
            "ilevel": 639u64,
            "name": "Test Helm",
            "encounter": "Boss One",
            "encounter_id": 100i64,
            "inventory_type": 1u64,
            "difficulty_info": {
                "heroic": { "ilvl": 639u64, "bonus_id": 111u64, "track": "Hero", "level": 3u64, "max_level": 6u64 }
            }
        });
        let tracks = json!({
            "Hero": [
                { "level": 3u64, "ilvl": 639u64, "bonus_id": 111u64, "max_level": 6u64 },
                { "level": 6u64, "ilvl": 678u64, "bonus_id": 222u64, "max_level": 6u64 }
            ]
        });
        let by_slot = make_slot_map(vec![item]);
        let result = drop_items_from_slots(&by_slot, "heroic", 0, &[], &tracks);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].get("ilevel").and_then(|v| v.as_u64()), Some(639));
        let bonus_ids: Vec<u64> = result[0]
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .unwrap()
            .iter()
            .filter_map(|v| v.as_u64())
            .collect();
        assert_eq!(bonus_ids, vec![111]);
    }

    #[test]
    fn boss_filter_keeps_only_selected() {
        let item_a = json!({
            "item_id": 1u64,
            "ilevel": 600u64,
            "name": "From Boss A",
            "encounter": "Boss A",
            "encounter_id": 100i64,
            "inventory_type": 1u64,
        });
        let item_b = json!({
            "item_id": 2u64,
            "ilevel": 600u64,
            "name": "From Boss B",
            "encounter": "Boss B",
            "encounter_id": 200i64,
            "inventory_type": 1u64,
        });
        let by_slot = make_slot_map(vec![item_a, item_b]);

        let filtered = drop_items_from_slots(&by_slot, "heroic", 0, &[200], &empty_tracks());
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].get("item_id").and_then(|v| v.as_u64()), Some(2));

        let all = drop_items_from_slots(&by_slot, "heroic", 0, &[], &empty_tracks());
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn unknown_upgrade_level_falls_back_to_base() {
        let item = json!({
            "item_id": 12345u64,
            "ilevel": 639u64,
            "name": "Test Helm",
            "encounter": "Boss One",
            "encounter_id": 100i64,
            "inventory_type": 1u64,
            "difficulty_info": {
                "heroic": { "ilvl": 639u64, "bonus_id": 111u64, "track": "Hero", "level": 3u64, "max_level": 6u64 }
            }
        });
        let tracks = json!({
            "Hero": [
                { "level": 3u64, "ilvl": 639u64, "bonus_id": 111u64, "max_level": 6u64 },
                { "level": 6u64, "ilvl": 678u64, "bonus_id": 222u64, "max_level": 6u64 }
            ]
        });
        let by_slot = make_slot_map(vec![item]);
        let result = drop_items_from_slots(&by_slot, "heroic", 99, &[], &tracks);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].get("ilevel").and_then(|v| v.as_u64()), Some(639));
        let bonus_ids: Vec<u64> = result[0]
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .unwrap()
            .iter()
            .filter_map(|v| v.as_u64())
            .collect();
        assert_eq!(bonus_ids, vec![111]);
    }

    #[test]
    fn fixed_difficulty_ignores_upgrade_level() {
        // Special raids (e.g. Sporefall's Sporefused gear) carry fixed per-difficulty
        // ilvl/bonus with NO "track" field — the upgrade level must be a no-op.
        let item = json!({
            "item_id": 555u64,
            "ilevel": 298u64,
            "name": "Sporefused Trinket",
            "encounter": "Rotmire",
            "encounter_id": 2711i64,
            "inventory_type": 12u64,
            "difficulty_info": {
                "heroic": { "ilvl": 285u64, "bonus_id": 13787u64, "quality": 4u64 }
            }
        });
        let by_slot = make_slot_map(vec![item]);
        // upgrade_level=6 must NOT change the fixed values (no track to climb).
        let result = drop_items_from_slots(&by_slot, "heroic", 6, &[], &empty_tracks());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].get("ilevel").and_then(|v| v.as_u64()), Some(285));
        let bonus_ids: Vec<u64> = result[0]
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .unwrap()
            .iter()
            .filter_map(|v| v.as_u64())
            .collect();
        assert_eq!(bonus_ids, vec![13787]);
    }

    // ---- Integration tests (require loaded game data) ----

    #[test]
    fn builds_drop_items_for_known_instance() {
        crate::test_support::ensure_game_data_loaded();
        // 1314 = The Dreamrift (raid, current tier), heroic difficulty
        let items = build_drop_items(
            1314,
            "heroic",
            "mage",
            "frost",
            0,
            &[],
            &game_data::get_upgrade_tracks(),
        );
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
        assert!(build_drop_items(
            -999999,
            "heroic",
            "mage",
            "frost",
            0,
            &[],
            &game_data::get_upgrade_tracks(),
        )
        .is_empty());
    }

    #[test]
    fn sporefall_uses_fixed_per_difficulty_ilvls() {
        crate::test_support::ensure_game_data_loaded();
        // Sporefall (instance 1305, encounter 2711 "Rotmire") uses fixed Sporefused
        // ilvls per difficulty (LFR 259 / Mythic 298) with NO upgrade track.
        let tracks = game_data::get_upgrade_tracks();
        let lfr = build_drop_items(1305, "lfr", "mage", "frost", 0, &[], &tracks);
        let mythic = build_drop_items(1305, "mythic", "mage", "frost", 0, &[], &tracks);
        assert!(!lfr.is_empty(), "expected Sporefall drops for mage/frost");
        assert!(
            lfr.iter().all(|d| d.get("ilevel").and_then(|v| v.as_u64()) == Some(259)),
            "LFR Sporefall drops must all be ilvl 259"
        );
        assert!(
            mythic.iter().all(|d| d.get("ilevel").and_then(|v| v.as_u64()) == Some(298)),
            "Mythic Sporefall drops must all be ilvl 298"
        );
        // No upgrade track: a max upgrade level must NOT change the mythic ilvl.
        let mythic_up = build_drop_items(1305, "mythic", "mage", "frost", 8, &[], &tracks);
        assert!(
            mythic_up.iter().all(|d| d.get("ilevel").and_then(|v| v.as_u64()) == Some(298)),
            "upgrade level must be a no-op for fixed-difficulty raids"
        );
    }
}
