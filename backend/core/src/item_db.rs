//! Pure data loading and lookup for items, enchants, gems, bonuses, and upgrades.
//!
//! No filtering, no class logic. Just load JSON files and provide accessors.

use once_cell::sync::OnceCell;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use crate::types::{class_data, BonusResolved, ItemInfo};

// ---- Upgrade Tracks (ranked) ----

/// Ranked upgrade tracks, lowest to highest.
const TRACK_RANKS: &[&str] = &[
    "Explorer",
    "Adventurer",
    "Veteran",
    "Champion",
    "Hero",
    "Myth",
];

/// Return the numeric rank of a track name (0-based), or None if unknown.
pub fn track_rank(track: &str) -> Option<usize> {
    TRACK_RANKS.iter().position(|&t| track.starts_with(t))
}

/// Check if an upgrade string meets a minimum track threshold.
pub fn is_minimum_track(upgrade: &str, minimum: &str) -> bool {
    match (track_rank(upgrade), track_rank(minimum)) {
        (Some(item), Some(min)) => item >= min,
        _ => false,
    }
}

// ---- Static Data Stores ----

static ITEMS: OnceCell<HashMap<u64, Value>> = OnceCell::new();
static ENCHANTS: OnceCell<HashMap<u64, Value>> = OnceCell::new();
static ENCHANTS_BY_ITEM_ID: OnceCell<HashMap<u64, Value>> = OnceCell::new();
static BONUSES: OnceCell<HashMap<u64, Value>> = OnceCell::new();
static UPGRADE_MAX: OnceCell<HashMap<u64, u64>> = OnceCell::new();
static INSTANCES: OnceCell<Vec<Value>> = OnceCell::new();
static DROPS_BY_ENCOUNTER: OnceCell<HashMap<i64, Vec<Value>>> = OnceCell::new();
type UpgradeTrackKey = (String, u64, u64);
type UpgradeTrackValue = (u64, u64, u64);
static UPGRADE_TRACKS: OnceCell<HashMap<UpgradeTrackKey, UpgradeTrackValue>> = OnceCell::new();
/// Per-step upgrade costs: bonus_id → HashMap<currency_id, amount>
static UPGRADE_STEP_COSTS: OnceCell<HashMap<u64, HashMap<u64, u64>>> = OnceCell::new();
/// Squish era → curve ID mapping.
static SQUISH_ERAS: OnceCell<HashMap<u64, u64>> = OnceCell::new();
/// Item curves: curve_id → sorted Vec<(old_ilevel, new_ilevel)>.
static ITEM_CURVES: OnceCell<HashMap<u64, Vec<(u64, u64)>>> = OnceCell::new();
/// Current season ID (highest seasonId found in upgrade bonuses).
static CURRENT_SEASON_ID: OnceCell<u64> = OnceCell::new();
/// Currency metadata: currency_id → (name, icon)
static CURRENCY_INFO: OnceCell<HashMap<u64, (String, String)>> = OnceCell::new();
/// Item limit categories: bonus_id → (category_id, max_quantity)
static ITEM_LIMIT_CATS: OnceCell<HashMap<u64, (u64, u64)>> = OnceCell::new();
static SEASON_CONFIG: OnceCell<Value> = OnceCell::new();
static TALENT_TREES: OnceCell<HashMap<u64, Value>> = OnceCell::new();
/// Localized item names: item_id → { locale → name }
static ITEM_NAMES: OnceCell<HashMap<u64, HashMap<String, String>>> = OnceCell::new();
/// Void Forge map: max-upgrade base bonus_id → voidforged bonus_id
static VOID_FORGE_MAP: OnceCell<HashMap<u64, u64>> = OnceCell::new();

/// Catalyst item info for a specific class + slot combination.
#[derive(Debug, Clone)]
pub struct CatalystTierItem {
    pub item_id: u64,
    pub name: String,
    pub icon: String,
    /// Whether this item is part of a tier set (has itemSetId).
    pub has_set: bool,
}

/// Catalyst conversion data for the current season.
struct CatalystData {
    /// Maps (wow_class_id, inventory_type) → tier item info.
    /// inventory_type 20 (robe) is normalized to 5 (chest).
    tier_items: HashMap<(u64, u64), CatalystTierItem>,
    /// Set of all tier item IDs (for "is this already a tier piece?" checks).
    tier_item_ids: HashSet<u64>,
    /// Currency ID for catalyst charges (e.g. 3378 for Midnight Catalyst).
    pub catalyst_currency_id: u64,
}

static CATALYST: OnceCell<CatalystData> = OnceCell::new();
static FLASKS: OnceCell<Vec<Value>> = OnceCell::new();
static POTIONS: OnceCell<Vec<Value>> = OnceCell::new();
static FOODS: OnceCell<Vec<Value>> = OnceCell::new();
static AUGMENTS: OnceCell<Vec<Value>> = OnceCell::new();
static TEMP_ENCHANTS: OnceCell<Vec<Value>> = OnceCell::new();

// ---- Load ----

fn build_void_forge_map() -> HashMap<u64, u64> {
    use regex::Regex;
    let bonuses = match BONUSES.get() {
        Some(b) => b,
        None => return HashMap::new(),
    };

    // First pass: collect "Voidforged: <Tier>" entries.
    // Pattern matches "Ascendant Voidforged: Myth", "Galactic Void-Charged: Hero", etc.
    let tag_re =
        Regex::new(r"^(?:Ascendant|Galactic)\s+Void(?:forged|-Charged):\s*(\w+)$").unwrap();
    let mut vf_by_tier: HashMap<String, u64> = HashMap::new();
    for (bonus_id, value) in bonuses.iter() {
        if let Some(tag) = value.get("tag").and_then(|t| t.as_str()) {
            if let Some(caps) = tag_re.captures(tag) {
                let tier = caps[1].to_string();
                vf_by_tier.insert(tier, *bonus_id);
            }
        }
    }

    if vf_by_tier.is_empty() {
        return HashMap::new();
    }

    // Second pass: for each base bonus where upgrade.fullName == "<Tier> 6/6",
    // map base_bonus_id -> vf_bonus_id.
    let mut map: HashMap<u64, u64> = HashMap::new();
    for (base_id, value) in bonuses.iter() {
        let full_name = value
            .get("upgrade")
            .and_then(|u| u.get("fullName"))
            .and_then(|n| n.as_str());
        let Some(full_name) = full_name else { continue };
        // Expect "<Tier> N/M" — match only the max step (e.g. "Myth 6/6")
        let Some((tier, step)) = full_name.split_once(' ') else {
            continue;
        };
        let Some((cur, max)) = step.split_once('/') else {
            continue;
        };
        if cur != max {
            continue;
        }
        if let Some(vf_id) = vf_by_tier.get(tier) {
            map.insert(*base_id, *vf_id);
        }
    }

    map
}

