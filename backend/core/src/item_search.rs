//! Item name/id search for the Top Gear "add item" feature.
//!
//! Two sources share one ranking core (`rank_candidates`):
//! - [`season_drops`] searches the current-season drop catalog (the same data
//!   DropFinder serves: current raids + M+ rotation + crafted + delves), already
//!   class/spec filtered, via [`game_data::get_instance_drops`].
//! - [`all_equippable`] searches every equippable item in the DB across all
//!   expansions, filtered to real gear slots and the class's own armor/weapon types.
//!
//! Both project results to
//! `{ item_id, name, icon, inventory_type, quality, ilevel, ilvl_options }`,
//! exact-id first, then name-prefix, then substring; deduped by item_id.
//! `ilvl_options` (see [`ilvl_options`]) is the per-item list of levels the
//! frontend's Add-Item dropdown offers.

use std::collections::{HashMap, HashSet};

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

/// Selectable item levels for a search result, highest first, each paired with the
/// bonus id that produces it.
///
/// Drop-catalog items expose their real levels: every step of each difficulty's
/// upgrade track, or — for fixed-difficulty encounters like Sporefall, whose gear
/// carries no track — exactly the levels they drop at. Items with no drop data
/// (the all-expansions search) fall back to the season's full set of track levels,
/// so gear outside the current season stays freely simmable.
fn ilvl_options(item: &Value) -> Vec<(u64, u64)> {
    /// Record `ilvl`; when two tracks share a level, the higher-ranked one wins.
    fn add(by_ilvl: &mut HashMap<u64, (usize, u64)>, ilvl: u64, bonus_id: u64, rank: usize) {
        if ilvl == 0 || bonus_id == 0 {
            return; // levels with no bonus can't be applied to an added item
        }
        let entry = by_ilvl.entry(ilvl).or_insert((rank, bonus_id));
        if rank > entry.0 {
            *entry = (rank, bonus_id);
        }
    }

    let tracks = item_db::upgrade_tracks();
    let mut by_ilvl: HashMap<u64, (usize, u64)> = HashMap::new();
    let mut saw_drop_data = false;

    for key in ["difficulty_info", "dungeon_info"] {
        let Some(entries) = item.get(key).and_then(|v| v.as_object()) else {
            continue;
        };
        saw_drop_data |= !entries.is_empty();
        for entry in entries.values() {
            match entry.get("track").and_then(|t| t.as_str()) {
                // Tracked drop: the item can be upgraded to any step of that track.
                Some(track) => {
                    let rank = item_db::track_rank(track).unwrap_or(0);
                    // `UPGRADE_TRACKS` is keyed (name, level, max): one name can
                    // carry several series across bonus groups. Match the drop's
                    // own `max_level` so an item is never offered levels from a
                    // same-named series it can't reach. Absent max ⇒ any series.
                    let max_level = entry.get("max_level").and_then(|v| v.as_u64());
                    for ((name, _, max), (ilvl, bonus_id, _)) in tracks.into_iter().flatten() {
                        if name == track && max_level.is_none_or(|want| *max == want) {
                            add(&mut by_ilvl, *ilvl, *bonus_id, rank);
                        }
                    }
                }
                // Fixed-difficulty drop: this level and no other.
                None => add(
                    &mut by_ilvl,
                    entry.get("ilvl").and_then(|v| v.as_u64()).unwrap_or(0),
                    entry.get("bonus_id").and_then(|v| v.as_u64()).unwrap_or(0),
                    0,
                ),
            }
        }
    }

    // Only genuinely drop-data-less items (the all-expansions search) get the
    // whole ladder. An item that HAS drop data but expands to nothing must stay
    // empty — otherwise a mismatched series silently inherits every level.
    if by_ilvl.is_empty() && !saw_drop_data {
        for ((name, _, _), (ilvl, bonus_id, _)) in tracks.into_iter().flatten() {
            add(
                &mut by_ilvl,
                *ilvl,
                *bonus_id,
                item_db::track_rank(name).unwrap_or(0),
            );
        }
    }

    let mut options: Vec<(u64, u64)> = by_ilvl
        .into_iter()
        .map(|(ilvl, (_, bonus_id))| (ilvl, bonus_id))
        .collect();
    options.sort_by_key(|o| std::cmp::Reverse(o.0));
    options
}

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
            .or_else(|| {
                item.get("name")
                    .and_then(|n| n.as_str())
                    .map(str::to_string)
            })
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
    scored.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| a.1.cmp(&b.1))
            .then_with(|| a.2.cmp(&b.2))
    });
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
                "ilvl_options": ilvl_options(item)
                    .into_iter()
                    .map(|(ilvl, bonus_id)| json!({ "ilvl": ilvl, "bonus_id": bonus_id }))
                    .collect::<Vec<_>>(),
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
        let inv_type = item
            .get("inventoryType")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        if inv_type == 0 || class_data::inv_type_to_slots(inv_type, "").is_empty() {
            return false; // equippable, real gear slot only
        }
        if class_name.is_none() {
            return true;
        }
        let item_class = item.get("itemClass").and_then(|v| v.as_u64()).unwrap_or(0);
        let item_subclass = item
            .get("itemSubClass")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
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
    fn fixed_difficulty_items_offer_only_their_own_levels() {
        ensure_game_data_loaded();
        // Sporefused-style drop: fixed levels, no upgrade track anywhere.
        let item = json!({
            "item_id": 1,
            "difficulty_info": {
                "heroic": { "ilvl": 285, "bonus_id": 13787, "quality": 4 },
                "mythic": { "ilvl": 298, "bonus_id": 13786, "quality": 4 },
            }
        });
        assert_eq!(ilvl_options(&item), vec![(298, 13786), (285, 13787)]);
    }

    #[test]
    fn track_items_expand_to_every_step_of_their_track() {
        ensure_game_data_loaded();
        let tracks = item_db::upgrade_tracks().expect("season tracks loaded");
        let myth: Vec<u64> = tracks
            .iter()
            .filter(|((name, _, _), _)| name == "Myth")
            .map(|(_, (ilvl, _, _))| *ilvl)
            .collect();
        if myth.is_empty() {
            eprintln!("SKIP track expansion: loaded season has no Myth track");
            return;
        }

        let item = json!({
            "item_id": 1,
            "difficulty_info": {
                "mythic": { "ilvl": myth[0], "bonus_id": 1, "quality": 4,
                            "track": "Myth", "level": 1, "max_level": 6 },
            }
        });
        let offered: Vec<u64> = ilvl_options(&item).into_iter().map(|(i, _)| i).collect();
        for ilvl in &myth {
            assert!(
                offered.contains(ilvl),
                "Myth {} should be offered, got {:?}",
                ilvl,
                offered
            );
        }
    }

    #[test]
    fn track_expansion_is_confined_to_the_drops_own_series() {
        ensure_game_data_loaded();
        let tracks = item_db::upgrade_tracks().expect("season tracks loaded");
        let myth: Vec<u64> = tracks
            .iter()
            .filter(|((name, _, _), _)| name == "Myth")
            .map(|(_, (ilvl, _, _))| *ilvl)
            .collect();
        if myth.is_empty() {
            eprintln!("SKIP series confinement: loaded season has no Myth track");
            return;
        }

        // `UPGRADE_TRACKS` is keyed (name, level, max) — a name can carry several
        // series across bonus groups. A drop naming a series that doesn't exist
        // must not inherit a same-named series' levels.
        let item = json!({
            "item_id": 1,
            "difficulty_info": {
                "mythic": { "ilvl": 999, "bonus_id": 1, "quality": 4,
                            "track": "Myth", "level": 1, "max_level": 99 },
            }
        });
        let offered: Vec<u64> = ilvl_options(&item).into_iter().map(|(i, _)| i).collect();
        for ilvl in &myth {
            assert!(
                !offered.contains(ilvl),
                "max-99 series must not be offered real Myth level {}; got {:?}",
                ilvl,
                offered
            );
        }
    }

    #[test]
    fn items_without_drop_data_fall_back_to_the_season_levels() {
        ensure_game_data_loaded();
        // All-expansions search results carry no difficulty info; they stay
        // freely simmable at any of the season's item levels.
        let offered = ilvl_options(&json!({ "item_id": 1 }));
        assert!(!offered.is_empty());
        assert!(
            offered.windows(2).all(|w| w[0].0 > w[1].0),
            "options must be unique and descending: {:?}",
            offered
        );
    }

    #[test]
    fn search_results_carry_their_item_level_options() {
        ensure_game_data_loaded();
        let results = season_drops("a", Some("hunter"), Some("marksmanship"), "en_US", 5);
        for r in &results {
            let opts = r
                .get("ilvl_options")
                .and_then(|v| v.as_array())
                .unwrap_or_else(|| panic!("result missing ilvl_options: {}", r));
            assert!(!opts.is_empty(), "every result needs at least one level");
        }
    }

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
        assert_eq!(
            ids.len(),
            results.len(),
            "results must be deduped by item_id"
        );
    }

    #[test]
    fn season_search_matches_by_exact_name() {
        ensure_game_data_loaded();
        let broad = season_drops("a", Some("hunter"), Some("marksmanship"), "en_US", 1);
        let Some(first) = broad.first() else {
            return;
        };
        let name = first
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();
        let id = first.get("item_id").and_then(|v| v.as_u64()).unwrap();
        let results = season_drops(&name, Some("hunter"), Some("marksmanship"), "en_US", 50);
        assert!(results
            .iter()
            .any(|r| r.get("item_id").and_then(|v| v.as_u64()) == Some(id)));
    }

    #[test]
    fn all_equippable_finds_old_item_by_id() {
        ensure_game_data_loaded();
        // 151323 (Legion mail shoulder) isn't in the current season, so it only
        // surfaces in the all-expansions mode.
        let results = all_equippable("151323", Some("hunter"), "en_US", 50);
        assert_eq!(
            results
                .first()
                .and_then(|r| r.get("item_id"))
                .and_then(|v| v.as_u64()),
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
        assert_ne!(
            ids("hunter"),
            ids("warrior"),
            "mail vs plate classes differ"
        );
    }
}
