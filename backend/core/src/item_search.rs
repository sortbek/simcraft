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

/// Every current-season drop, as owned DropItem values.
fn season_drop_items(
    class_name: Option<&str>,
    spec: Option<&str>,
    loot_spec_filter: bool,
) -> Vec<Value> {
    let mut out = Vec::new();
    for inst in item_db::instances() {
        let Some(inst_id) = inst.get("id").and_then(|v| v.as_i64()) else {
            continue;
        };
        let Some(drops) =
            game_data::get_instance_drops(inst_id, class_name, spec, loot_spec_filter)
        else {
            continue;
        };
        for (_slot, items) in drops {
            if let Value::Array(arr) = items {
                out.extend(arr); // owned already — moving beats cloning ~2k rows
            }
        }
    }
    out
}

/// The current-season drop catalog keyed by item id, unfiltered by class/spec.
/// Built once — game data is immutable after load.
///
/// The all-expansions search reads the raw item DB, whose entries carry no drop
/// data; this is where [`rank_candidates`] recovers an item's real levels.
fn season_catalog() -> &'static HashMap<u64, Value> {
    static CATALOG: once_cell::sync::Lazy<HashMap<u64, Value>> = once_cell::sync::Lazy::new(|| {
        let mut map: HashMap<u64, Value> = HashMap::new();
        for item in season_drop_items(None, None, true) {
            let Some(id) = item.get("item_id").and_then(|v| v.as_u64()) else {
                continue;
            };
            // An item can drop in several instances (a raid and the season pool
            // that aggregates it). Prefer a row that actually carries drop data;
            // `duplicate_catalog_rows_offer_the_same_levels` guards the case
            // where two rows would disagree about the levels themselves.
            match map.entry(id) {
                std::collections::hash_map::Entry::Vacant(e) => {
                    e.insert(item);
                }
                std::collections::hash_map::Entry::Occupied(mut e) => {
                    if !has_drop_data(e.get()) && has_drop_data(&item) {
                        e.insert(item);
                    }
                }
            }
        }
        map
    });
    &CATALOG
}

/// Whether an item carries per-difficulty drop data of its own. Raw item-DB rows
/// (the all-expansions search) never do; drop-catalog rows always do.
fn has_drop_data(item: &Value) -> bool {
    ["difficulty_info", "dungeon_info"].iter().any(|key| {
        item.get(key)
            .and_then(|v| v.as_object())
            .is_some_and(|entries| !entries.is_empty())
    })
}

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
    let saw_drop_data = has_drop_data(item);

    for key in ["difficulty_info", "dungeon_info"] {
        let Some(entries) = item.get(key).and_then(|v| v.as_object()) else {
            continue;
        };
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
            // Raw item-DB rows carry no drop data, so a current-season drop found
            // by the all-expansions search would fall back to the generic ladder
            // and lose levels no track holds (an encounter's off-track Mythic).
            // Read its levels off the catalog row instead.
            let levels_from = if has_drop_data(item) {
                item
            } else {
                season_catalog().get(&id).unwrap_or(item)
            };
            json!({
                "item_id": id,
                "name": name,
                "icon": item.get("icon").and_then(|i| i.as_str()).unwrap_or("inv_misc_questionmark"),
                "inventory_type": item.get(keys.inventory_type).and_then(|v| v.as_u64()).unwrap_or(0),
                "quality": item.get("quality").and_then(|v| v.as_u64()).unwrap_or(1),
                "ilevel": item.get(keys.item_level).and_then(|v| v.as_u64()).unwrap_or(0),
                "ilvl_options": ilvl_options(levels_from)
                    .into_iter()
                    .map(|(ilvl, bonus_id)| json!({ "ilvl": ilvl, "bonus_id": bonus_id }))
                    .collect::<Vec<_>>(),
            })
        })
        .collect()
}