pub fn load(data_dir: &Path) {
    // equippable-items-full.json
    let items_path = data_dir.join("equippable-items-full.json");
    if items_path.exists() {
        let data: Vec<Value> = serde_json::from_reader(std::io::BufReader::new(
            fs::File::open(&items_path).unwrap(),
        ))
        .unwrap_or_default();
        let map: HashMap<u64, Value> = data
            .into_iter()
            .filter_map(|v| {
                let id = v.get("id")?.as_u64()?;
                Some((id, v))
            })
            .collect();
        println!("Loaded {} items", map.len());
        let _ = ITEMS.set(map);
    }

    // enchantments.json
    let enchants_path = data_dir.join("enchantments.json");
    if enchants_path.exists() {
        let data: Vec<Value> = serde_json::from_reader(std::io::BufReader::new(
            fs::File::open(&enchants_path).unwrap(),
        ))
        .unwrap_or_default();
        let by_id: HashMap<u64, Value> = data
            .iter()
            .filter_map(|v| {
                let id = v.get("id")?.as_u64()?;
                Some((id, v.clone()))
            })
            .collect();
        let by_item_id: HashMap<u64, Value> = data
            .into_iter()
            .filter_map(|v| {
                let item_id = v.get("itemId")?.as_u64()?;
                Some((item_id, v))
            })
            .collect();
        println!("Loaded {} enchants", by_id.len());
        let _ = ENCHANTS.set(by_id);
        let _ = ENCHANTS_BY_ITEM_ID.set(by_item_id);
    }

    // bonuses.json
    let bonuses_path = data_dir.join("bonuses.json");
    if bonuses_path.exists() {
        let raw: HashMap<String, Value> = serde_json::from_reader(std::io::BufReader::new(
            fs::File::open(&bonuses_path).unwrap(),
        ))
        .unwrap_or_default();
        let map: HashMap<u64, Value> = raw
            .into_iter()
            .filter_map(|(k, v)| {
                let id = k.parse::<u64>().ok()?;
                Some((id, v))
            })
            .collect();

        // Build upgrade group index and find current season ID
        let mut groups: HashMap<u64, Vec<(u64, u64)>> = HashMap::new();
        let mut max_season_id: u64 = 0;
        for (bid, bonus) in &map {
            if let Some(upgrade) = bonus.get("upgrade") {
                if let (Some(group), Some(level)) = (
                    upgrade.get("group").and_then(|g| g.as_u64()),
                    upgrade.get("level").and_then(|l| l.as_u64()),
                ) {
                    groups.entry(group).or_default().push((*bid, level));
                }
                if let Some(sid) = upgrade.get("seasonId").and_then(|s| s.as_u64()) {
                    if sid > max_season_id {
                        max_season_id = sid;
                    }
                }
            }
        }
        let _ = CURRENT_SEASON_ID.set(max_season_id);
        let mut upgrade_max: HashMap<u64, u64> = HashMap::new();
        for members in groups.values() {
            let max_bonus_id = members
                .iter()
                .max_by_key(|(_, level)| *level)
                .map(|(id, _)| *id)
                .unwrap_or(0);
            for (bid, _) in members {
                upgrade_max.insert(*bid, max_bonus_id);
            }
        }
        println!(
            "Loaded {} bonuses, {} upgrade groups",
            map.len(),
            groups.len()
        );
        let _ = BONUSES.set(map);
        let _ = UPGRADE_MAX.set(upgrade_max);

        let vf_map = build_void_forge_map();
        println!("Derived {} void forge mappings", vf_map.len());
        let _ = VOID_FORGE_MAP.set(vf_map);
    }

    // bonus-upgrade-sets.json + seasons.json -> upgrade track lookup
    let bus_path = data_dir.join("bonus-upgrade-sets.json");
    let seasons_path = data_dir.join("seasons.json");
    if bus_path.exists() {
        let bus_raw: HashMap<String, Vec<Value>> =
            serde_json::from_reader(std::io::BufReader::new(fs::File::open(&bus_path).unwrap()))
                .unwrap_or_default();

        let mut active_groups: Option<Vec<u64>> = None;
        if seasons_path.exists() {
            let seasons: Vec<Value> = serde_json::from_reader(std::io::BufReader::new(
                fs::File::open(&seasons_path).unwrap(),
            ))
            .unwrap_or_default();
            if let Some(active) = seasons
                .iter()
                .find(|s| s.get("active").and_then(|a| a.as_bool()).unwrap_or(false))
            {
                let groups: Vec<u64> = active
                    .get("bonusListGroups")
                    .and_then(|g| g.as_array())
                    .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
                    .unwrap_or_default();
                let name = active
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("unknown");
                println!("Active season: {}, groups: {:?}", name, groups);
                active_groups = Some(groups);
            }
        }

        let bonuses_map = BONUSES.get();
        let mut tracks: HashMap<(String, u64, u64), (u64, u64, u64)> = HashMap::new();
        let mut step_costs: HashMap<u64, HashMap<u64, u64>> = HashMap::new();
        let mut currencies: HashMap<u64, (String, String)> = HashMap::new();

        for (group_id_str, entries) in &bus_raw {
            let group_id: u64 = group_id_str.parse().unwrap_or(0);
            if let Some(ref ag) = active_groups {
                if !ag.contains(&group_id) {
                    continue;
                }
            }
            for entry in entries {
                let name = entry.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let level = entry.get("level").and_then(|l| l.as_u64()).unwrap_or(0);
                let max_level = entry.get("max").and_then(|m| m.as_u64()).unwrap_or(0);
                let ilvl = entry.get("itemLevel").and_then(|i| i.as_u64()).unwrap_or(0);
                let bonus_id = entry.get("bonusId").and_then(|b| b.as_u64()).unwrap_or(0);
                let quality = bonuses_map
                    .and_then(|bm| bm.get(&bonus_id))
                    .and_then(|b| b.get("quality"))
                    .and_then(|q| q.as_u64())
                    .unwrap_or(4);
                if !name.is_empty() && level > 0 && max_level > 0 && ilvl > 0 {
                    tracks.insert(
                        (name.to_string(), level, max_level),
                        (ilvl, bonus_id, quality),
                    );
                }

                // Extract per-step cost and currency metadata
                if bonus_id > 0 {
                    if let Some(currency) = entry.get("currency") {
                        let cid = currency.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                        let amount = currency.get("amount").and_then(|v| v.as_u64()).unwrap_or(0);
                        if cid > 0 && amount > 0 {
                            step_costs.entry(bonus_id).or_default().insert(cid, amount);
                            currencies.entry(cid).or_insert_with(|| {
                                let n = currency
                                    .get("name")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let i = currency
                                    .get("icon")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                (n, i)
                            });
                        }
                    }
                }
            }
        }
        println!(
            "Indexed {} upgrade track entries, {} step costs, {} currencies",
            tracks.len(),
            step_costs.len(),
            currencies.len()
        );
        let _ = UPGRADE_TRACKS.set(tracks);
        let _ = UPGRADE_STEP_COSTS.set(step_costs);
        let _ = CURRENCY_INFO.set(currencies);
    }

    // instances.json
    let instances_path = data_dir.join("instances.json");
    if instances_path.exists() {
        let data: Vec<Value> = serde_json::from_reader(std::io::BufReader::new(
            fs::File::open(&instances_path).unwrap(),
        ))
        .unwrap_or_default();
        println!("Loaded {} instances", data.len());
        let _ = INSTANCES.set(data);
    }

    // Build encounter -> items index from encounter-items.json (curated drop data).
    // Each item gets a `_source_instance_id` field so get_instance_drops can filter
    // items that share encounter IDs across multiple instances (e.g. profession pools).
    let encounter_items_path = data_dir.join("encounter-items.json");
    let mut drops: HashMap<i64, Vec<Value>> = HashMap::new();
    if encounter_items_path.exists() {
        let data: Vec<Value> = serde_json::from_reader(std::io::BufReader::new(
            fs::File::open(&encounter_items_path).unwrap(),
        ))
        .unwrap_or_default();
        println!("Loaded {} encounter items", data.len());
        for item in &data {
            if let Some(sources) = item.get("sources").and_then(|s| s.as_array()) {
                for src in sources {
                    if let Some(eid) = src.get("encounterId").and_then(|e| e.as_i64()) {
                        let mut entry = item.clone();
                        if let Some(iid) = src.get("instanceId").and_then(|v| v.as_i64()) {
                            entry.as_object_mut().map(|o| {
                                o.insert("_source_instance_id".to_string(), serde_json::json!(iid))
                            });
                        }
                        drops.entry(eid).or_default().push(entry);
                    }
                }
            }
        }
    }
    println!("Indexed drops for {} encounters", drops.len());
    let _ = DROPS_BY_ENCOUNTER.set(drops);

    // season-config.json — check data_dir first, fall back to crate root
    let season_path = data_dir.join("season-config.json");
    let season_path = if season_path.exists() {
        season_path
    } else {
        // Fall back to bundled config next to core/Cargo.toml
        Path::new(env!("CARGO_MANIFEST_DIR")).join("season-config.json")
    };
    if season_path.exists() {
        let cfg: Value = serde_json::from_reader(std::io::BufReader::new(
            fs::File::open(&season_path).unwrap(),
        ))
        .unwrap_or(Value::Null);
        let name = cfg
            .get("season")
            .and_then(|s| s.as_str())
            .unwrap_or("unknown");
        println!("Loaded season config: {}", name);
        let _ = SEASON_CONFIG.set(cfg);
    }

    // item-limit-categories.json — build bonus_id → (category_id, max_quantity) lookup
    let limit_cats_path = data_dir.join("item-limit-categories.json");
    if limit_cats_path.exists() {
        let raw: HashMap<String, Value> = serde_json::from_reader(std::io::BufReader::new(
            fs::File::open(&limit_cats_path).unwrap(),
        ))
        .unwrap_or_default();
        let cats: HashMap<u64, u64> = raw
            .into_iter()
            .filter_map(|(k, v)| {
                let id = k.parse::<u64>().ok()?;
                let qty = v.get("quantity")?.as_u64()?;
                Some((id, qty))
            })
            .collect();
        // Map each bonus that has item_limit_category → (category_id, max_quantity)
        let mut lookup: HashMap<u64, (u64, u64)> = HashMap::new();
        if let Some(bonuses) = BONUSES.get() {
            for (bid, bonus) in bonuses {
                if let Some(cat_id) = bonus.get("item_limit_category").and_then(|c| c.as_u64()) {
                    if let Some(&qty) = cats.get(&cat_id) {
                        lookup.insert(*bid, (cat_id, qty));
                    }
                }
            }
        }
        println!("Loaded {} item limit category mappings", lookup.len());
        let _ = ITEM_LIMIT_CATS.set(lookup);
    }

    // talents.json
    let talents_path = data_dir.join("talents.json");
    if talents_path.exists() {
        let data: Vec<Value> = serde_json::from_reader(std::io::BufReader::new(
            fs::File::open(&talents_path).unwrap(),
        ))
        .unwrap_or_default();
        let map: HashMap<u64, Value> = data
            .into_iter()
            .filter_map(|v| {
                let spec_id = v.get("specId")?.as_u64()?;
                Some((spec_id, v))
            })
            .collect();
        println!("Loaded {} talent trees", map.len());
        let _ = TALENT_TREES.set(map);
    }

    // item-squish-era.json — squish era → curve ID mapping
    let squish_path = data_dir.join("item-squish-era.json");
    if squish_path.exists() {
        let data: Vec<Value> = serde_json::from_reader(std::io::BufReader::new(
            fs::File::open(&squish_path).unwrap(),
        ))
        .unwrap_or_default();
        let map: HashMap<u64, u64> = data
            .iter()
            .filter_map(|entry| {
                let id = entry.get("id")?.as_u64()?;
                let curve_id = entry.get("curveId")?.as_u64()?;
                if curve_id > 0 {
                    Some((id, curve_id))
                } else {
                    None
                }
            })
            .collect();
        println!("Loaded {} squish eras", map.len());
        let _ = SQUISH_ERAS.set(map);
    }

    // item-curves.json — curve ID → points for ilevel conversion
    let curves_path = data_dir.join("item-curves.json");
    if curves_path.exists() {
        let data: HashMap<String, Value> = serde_json::from_reader(std::io::BufReader::new(
            fs::File::open(&curves_path).unwrap(),
        ))
        .unwrap_or_default();
        let map: HashMap<u64, Vec<(u64, u64)>> = data
            .into_iter()
            .filter_map(|(key, val)| {
                let curve_id = key.parse::<u64>().ok()?;
                let points = val.get("points")?.as_array()?;
                let mut pts: Vec<(u64, u64)> = points
                    .iter()
                    .filter_map(|p| {
                        let old = p.get("playerLevel")?.as_u64()?;
                        let new = p.get("itemLevel")?.as_u64()?;
                        Some((old, new))
                    })
                    .collect();
                pts.sort_by_key(|(old, _)| *old);
                Some((curve_id, pts))
            })
            .collect();
        println!("Loaded {} item curves", map.len());
        let _ = ITEM_CURVES.set(map);
    }

    // item-conversions.json — catalyst tier items
    let conversions_path = data_dir.join("item-conversions.json");
    if conversions_path.exists() {
        let data: HashMap<String, Value> = serde_json::from_reader(std::io::BufReader::new(
            fs::File::open(&conversions_path).unwrap(),
        ))
        .unwrap_or_default();

        // Find the latest conversion group (highest numeric key)
        let latest_group = data.keys().filter_map(|k| k.parse::<u64>().ok()).max();

        if let Some(group_id) = latest_group {
            if let Some(group) = data.get(&group_id.to_string()) {
                let mut tier_items: HashMap<(u64, u64), CatalystTierItem> = HashMap::new();
                let mut tier_item_ids: HashSet<u64> = HashSet::new();

                if let Some(items) = group.get("items").and_then(|v| v.as_array()) {
                    for item in items {
                        let item_id = match item.get("id").and_then(|v| v.as_u64()) {
                            Some(id) => id,
                            None => continue,
                        };
                        let mut inv_type = match item.get("inventoryType").and_then(|v| v.as_u64())
                        {
                            Some(t) => t,
                            None => continue,
                        };
                        // Normalize robe (20) to chest (5)
                        if inv_type == 20 {
                            inv_type = 5;
                        }
                        let has_set = item.get("itemSetId").and_then(|v| v.as_u64()).is_some();
                        let name = item
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let icon = item
                            .get("icon")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let classes = item
                            .get("allowableClasses")
                            .and_then(|v| v.as_array())
                            .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect::<Vec<_>>())
                            .unwrap_or_default();

                        if has_set {
                            tier_item_ids.insert(item_id);
                        }
                        for class_id in &classes {
                            tier_items.insert(
                                (*class_id, inv_type),
                                CatalystTierItem {
                                    item_id,
                                    name: name.clone(),
                                    icon: icon.clone(),
                                    has_set,
                                },
                            );
                        }
                    }
                }

                // Determine catalyst currency ID from season config or default
                // Current season: 3378 (Midnight Catalyst)
                let catalyst_currency_id = season_cfg()
                    .get("catalyst_currency_id")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(3378);

                println!(
                    "Loaded {} catalyst items (group {}, currency {})",
                    tier_items.len(),
                    group_id,
                    catalyst_currency_id
                );
                let _ = CATALYST.set(CatalystData {
                    tier_items,
                    tier_item_ids,
                    catalyst_currency_id,
                });
            }
        }
    }

    // item-names.json — localized item names
    let names_path = data_dir.join("item-names.json");
    if names_path.exists() {
        let raw: Value = serde_json::from_reader(std::io::BufReader::new(
            fs::File::open(&names_path).unwrap(),
        ))
        .unwrap_or_default();
        let mut map: HashMap<u64, HashMap<String, String>> = HashMap::new();
        if let Some(sparse) = raw.get("ItemSparse").and_then(|v| v.as_object()) {
            for (id_str, locales) in sparse {
                if let Ok(id) = id_str.parse::<u64>() {
                    if let Some(obj) = locales.as_object() {
                        let locale_map: HashMap<String, String> = obj
                            .iter()
                            .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
                            .collect();
                        if !locale_map.is_empty() {
                            map.insert(id, locale_map);
                        }
                    }
                }
            }
        }
        println!("Loaded {} localized item names", map.len());
        let _ = ITEM_NAMES.set(map);
    }

    // Consumable data files
    for (filename, cell) in [
        ("flasks.json", &FLASKS),
        ("potions.json", &POTIONS),
        ("foods.json", &FOODS),
        ("augments.json", &AUGMENTS),
        ("temp-enchants.json", &TEMP_ENCHANTS),
    ] {
        let path = data_dir.join(filename);
        if path.exists() {
            let data: Vec<Value> =
                serde_json::from_reader(std::io::BufReader::new(fs::File::open(&path).unwrap()))
                    .unwrap_or_default();
            println!("Loaded {} entries from {}", data.len(), filename);
            let _ = cell.set(data);
        }
    }
}

