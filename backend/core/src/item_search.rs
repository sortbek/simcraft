//! Item name/id search for the Top Gear "add item" feature.
//!
//! Two sources share one ranking core (`rank_candidates`):
//! - [`season_drops`] searches the current-season drop catalog (the same data
//!   DropFinder serves: current raids + M+ rotation + crafted + delves), already
//!   class/spec filtered, via [`game_data::get_instance_drops`].
//! - [`all_equippable`] searches every equippable item in the DB across all
//!   expansions, filtered to real gear slots and the class's own armor/weapon types.
//!
//! Both project results to `{ item_id, name, icon, inventory_type, quality, ilevel }`,
//! exact-id first, then name-prefix, then substring; deduped by item_id.

use std::collections::HashSet;

use serde_json::{json, Value};

use crate::types::class_data;
use crate::{game_data, item_db};

/// JSON field names differ between the two sources (raw item DB vs the built
/// DropItem shape); everything else (`name`, `icon`, `quality`) is shared.
struct SearchKeys {
    id: &'static str,
    inventory_type: &'static str,
    item_level: &'static str,
}

const RAW_KEYS: SearchKeys = SearchKeys {
    id: "id",
    inventory_type: "inventoryType",
    item_level: "itemLevel",
};

const DROP_KEYS: SearchKeys = SearchKeys {
    id: "item_id",
    inventory_type: "inventory_type",
    item_level: "ilevel",
};

/// Shared core: dedup by id, match each candidate's localized name (or numeric
/// id), rank (exact id < name-prefix < substring), sort, truncate, and project
/// to the result JSON. The JSON is built only for survivors.
fn rank_candidates<'a>(
    items: impl Iterator<Item = &'a Value>,
    keys: &SearchKeys,
    query: &str,
    locale: &str,
    limit: usize,
) -> Vec<Value> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    let numeric_query = q.bytes().all(|b| b.is_ascii_digit());
    let names = item_db::item_names();

    let mut seen: HashSet<u64> = HashSet::new();
    let mut scored: Vec<(u8, String, u64, String, &Value)> = Vec::new();
    for item in items {
        let Some(item_id) = item.get(keys.id).and_then(|v| v.as_u64()) else {
            continue;
        };
        if !seen.insert(item_id) {
            continue; // an item can appear in several instances/sources
        }
        let name = names
            .and_then(|n| n.get(&item_id))
            .and_then(|loc| loc.get(locale).or_else(|| loc.get("en_US")))
            .cloned()
            .or_else(|| item.get("name").and_then(|n| n.as_str()).map(str::to_string))
            .unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        let name_lc = name.to_lowercase();
        let name_match = name_lc.contains(&q);
        let (id_match, exact_id) = if numeric_query {
            let id_str = item_id.to_string();
            (id_str.contains(&q), id_str == q)
        } else {
            (false, false)
        };
        if !name_match && !id_match {
            continue;
        }
        let rank = if exact_id {
            0
        } else if name_lc.starts_with(&q) {
            1
        } else {
            2
        };
        scored.push((rank, name_lc, item_id, name, item));
    }
    scored.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)).then_with(|| a.2.cmp(&b.2)));
    scored.truncate(limit);
    scored
        .into_iter()
        .map(|(_, _, id, name, item)| {
            json!({
                "item_id": id,
                "name": name,
                "icon": item.get("icon").and_then(|i| i.as_str()).unwrap_or("inv_misc_questionmark"),
                "inventory_type": item.get(keys.inventory_type).and_then(|v| v.as_u64()).unwrap_or(0),
                "quality": item.get("quality").and_then(|v| v.as_u64()).unwrap_or(1),
                "ilevel": item.get(keys.item_level).and_then(|v| v.as_u64()).unwrap_or(0),
            })
        })
        .collect()
}

/// Search the current-season drop catalog (DropFinder's data) by name or id.
pub fn season_drops(
    query: &str,
    class_name: Option<&str>,
    spec: Option<&str>,
    locale: &str,
    limit: usize,
) -> Vec<Value> {
    if query.trim().is_empty() {
        return Vec::new();
    }
    let mut catalog: Vec<Value> = Vec::new();
    for inst in item_db::instances() {
        let Some(inst_id) = inst.get("id").and_then(|v| v.as_i64()) else {
            continue;
        };
        if let Some(drops) = game_data::get_instance_drops(inst_id, class_name, spec) {
            for items in drops.values() {
                if let Some(arr) = items.as_array() {
                    catalog.extend(arr.iter().cloned());
                }
            }
        }
    }
    rank_candidates(catalog.iter(), &DROP_KEYS, query, locale, limit)
}