/// Search the current-season drop catalog (DropFinder's data) by name or id.
///
/// `loot_spec_filter` is passed straight to [`game_data::get_instance_drops`]:
/// off, the search returns everything the class can equip, whatever the item's
/// loot-spec allowlist or primary stat says.
pub fn season_drops(
    query: &str,
    class_name: Option<&str>,
    spec: Option<&str>,
    locale: &str,
    limit: usize,
    loot_spec_filter: bool,
) -> Vec<Value> {
    if query.trim().is_empty() {
        return Vec::new();
    }
    let catalog = season_drop_items(class_name, spec, loot_spec_filter);
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
        let results = season_drops("a", Some("hunter"), Some("marksmanship"), "en_US", 5, true);
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
        assert!(season_drops(
            "  ",
            Some("hunter"),
            Some("marksmanship"),
            "en_US",
            50,
            true
        )
        .is_empty());
        assert!(all_equippable("  ", Some("hunter"), "en_US", 50).is_empty());
    }

    #[test]
    fn season_search_dedups_and_respects_limit() {
        ensure_game_data_loaded();
        let results = season_drops("a", Some("hunter"), Some("marksmanship"), "en_US", 10, true);
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
        let broad = season_drops("a", Some("hunter"), Some("marksmanship"), "en_US", 1, true);
        let Some(first) = broad.first() else {
            return;
        };
        let name = first
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();
        let id = first.get("item_id").and_then(|v| v.as_u64()).unwrap();
        let results = season_drops(
            &name,
            Some("hunter"),
            Some("marksmanship"),
            "en_US",
            50,
            true,
        );
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

    /// One spec per armor type, across tank/healer/DPS — the flag is class-agnostic,
    /// so the properties below must hold for every one of them.
    const LOOT_SPEC_SAMPLE: [(&str, &str); 4] = [
        ("priest", "holy"),         // cloth, healer
        ("druid", "guardian"),      // leather, tank
        ("hunter", "marksmanship"), // mail, dps
        ("warrior", "protection"),  // plate, tank
    ];

    /// Every season drop this spec can see, with the loot-spec allowlist honoured
    /// or ignored.
    fn season_ids(class: &str, spec: &str, loot_spec_filter: bool) -> HashSet<u64> {
        // No truncation: `rank_candidates` truncates after sorting, so a finite
        // limit would eventually let the relaxed run's extra items push strict-set
        // items past the cut and fail the subset assertion for the wrong reason.
        season_drops(
            "a",
            Some(class),
            Some(spec),
            "en_US",
            usize::MAX,
            loot_spec_filter,
        )
        .iter()
        .filter_map(|r| r.get("item_id").and_then(|v| v.as_u64()))
        .collect()
    }

    #[test]
    fn dropping_the_loot_spec_filter_widens_the_season_search() {
        ensure_game_data_loaded();
        for (class, spec) in LOOT_SPEC_SAMPLE {
            let strict = season_ids(class, spec, true);
            let relaxed = season_ids(class, spec, false);
            assert!(
                strict.is_subset(&relaxed),
                "{}/{}: relaxing the allowlist must only ever add items",
                class,
                spec
            );
            assert!(
                relaxed.len() > strict.len(),
                "{}/{}: no gear is hidden by the loot-spec allowlist ({} items either way)",
                class,
                spec,
                strict.len()
            );
        }
    }

    #[test]
    fn dropping_the_loot_spec_filter_also_relaxes_primary_stat() {
        ensure_game_data_loaded();
        // A caster spec and gear built around a primary stat it can never use:
        // hidden while the filter is on, offered once it is off.
        let want = class_data::spec_weapon_profile("druid", "restoration")
            .expect("resto druid")
            .primary_stat;
        let strict = season_ids("druid", "restoration", true);
        let relaxed = season_ids("druid", "restoration", false);

        // Stats come from the encounter drops, not `item_db::items()` — the
        // compacted test fixture strips `stats` from the item DB.
        let by_id: HashMap<u64, &Value> = item_db::drops_by_encounter()
            .values()
            .flatten()
            .filter_map(|item| Some((item.get("id")?.as_u64()?, item)))
            .collect();
        let mismatched = relaxed.difference(&strict).any(|id| {
            by_id
                .get(id)
                .and_then(|item| class_data::item_primary_stats(item))
                .is_some_and(|stats| !stats.contains(&want))
        });
        assert!(
            mismatched,
            "no primary-stat-mismatched gear was added ({} strict, {} relaxed)",
            strict.len(),
            relaxed.len()
        );
    }

    #[test]
    fn dropping_the_loot_spec_filter_keeps_armor_type_filtering() {
        ensure_game_data_loaded();
        // The allowlist is the only thing the flag relaxes: a class must still
        // never be offered another armor type, whichever way it is set.
        for (class, spec) in LOOT_SPEC_SAMPLE {
            let own = class_data::class_max_armor(class).expect("class armor type");
            for item_id in season_ids(class, spec, false) {
                let Some(item) = item_db::items().get(&item_id) else {
                    continue;
                };
                let inv_type = item
                    .get("inventoryType")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                if item.get("itemClass").and_then(|v| v.as_u64()) != Some(4)
                    || !class_data::ARMOR_INVENTORY_TYPES.contains(&inv_type)
                {
                    continue; // not body armor — no armor-type restriction applies
                }
                let sub = item
                    .get("itemSubClass")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                assert!(
                    sub == 0 || sub == own,
                    "item {} is armor subclass {} — a {} should never be offered it",
                    item_id,
                    sub,
                    class
                );
            }
        }
    }

    #[test]
    fn dropping_the_loot_spec_filter_still_hides_shields_from_classes_that_cannot_use_them() {
        ensure_game_data_loaded();
        // Shields are itemClass 4 / inv_type 14, so they fall through both the
        // armor-type gate (ARMOR_INVENTORY_TYPES excludes 14) and the weapon
        // subclass list — `dropping_the_loot_spec_filter_keeps_armor_type_filtering`
        // skips them by construction and cannot catch a leak here.
        //
        // Non-vacuity first: shields must actually drop this season, or the loop
        // below proves nothing.
        let shields = season_drop_items(None, None, true)
            .iter()
            .filter(|item| item.get("inventory_type").and_then(|v| v.as_u64()) == Some(14))
            .count();
        assert!(
            shields > 0,
            "no shields in the catalog — test proves nothing"
        );

        for (class, spec) in [
            ("priest", "holy"),
            ("druid", "restoration"),
            ("mage", "frost"),
        ] {
            assert!(
                !class_data::class_can_use_shield(class),
                "{} was picked because no spec of it can hold a shield",
                class
            );
            for item_id in season_ids(class, spec, false) {
                let Some(item) = item_db::items().get(&item_id) else {
                    continue;
                };
                let inv_type = item
                    .get("inventoryType")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                assert_ne!(
                    inv_type, 14,
                    "item {} is a shield — a {} should never be offered it",
                    item_id, class
                );
            }
        }
    }

    #[test]
    fn duplicate_catalog_rows_offer_the_same_levels() {
        ensure_game_data_loaded();
        // `season_catalog` keeps one row per item id, so an item that drops in
        // several instances is only safe to collapse while every row agrees
        // about its levels. 319 of ~2.2k ids are duplicated today and all agree;
        // this fails loudly if a future season breaks that.
        let mut levels_by_id: HashMap<u64, Vec<(u64, u64)>> = HashMap::new();
        for item in season_drop_items(None, None, true) {
            let Some(id) = item.get("item_id").and_then(|v| v.as_u64()) else {
                continue;
            };
            let levels = ilvl_options(&item);
            if let Some(seen) = levels_by_id.get(&id) {
                assert_eq!(
                    *seen, levels,
                    "item {} drops with two different level sets — season_catalog \
                     would silently keep one of them",
                    id
                );
            } else {
                levels_by_id.insert(id, levels);
            }
        }
    }

    #[test]
    fn all_expansions_search_keeps_a_season_drops_own_levels() {
        ensure_game_data_loaded();
        // The generic ladder every drop-data-less item falls back to.
        let ladder: HashSet<u64> = ilvl_options(&json!({}))
            .into_iter()
            .map(|(ilvl, _)| ilvl)
            .collect();

        // A drop can sit off that ladder — an encounter override (Venomous Abyss
        // Mythic 344) or a fixed-difficulty raid. Those levels are exactly what
        // the all-expansions search used to lose, so search for such an item.
        // The candidate must clear the same gate `all_equippable` applies (a real
        // gear slot — the catalog also holds crafting reagents), and the catalog
        // is a HashMap, so take the lowest id rather than whichever came out first.
        let Some((item_id, want)) = season_catalog()
            .iter()
            .filter_map(|(id, entry)| {
                let inv_type = item_db::items()
                    .get(id)?
                    .get("inventoryType")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                if inv_type == 0 || class_data::inv_type_to_slots(inv_type, "").is_empty() {
                    return None;
                }
                let off_ladder: Vec<u64> = ilvl_options(entry)
                    .into_iter()
                    .map(|(ilvl, _)| ilvl)
                    .filter(|ilvl| !ladder.contains(ilvl))
                    .collect();
                (!off_ladder.is_empty()).then_some((*id, off_ladder))
            })
            .min()
        else {
            eprintln!("SKIP off-ladder levels: no season drop leaves the track ladder");
            return;
        };

        let results = all_equippable(&item_id.to_string(), None, "en_US", 50);
        let offered: HashSet<u64> = results
            .first()
            .and_then(|r| r.get("ilvl_options"))
            .and_then(|v| v.as_array())
            .unwrap_or_else(|| panic!("item {} not found in all-expansions search", item_id))
            .iter()
            .filter_map(|o| o.get("ilvl").and_then(|v| v.as_u64()))
            .collect();
        for ilvl in want {
            assert!(
                offered.contains(&ilvl),
                "item {} drops at {} but the all-expansions search offers {:?}",
                item_id,
                ilvl,
                offered
            );
        }
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