// ---- Accessors ----

pub fn items() -> &'static HashMap<u64, Value> {
    ITEMS.get().expect("Game data not loaded")
}

pub fn list_flasks() -> &'static [Value] {
    FLASKS.get().map(|v| v.as_slice()).unwrap_or(&[])
}

pub fn list_potions() -> &'static [Value] {
    POTIONS.get().map(|v| v.as_slice()).unwrap_or(&[])
}

pub fn list_foods() -> &'static [Value] {
    FOODS.get().map(|v| v.as_slice()).unwrap_or(&[])
}

pub fn list_augments() -> &'static [Value] {
    AUGMENTS.get().map(|v| v.as_slice()).unwrap_or(&[])
}

pub fn list_temp_enchants() -> &'static [Value] {
    TEMP_ENCHANTS.get().map(|v| v.as_slice()).unwrap_or(&[])
}

pub fn item_names() -> Option<&'static HashMap<u64, HashMap<String, String>>> {
    ITEM_NAMES.get()
}

pub fn enchants() -> &'static HashMap<u64, Value> {
    ENCHANTS.get().expect("Game data not loaded")
}

pub fn enchants_by_item_id() -> &'static HashMap<u64, Value> {
    ENCHANTS_BY_ITEM_ID.get().expect("Game data not loaded")
}