/// Search all equippable items across every expansion by name or id, filtered to
/// real gear slots and what `class_name` can equip (own armor type, usable weapons).
pub fn all_equippable(
    query: &str,
    class_name: Option<&str>,
    locale: &str,
    limit: usize,
) -> Vec<Value> {
    let class_max_armor = class_name.and_then(class_data::class_max_armor);
    let class_weapons = class_name.and_then(class_data::class_allowed_weapons);

    let filtered = item_db::items().values().filter(|item| {
        let inv_type = item.get("inventoryType").and_then(|v| v.as_u64()).unwrap_or(0);
        if inv_type == 0 || class_data::inv_type_to_slots(inv_type, "").is_empty() {
            return false; // equippable, real gear slot only
        }
        if class_name.is_none() {
            return true;
        }
        let item_class = item.get("itemClass").and_then(|v| v.as_u64()).unwrap_or(0);
        let item_subclass = item.get("itemSubClass").and_then(|v| v.as_u64()).unwrap_or(0);
        // Armor: only the class's own body-armor type; subclass 0 (neck/ring/
        // trinket/off-hand frill) and cloaks (inv 16) are universal.
        if item_class == 4 {
            if let Some(max) = class_max_armor {
                let universal = item_subclass == 0 || inv_type == 16;
                if !universal && item_subclass != max {
                    return false;
                }
            }
        }
        // Weapons: only usable types.
        if item_class == 2 {
            if let Some(weapons) = class_weapons {
                if !weapons.contains(&item_subclass) {
                    return false;
                }
            }
        }
        true
    });
    rank_candidates(filtered, &RAW_KEYS, query, locale, limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::ensure_game_data_loaded;

    #[test]
    fn empty_query_returns_nothing() {
        ensure_game_data_loaded();
        assert!(season_drops("  ", Some("hunter"), Some("marksmanship"), "en_US", 50).is_empty());
        assert!(all_equippable("  ", Some("hunter"), "en_US", 50).is_empty());
    }

    #[test]
    fn season_search_dedups_and_respects_limit() {
        ensure_game_data_loaded();
        let results = season_drops("a", Some("hunter"), Some("marksmanship"), "en_US", 10);
        assert!(results.len() <= 10);
        let ids: HashSet<u64> = results
            .iter()
            .filter_map(|r| r.get("item_id").and_then(|v| v.as_u64()))
            .collect();
        assert_eq!(ids.len(), results.len(), "results must be deduped by item_id");
    }

    #[test]
    fn season_search_matches_by_exact_name() {
        ensure_game_data_loaded();
        let broad = season_drops("a", Some("hunter"), Some("marksmanship"), "en_US", 1);
        let Some(first) = broad.first() else {
            return;
        };
        let name = first.get("name").and_then(|v| v.as_str()).unwrap().to_string();
        let id = first.get("item_id").and_then(|v| v.as_u64()).unwrap();
        let results = season_drops(&name, Some("hunter"), Some("marksmanship"), "en_US", 50);
        assert!(results.iter().any(|r| r.get("item_id").and_then(|v| v.as_u64()) == Some(id)));
    }

    #[test]
    fn all_equippable_finds_old_item_by_id() {
        ensure_game_data_loaded();
        // 151323 (Legion mail shoulder) isn't in the current season, so it only
        // surfaces in the all-expansions mode.
        let results = all_equippable("151323", Some("hunter"), "en_US", 50);
        assert_eq!(
            results.first().and_then(|r| r.get("item_id")).and_then(|v| v.as_u64()),
            Some(151323),
            "exact id should rank first; got {:?}",
            results.first()
        );
    }

    #[test]
    fn all_equippable_armor_filter_is_class_specific() {
        ensure_game_data_loaded();
        let ids = |class: &str| -> HashSet<u64> {
            all_equippable("breastplate", Some(class), "en_US", 1000)
                .iter()
                .filter_map(|r| r.get("item_id").and_then(|v| v.as_u64()))
                .collect()
        };
        assert_ne!(ids("hunter"), ids("warrior"), "mail vs plate classes differ");
    }
}