pub fn bonuses() -> &'static HashMap<u64, Value> {
    BONUSES.get().expect("Game data not loaded")
}

pub fn void_forge_map() -> &'static HashMap<u64, u64> {
    VOID_FORGE_MAP.get_or_init(HashMap::new)
}

fn upgrade_max() -> &'static HashMap<u64, u64> {
    UPGRADE_MAX.get().expect("Game data not loaded")
}

pub fn instances() -> &'static Vec<Value> {
    INSTANCES.get().expect("Game data not loaded")
}

pub fn drops_by_encounter() -> &'static HashMap<i64, Vec<Value>> {
    DROPS_BY_ENCOUNTER.get().expect("Game data not loaded")
}

pub fn talent_tree(spec_id: u64) -> Option<&'static Value> {
    TALENT_TREES.get()?.get(&spec_id)
}

/// Return all talent trees that share the same classId as the given specId.
pub fn talent_trees_for_class(spec_id: u64) -> Vec<&'static Value> {
    let trees = match TALENT_TREES.get() {
        Some(t) => t,
        None => return Vec::new(),
    };
    let class_id = match trees.get(&spec_id) {
        Some(t) => t.get("classId").and_then(|v| v.as_u64()),
        None => return Vec::new(),
    };
    let class_id = match class_id {
        Some(id) => id,
        None => return Vec::new(),
    };
    trees
        .values()
        .filter(|t| t.get("classId").and_then(|v| v.as_u64()) == Some(class_id))
        .collect()
}

/// Look up the catalyst tier item for a given WoW class ID and inventory type.
/// Returns None if catalyst data isn't loaded or no tier item exists for that combo.
pub fn catalyst_tier_item(class_id: u64, inv_type: u64) -> Option<&'static CatalystTierItem> {
    let cat = CATALYST.get()?;
    // Normalize robe (20) → chest (5)
    let inv = if inv_type == 20 { 5 } else { inv_type };
    cat.tier_items.get(&(class_id, inv))
}

/// Check if an item_id is a catalyst tier piece.
pub fn is_catalyst_tier_item(item_id: u64) -> bool {
    CATALYST
        .get()
        .map(|c| c.tier_item_ids.contains(&item_id))
        .unwrap_or(false)
}

/// Filter bonus_ids to keep only those that set item level (have `itemLevel` in bonuses.json).
pub fn filter_ilevel_bonus_ids(bonus_ids: &[u64]) -> Vec<u64> {
    let bonuses = match BONUSES.get() {
        Some(b) => b,
        None => return vec![],
    };
    bonus_ids
        .iter()
        .filter(|&&bid| bonuses.get(&bid).and_then(|b| b.get("itemLevel")).is_some())
        .copied()
        .collect()
}

/// Tier set marker bonus ID (13575 for current season).
/// Added to catalyst items that are part of a tier set.
const TIER_SET_BONUS_ID: u64 = 13575;

/// Get the tier set marker bonus ID.
pub fn tier_set_bonus_id() -> u64 {
    TIER_SET_BONUS_ID
}

/// Get the catalyst currency ID for the current season (e.g. 3378).
/// Get the current season ID (highest seasonId found in upgrade bonuses).
pub fn current_season_id() -> u64 {
    CURRENT_SEASON_ID.get().copied().unwrap_or(0)
}

pub fn catalyst_currency_id() -> u64 {
    CATALYST
        .get()
        .map(|c| c.catalyst_currency_id)
        .unwrap_or(3378)
}

pub fn upgrade_tracks() -> Option<&'static HashMap<UpgradeTrackKey, UpgradeTrackValue>> {
    UPGRADE_TRACKS.get()
}

static EMPTY_SEASON_CONFIG: once_cell::sync::Lazy<Value> =
    once_cell::sync::Lazy::new(|| serde_json::json!({}));

pub fn season_cfg() -> &'static Value {
    SEASON_CONFIG.get().unwrap_or(&EMPTY_SEASON_CONFIG)
}

/// Most common max upgrade level across all tracks.
pub fn upgrade_track_max() -> u64 {
    if let Some(tracks) = UPGRADE_TRACKS.get() {
        let mut counts: HashMap<u64, usize> = HashMap::new();
        for (_, _, max) in tracks.keys() {
            *counts.entry(*max).or_default() += 1;
        }
        counts
            .into_iter()
            .max_by_key(|(_, count)| *count)
            .map(|(max, _)| max)
            .unwrap_or(6)
    } else {
        6
    }
}

// ---- Bonus Resolution ----

pub(crate) fn resolve_bonuses(bonus_ids: &[u64]) -> BonusResolved {
    let mut result = BonusResolved::default();
    let mut upgrade_ilevel: Option<u64> = None;
    let mut level_offset: i64 = 0;
    let mut ilevel_priority: i64 = -1;

    for bid in bonus_ids {
        if let Some(bonus) = bonuses().get(bid) {
            if let Some(q) = bonus.get("quality").and_then(|q| q.as_u64()) {
                result.quality = Some(q);
            }
            if let Some(il_obj) = bonus.get("itemLevel") {
                let priority = il_obj.get("priority").and_then(|p| p.as_i64()).unwrap_or(0);
                if priority >= ilevel_priority {
                    if let Some(amount) = il_obj.get("amount").and_then(|a| a.as_u64()) {
                        result.ilevel = Some(amount);
                        ilevel_priority = priority;
                    }
                }
            }
            if let Some(offset) = bonus
                .get("levelOffset")
                .and_then(|lo| lo.get("amount"))
                .and_then(|a| a.as_i64())
            {
                level_offset += offset;
            }
            if let Some(tag) = bonus.get("tag").and_then(|t| t.as_str()) {
                result.tag = Some(tag.to_string());
            }
            if let Some(socket) = bonus.get("socket").and_then(|s| s.as_u64()) {
                // Crafted items stack multiple socket-adding bonuses, so accumulate.
                result.sockets = Some(result.sockets.unwrap_or(0) + socket);
            }
            if let Some(upgrade) = bonus.get("upgrade") {
                if let Some(full_name) = upgrade.get("fullName").and_then(|f| f.as_str()) {
                    result.upgrade = Some(full_name.to_string());
                }
                if let Some(il) = upgrade.get("itemLevel").and_then(|i| i.as_u64()) {
                    upgrade_ilevel = Some(il);
                }
                if let Some(sid) = upgrade.get("seasonId").and_then(|s| s.as_u64()) {
                    result.season_id = Some(sid);
                }
            }
        }
    }

    // upgrade.itemLevel is the resolved track value — it takes priority
    // over itemLevel.amount (which can be a curve-based unresolved value)
    if let Some(il) = upgrade_ilevel {
        result.ilevel = Some(il);
    }

    // Apply level offset on top of resolved ilevel
    if level_offset != 0 {
        if let Some(il) = result.ilevel {
            result.ilevel = Some((il as i64 + level_offset).max(0) as u64);
        }
    }

    result
}

// ---- Item Lookups ----

/// Get the raw JSON entry for an item from the DB.
pub(crate) fn get_raw_item(item_id: u64) -> Option<&'static Value> {
    // Use the cell directly rather than `items()` so unit tests that don't
    // exercise item lookups (and therefore don't load game data) can still
    // exercise validators / generators without panicking on incidental
    // inventory-type queries. Production paths always load data at startup.
    ITEMS.get()?.get(&item_id)
}

/// For a set of bonus IDs, return the item limit categories they belong to.
/// Returns a map of category_id → max_quantity for each matching category.
pub fn get_item_limit_categories(bonus_ids: &[u64]) -> HashMap<u64, u64> {
    let cats = match ITEM_LIMIT_CATS.get() {
        Some(c) => c,
        None => return HashMap::new(),
    };
    let mut result: HashMap<u64, u64> = HashMap::new();
    for bid in bonus_ids {
        if let Some(&(cat_id, qty)) = cats.get(bid) {
            result.insert(cat_id, qty);
        }
    }
    result
}

/// Get inventory type for an item (e.g. 1=head, 7=legs, 13=one-hand, 17=two-hand).
pub fn get_inventory_type(item_id: u64) -> Option<u64> {
    get_raw_item(item_id)?.get("inventoryType")?.as_u64()
}

pub fn get_item_info(item_id: u64, bonus_ids: Option<&[u64]>) -> Option<ItemInfo> {
    let item = get_raw_item(item_id)?;

    let mut quality = item.get("quality").and_then(|q| q.as_u64()).unwrap_or(1);
    let mut ilevel = item.get("itemLevel").and_then(|i| i.as_u64()).unwrap_or(0);
    let mut tag = String::new();
    let mut sockets: u64 = 0;
    let mut upgrade = String::new();

    let mut bonus_set_ilevel = false;
    if let Some(bids) = bonus_ids {
        let resolved = resolve_bonuses(bids);
        if let Some(q) = resolved.quality {
            quality = q;
        }
        if let Some(i) = resolved.ilevel {
            ilevel = i;
            bonus_set_ilevel = true;
        }
        if let Some(t) = resolved.tag {
            tag = t;
        }
        if let Some(s) = resolved.sockets {
            sockets = s;
        }
        if let Some(u) = resolved.upgrade {
            upgrade = u;
        }
    }

    // Only apply squish to the base DB ilevel — bonus-resolved ilevels are already correct
    if !bonus_set_ilevel {
        ilevel = squish_ilevel(item_id, ilevel);
    }

    let item_class = item.get("itemClass").and_then(|c| c.as_u64()).unwrap_or(0);
    let item_subclass = item
        .get("itemSubClass")
        .and_then(|s| s.as_u64())
        .unwrap_or(0);
    let armor_subclass = if item_class == 4 { item_subclass } else { 0 };
    let inventory_type = item
        .get("inventoryType")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    Some(ItemInfo {
        item_id,
        name: item
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("Unknown")
            .to_string(),
        icon: item
            .get("icon")
            .and_then(|i| i.as_str())
            .unwrap_or("inv_misc_questionmark")
            .to_string(),
        ilevel,
        quality,
        quality_name: class_data::quality_name(quality).to_string(),
        tag,
        upgrade,
        sockets,
        armor_subclass,
        inventory_type,
        item_class,
        item_subclass,
    })
}

pub fn get_enchant_info(enchant_id: u64) -> Option<Value> {
    let enchant = enchants().get(&enchant_id)?;
    let name = enchant
        .get("itemName")
        .or_else(|| enchant.get("displayName"))
        .and_then(|n| n.as_str())
        .unwrap_or("");
    let item_id = enchant.get("itemId").and_then(|v| v.as_u64()).unwrap_or(0);
    Some(serde_json::json!({ "enchant_id": enchant_id, "name": name, "item_id": item_id }))
}

pub fn get_gem_info(gem_item_id: u64) -> Option<Value> {
    let gem = enchants_by_item_id().get(&gem_item_id)?;
    let name = gem
        .get("itemName")
        .or_else(|| gem.get("displayName"))
        .and_then(|n| n.as_str())
        .unwrap_or("");
    let icon = gem
        .get("itemIcon")
        .or_else(|| gem.get("spellIcon"))
        .and_then(|i| i.as_str())
        .unwrap_or("");
    let quality = gem.get("quality").and_then(|q| q.as_u64()).unwrap_or(3);
    Some(
        serde_json::json!({ "gem_id": gem_item_id, "name": name, "icon": icon, "quality": quality }),
    )
}

/// Convert a SimC slot name to the WoW inventory type bitmask used in enchantments.json.
/// Returns 0 for main_hand (weapon enchants have invTypeMask=0).
fn slot_to_inv_type_mask(slot: &str) -> u64 {
    match slot {
        "head" => 2,                   // 1 << 1 (invType 1)
        "neck" => 4,                   // 1 << 2 (invType 2)
        "shoulder" => 8,               // 1 << 3 (invType 3)
        "chest" => 1048608,            // (1 << 5) | (1 << 20) (invType 5 + Robe 20)
        "waist" => 64,                 // 1 << 6 (invType 6)
        "legs" => 128,                 // 1 << 7 (invType 7)
        "feet" => 256,                 // 1 << 8 (invType 8)
        "wrist" => 512,                // 1 << 9 (invType 9)
        "hands" => 1024,               // 1 << 10 (invType 10)
        "finger1" | "finger2" => 2048, // 1 << 11 (invType 11)
        "back" => 65536,               // 1 << 16 (invType 16)
        _ => 0,
    }
}

/// List all enchantments for a given expansion and slot.
/// Returns full enchant JSON values (excluding gems which have slot="socket").
pub fn list_enchants_for_slot(expansion: u64, slot: &str) -> Vec<Value> {
    let is_weapon = slot == "main_hand";
    let mask = slot_to_inv_type_mask(slot);

    enchants()
        .values()
        .filter(|e| {
            // Must match expansion
            let exp = e.get("expansion").and_then(|v| v.as_u64()).unwrap_or(0);
            if exp != expansion {
                return false;
            }
            // Exclude gems
            if e.get("slot").and_then(|v| v.as_str()) == Some("socket") {
                return false;
            }
            let reqs = match e.get("equipRequirements") {
                Some(r) => r,
                None => return false,
            };
            let inv_mask = reqs
                .get("invTypeMask")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let item_class = reqs.get("itemClass").and_then(|v| v.as_u64()).unwrap_or(0);

            if is_weapon {
                // Weapon enchants have invTypeMask=0 and itemClass=2 (weapon)
                inv_mask == 0 && item_class == 2
            } else if mask == 0 {
                false
            } else {
                (inv_mask & mask) != 0
            }
        })
        .cloned()
        .collect()
}

/// List all gems for a given expansion.
/// Gems are identified by having slot="socket" in enchantments.json.
pub fn list_gems(expansion: u64) -> Vec<Value> {
    enchants()
        .values()
        .filter(|e| {
            let exp = e.get("expansion").and_then(|v| v.as_u64()).unwrap_or(0);
            exp == expansion && e.get("slot").and_then(|v| v.as_str()) == Some("socket")
        })
        .cloned()
        .collect()
}

/// Check if an item has a squishEra (legacy/timewalking item).
pub fn has_squish_era(item_id: u64) -> bool {
    get_raw_item(item_id)
        .and_then(|item| item.get("squishEra"))
        .is_some()
}

/// Apply squish era ilevel conversion for an item. Returns the squished ilevel,
/// or the original ilevel if the item has no squishEra or no matching curve.
pub fn squish_ilevel(item_id: u64, ilevel: u64) -> u64 {
    let item = match get_raw_item(item_id) {
        Some(i) => i,
        None => return ilevel,
    };
    let era = match item.get("squishEra").and_then(|e| e.as_u64()) {
        Some(e) => e,
        None => return ilevel,
    };
    let curve_id = match SQUISH_ERAS.get().and_then(|m| m.get(&era)) {
        Some(&c) => c,
        None => return ilevel,
    };
    let points = match ITEM_CURVES.get().and_then(|m| m.get(&curve_id)) {
        Some(p) => p,
        None => return ilevel,
    };
    interpolate_curve(points, ilevel)
}

/// Linearly interpolate a curve: find the two surrounding points and lerp.
fn interpolate_curve(points: &[(u64, u64)], input: u64) -> u64 {
    if points.is_empty() {
        return input;
    }
    // Clamp to curve bounds
    if input <= points[0].0 {
        return points[0].1;
    }
    if input >= points[points.len() - 1].0 {
        return points[points.len() - 1].1;
    }
    // Find surrounding points
    for window in points.windows(2) {
        let (x0, y0) = window[0];
        let (x1, y1) = window[1];
        if input >= x0 && input <= x1 {
            if x0 == x1 {
                return y0;
            }
            // Linear interpolation
            let t = (input - x0) as f64 / (x1 - x0) as f64;
            return (y0 as f64 + t * (y1 as f64 - y0 as f64)).round() as u64;
        }
    }
    input
}

pub fn get_item_armor_subclass(item_id: u64) -> Option<u64> {
    let item = get_raw_item(item_id)?;
    if item.get("itemClass")?.as_u64()? != 4 {
        return None;
    }
    item.get("itemSubClass")?.as_u64()
}

// ---- Upgrade Functions ----

pub fn get_upgrade_options(bonus_ids: &[u64]) -> Option<Vec<Value>> {
    let um = upgrade_max();
    for bid in bonus_ids {
        if um.contains_key(bid) {
            let bonus = bonuses().get(bid)?;
            let group_id = bonus.get("upgrade")?.get("group")?.as_u64()?;
            let mut members: Vec<&Value> = bonuses()
                .values()
                .filter(|b| {
                    b.get("upgrade")
                        .and_then(|u| u.get("group"))
                        .and_then(|g| g.as_u64())
                        == Some(group_id)
                })
                .collect();
            members.sort_by_key(|b| {
                b.get("upgrade")
                    .and_then(|u| u.get("level"))
                    .and_then(|l| l.as_u64())
                    .unwrap_or(0)
            });
            // Build cumulative costs from level 1 upward
            let step_costs = UPGRADE_STEP_COSTS.get();
            let mut cumulative: HashMap<u64, u64> = HashMap::new();

            return Some(
                members
                    .into_iter()
                    .filter_map(|b| {
                        let u = b.get("upgrade")?;
                        let bid = b.get("id")?.as_u64()?;

                        // Get this step's cost and add to cumulative
                        let this_step: HashMap<u64, u64> = step_costs
                            .and_then(|m| m.get(&bid))
                            .cloned()
                            .unwrap_or_default();
                        for (cid, amount) in &this_step {
                            *cumulative.entry(*cid).or_insert(0) += amount;
                        }

                        Some(serde_json::json!({
                            "bonus_id": bid,
                            "level": u.get("level")?.as_u64()?,
                            "max": u.get("max")?.as_u64()?,
                            "name": u.get("name")?.as_str()?,
                            "fullName": u.get("fullName")?.as_str()?,
                            "itemLevel": u.get("itemLevel")?.as_u64()?,
                            "step_costs": this_step,
                            "cumulative_costs": cumulative.clone(),
                        }))
                    })
                    .collect(),
            );
        }
    }
    None
}

pub fn upgrade_bonus_ids_to_max(bonus_ids: &[u64]) -> Vec<u64> {
    let um = upgrade_max();
    bonus_ids
        .iter()
        .map(|bid| *um.get(bid).unwrap_or(bid))
        .collect()
}

pub fn upgrade_simc_input(simc_input: &str) -> String {
    let re = regex::Regex::new(r"bonus_id=([0-9/:]+)").unwrap();
    re.replace_all(simc_input, |caps: &regex::Captures| {
        let raw = &caps[1];
        let sep = if raw.contains('/') { "/" } else { ":" };
        let ids: Vec<u64> = raw
            .split(&['/', ':'][..])
            .filter_map(|s| s.parse().ok())
            .collect();
        let upgraded = upgrade_bonus_ids_to_max(&ids);
        format!(
            "bonus_id={}",
            upgraded
                .iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(sep)
        )
    })
    .to_string()
}

pub fn upgrade_items_by_slot(
    items_by_slot: &HashMap<String, Vec<Value>>,
) -> HashMap<String, Vec<Value>> {
    let bonus_re = regex::Regex::new(r"bonus_id=([0-9/:]+)").unwrap();
    let mut result = HashMap::new();

    for (slot, slot_items) in items_by_slot {
        let new_items: Vec<Value> = slot_items
            .iter()
            .map(|item| {
                let old_bonus_ids: Vec<u64> = item
                    .get("bonus_ids")
                    .and_then(|b| b.as_array())
                    .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
                    .unwrap_or_default();
                let new_bonus_ids = upgrade_bonus_ids_to_max(&old_bonus_ids);
                if new_bonus_ids == old_bonus_ids {
                    return item.clone();
                }

                let mut updated = item.clone();
                updated["bonus_ids"] = serde_json::json!(new_bonus_ids);

                if let Some(simc) = item.get("simc_string").and_then(|s| s.as_str()) {
                    let new_simc = bonus_re
                        .replace(simc, |caps: &regex::Captures| {
                            let raw = &caps[1];
                            let sep = if raw.contains('/') { "/" } else { ":" };
                            format!(
                                "bonus_id={}",
                                new_bonus_ids
                                    .iter()
                                    .map(|id| id.to_string())
                                    .collect::<Vec<_>>()
                                    .join(sep)
                            )
                        })
                        .to_string();
                    updated["simc_string"] = serde_json::json!(new_simc);
                }

                let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
                if let Some(base_item) = items().get(&item_id) {
                    let base_ilevel = base_item
                        .get("itemLevel")
                        .and_then(|v: &Value| v.as_u64())
                        .unwrap_or(0);
                    let resolved = resolve_bonuses(&new_bonus_ids);
                    let new_ilevel = resolved.ilevel.unwrap_or(base_ilevel);
                    updated["ilevel"] = serde_json::json!(new_ilevel);
                }
                updated
            })
            .collect();
        result.insert(slot.clone(), new_items);
    }
    result
}

pub fn apply_copy_enchants(
    items_by_slot: &HashMap<String, Vec<Value>>,
) -> HashMap<String, Vec<Value>> {
    let mut result = HashMap::new();

    for (slot, slot_items) in items_by_slot {
        let equipped = slot_items.iter().find(|it| {
            it.get("is_equipped")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        });
        let ench_id = equipped
            .and_then(|e| e.get("enchant_id"))
            .and_then(|e| e.as_u64())
            .unwrap_or(0);

        if ench_id == 0 {
            result.insert(slot.clone(), slot_items.clone());
            continue;
        }

        let new_items: Vec<Value> = slot_items
            .iter()
            .map(|item| {
                let is_equipped = item
                    .get("is_equipped")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let current_ench = item.get("enchant_id").and_then(|e| e.as_u64()).unwrap_or(0);
                if is_equipped || current_ench != 0 {
                    return item.clone();
                }

                let mut updated = item.clone();
                updated["enchant_id"] = serde_json::json!(ench_id);
                if let Some(simc) = item.get("simc_string").and_then(|s| s.as_str()) {
                    updated["simc_string"] =
                        serde_json::json!(crate::simc_string::set_enchant_id(simc, ench_id));
                }
                updated
            })
            .collect();
        result.insert(slot.clone(), new_items);
    }
    result
}

// ---- Upgrade Tracks (API response) ----

pub fn get_upgrade_tracks() -> Value {
    let mut result: HashMap<String, Vec<Value>> = HashMap::new();
    if let Some(tracks) = UPGRADE_TRACKS.get() {
        for ((name, level, max_level), (ilvl, bonus_id, quality)) in tracks {
            result
                .entry(name.clone())
                .or_default()
                .push(serde_json::json!({
                    "level": level, "max_level": max_level,
                    "ilvl": ilvl, "bonus_id": bonus_id, "quality": quality,
                }));
        }
        for levels in result.values_mut() {
            levels.sort_by_key(|v| v.get("level").and_then(|l| l.as_u64()).unwrap_or(0));
        }
    }
    serde_json::json!(result)
}

// ---- Upgrade Cost Helpers ----

/// Get cumulative upgrade cost from one set of bonus IDs to another.
/// Sums the per-step costs for each bonus_id that changes.
pub fn get_upgrade_cost_between(old_bonus_ids: &[u64], new_bonus_ids: &[u64]) -> HashMap<u64, u64> {
    let costs = match UPGRADE_STEP_COSTS.get() {
        Some(c) => c,
        None => return HashMap::new(),
    };

    let mut total: HashMap<u64, u64> = HashMap::new();

    // Find the upgrade bonus that changed
    for new_bid in new_bonus_ids {
        if old_bonus_ids.contains(new_bid) {
            continue;
        }
        // Walk from old level to new level, summing costs
        let new_bonus = match bonuses().get(new_bid) {
            Some(b) => b,
            None => continue,
        };
        let new_group = new_bonus
            .get("upgrade")
            .and_then(|u| u.get("group"))
            .and_then(|g| g.as_u64());
        let new_level = new_bonus
            .get("upgrade")
            .and_then(|u| u.get("level"))
            .and_then(|l| l.as_u64())
            .unwrap_or(0);

        // Find old level in the same group
        let old_level = old_bonus_ids
            .iter()
            .filter_map(|bid| {
                let b = bonuses().get(bid)?;
                let g = b.get("upgrade")?.get("group")?.as_u64()?;
                if Some(g) == new_group {
                    b.get("upgrade")?.get("level")?.as_u64()
                } else {
                    None
                }
            })
            .next()
            .unwrap_or(0);

        if new_level <= old_level {
            continue;
        }

        // Find all bonus_ids in this group between old_level and new_level
        let group_id = match new_group {
            Some(g) => g,
            None => continue,
        };
        let mut step_bonuses: Vec<(u64, u64)> = bonuses()
            .iter()
            .filter_map(|(bid, b)| {
                let u = b.get("upgrade")?;
                let g = u.get("group")?.as_u64()?;
                let l = u.get("level")?.as_u64()?;
                if g == group_id && l > old_level && l <= new_level {
                    Some((*bid, l))
                } else {
                    None
                }
            })
            .collect();
        step_bonuses.sort_by_key(|(_, l)| *l);

        for (step_bid, _) in step_bonuses {
            if let Some(step_cost) = costs.get(&step_bid) {
                for (cid, amount) in step_cost {
                    *total.entry(*cid).or_insert(0) += amount;
                }
            }
        }
    }

    total
}

/// Get currency metadata by ID.
pub fn get_currency_info(currency_id: u64) -> Option<Value> {
    let info = CURRENCY_INFO.get()?.get(&currency_id)?;
    Some(serde_json::json!({
        "id": currency_id,
        "name": info.0,
        "icon": info.1,
    }))
}

// ---- Season Config Helpers ----

pub fn difficulty_track_name(difficulty: &str) -> Option<String> {
    season_cfg()
        .get("raidDifficultyTracks")
        .and_then(|m| m.get(difficulty))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

pub fn encounter_upgrade_level(encounter_id: i64) -> Option<u64> {
    season_cfg()
        .get("encounterUpgradeLevel")
        .and_then(|m| m.get(encounter_id.to_string()))
        .and_then(|v| v.as_u64())
}

pub fn dungeon_normal_ilvl() -> u64 {
    season_cfg()
        .get("dungeonNormal")
        .and_then(|d| d.get("ilvl"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
}

pub fn dungeon_normal_quality() -> u64 {
    season_cfg()
        .get("dungeonNormal")
        .and_then(|d| d.get("quality"))
        .and_then(|v| v.as_u64())
        .unwrap_or(3)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{ensure_game_data_loaded, TestItem};
    use serde_json::json;

    fn item(
        id: u64,
        is_equipped: bool,
        enchant_id: u64,
        simc_string: &str,
        bonus_ids: Vec<u64>,
    ) -> Value {
        let mut b = TestItem::new(id)
            .enchant_id(enchant_id)
            .simc_string(simc_string)
            .bonus_ids(bonus_ids);
        if is_equipped {
            b = b.equipped();
        }
        b.build()
    }

    // ---- apply_copy_enchants ----

    #[test]
    fn copy_enchants_propagates_equipped_enchant_to_alternatives() {
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert(
            "head".to_string(),
            vec![
                item(100, true, 7777, ",id=100,enchant_id=7777", vec![]),
                item(200, false, 0, ",id=200", vec![]),
                item(300, false, 0, ",id=300", vec![]),
            ],
        );

        let result = apply_copy_enchants(&items_by_slot);
        let head = result.get("head").unwrap();
        assert_eq!(head[0]["enchant_id"], 7777); // equipped unchanged
        assert_eq!(head[1]["enchant_id"], 7777); // alt 200 inherits
        assert_eq!(head[2]["enchant_id"], 7777); // alt 300 inherits
        assert!(head[1]["simc_string"]
            .as_str()
            .unwrap()
            .contains("enchant_id=7777"));
    }

    #[test]
    fn copy_enchants_preserves_alternatives_with_existing_enchant() {
        // Copy-enchants is a "fill in missing" operation: an alternative that
        // already carries an enchant must keep it (the user picked it deliberately).
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert(
            "head".to_string(),
            vec![
                item(100, true, 7777, ",id=100,enchant_id=7777", vec![]),
                item(200, false, 8888, ",id=200,enchant_id=8888", vec![]),
            ],
        );
        let result = apply_copy_enchants(&items_by_slot);
        let head = result.get("head").unwrap();
        assert_eq!(head[1]["enchant_id"], 8888);
        assert!(head[1]["simc_string"]
            .as_str()
            .unwrap()
            .contains("enchant_id=8888"));
    }

    #[test]
    fn copy_enchants_no_op_when_equipped_has_no_enchant() {
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert(
            "head".to_string(),
            vec![
                item(100, true, 0, ",id=100", vec![]),
                item(200, false, 0, ",id=200", vec![]),
            ],
        );
        let result = apply_copy_enchants(&items_by_slot);
        let head = result.get("head").unwrap();
        assert_eq!(head[1]["enchant_id"], 0);
    }

    #[test]
    fn copy_enchants_inserts_enchant_id_when_simc_lacks_one() {
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert(
            "head".to_string(),
            vec![
                item(100, true, 7777, ",id=100,enchant_id=7777", vec![]),
                item(200, false, 0, ",id=200,bonus_id=12", vec![]),
            ],
        );
        let result = apply_copy_enchants(&items_by_slot);
        let head = result.get("head").unwrap();
        let alt_simc = head[1]["simc_string"].as_str().unwrap();
        assert!(
            alt_simc.contains("id=200,enchant_id=7777,bonus_id=12"),
            "expected enchant inserted after id=; got: {alt_simc}"
        );
    }

    #[test]
    fn copy_enchants_per_slot_independent() {
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert(
            "head".to_string(),
            vec![
                item(100, true, 7777, ",id=100,enchant_id=7777", vec![]),
                item(200, false, 0, ",id=200", vec![]),
            ],
        );
        items_by_slot.insert(
            "chest".to_string(),
            vec![
                item(101, true, 8888, ",id=101,enchant_id=8888", vec![]),
                item(201, false, 0, ",id=201", vec![]),
            ],
        );
        let result = apply_copy_enchants(&items_by_slot);
        assert_eq!(result["head"][1]["enchant_id"], 7777);
        assert_eq!(result["chest"][1]["enchant_id"], 8888);
    }

    // ---- upgrade_items_by_slot ----

    #[test]
    fn upgrade_items_by_slot_no_op_when_already_max() {
        ensure_game_data_loaded();
        // Empty bonus_ids → no upgrade applies, items unchanged.
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert(
            "head".to_string(),
            vec![item(100, true, 0, ",id=100", vec![])],
        );
        let result = upgrade_items_by_slot(&items_by_slot);
        assert_eq!(result["head"][0]["bonus_ids"], json!([]));
    }

    #[test]
    fn upgrade_items_by_slot_passes_through_unaffected_items() {
        ensure_game_data_loaded();
        // Unknown bonus_ids that don't map to upgrade tracks should be left alone.
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert(
            "head".to_string(),
            vec![item(100, true, 0, ",id=100,bonus_id=99999", vec![99999])],
        );
        let result = upgrade_items_by_slot(&items_by_slot);
        // Even if no upgrade applies, the item should be present in output.
        assert_eq!(result["head"].len(), 1);
    }

    // ---- upgrade_bonus_ids_to_max ----

    #[test]
    fn upgrade_bonus_ids_to_max_empty_returns_empty() {
        ensure_game_data_loaded();
        assert_eq!(upgrade_bonus_ids_to_max(&[]), Vec::<u64>::new());
    }

    #[test]
    fn upgrade_bonus_ids_to_max_unrelated_bonus_passes_through() {
        ensure_game_data_loaded();
        // Bonus 13440 is a tag bonus, not an upgrade — should pass through unchanged.
        let result = upgrade_bonus_ids_to_max(&[13440]);
        assert_eq!(result, vec![13440]);
    }

    // ---- resolve_bonuses ----

    #[test]
    fn resolve_bonuses_returns_socket_count_for_13534() {
        ensure_game_data_loaded();
        let resolved = resolve_bonuses(&[13534]);
        assert_eq!(resolved.sockets, Some(1));
    }

    #[test]
    fn resolve_bonuses_accumulates_socket_count_across_bonuses() {
        // Crafted items can carry two separate `+1 socket` bonuses to reach
        // 2 sockets. Overwriting on each iteration drops one and Top Gear
        // proposes one fewer gem than the item actually holds.
        ensure_game_data_loaded();
        let resolved = resolve_bonuses(&[13534, 13534]);
        assert_eq!(resolved.sockets, Some(2));
    }

    #[test]
    fn resolve_bonuses_extracts_tag() {
        ensure_game_data_loaded();
        // 13440 has a "tag" property per the data file.
        let resolved = resolve_bonuses(&[13440]);
        assert!(resolved.tag.is_some());
    }

    #[test]
    fn resolve_bonuses_empty_returns_defaults() {
        ensure_game_data_loaded();
        let resolved = resolve_bonuses(&[]);
        assert_eq!(resolved.sockets, None);
        assert_eq!(resolved.tag, None);
        assert_eq!(resolved.ilevel, None);
    }

    // ---- get_item_limit_categories ----

    #[test]
    fn get_item_limit_categories_empty_returns_empty() {
        ensure_game_data_loaded();
        let cats = get_item_limit_categories(&[]);
        assert!(cats.is_empty());
    }
}
