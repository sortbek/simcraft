//! Pure data loading and lookup for items, enchants, gems, bonuses, and upgrades.
//!
//! No filtering, no class logic. Just load JSON files and provide accessors.

use once_cell::sync::OnceCell;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::types::class_data;

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
/// Currency metadata: currency_id → (name, icon)
static CURRENCY_INFO: OnceCell<HashMap<u64, (String, String)>> = OnceCell::new();
static SEASON_CONFIG: OnceCell<Value> = OnceCell::new();

// ---- Load ----

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

        // Build upgrade group index
        let mut groups: HashMap<u64, Vec<(u64, u64)>> = HashMap::new();
        for (bid, bonus) in &map {
            if let Some(upgrade) = bonus.get("upgrade") {
                if let (Some(group), Some(level)) = (
                    upgrade.get("group").and_then(|g| g.as_u64()),
                    upgrade.get("level").and_then(|l| l.as_u64()),
                ) {
                    groups.entry(group).or_default().push((*bid, level));
                }
            }
        }
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

    // Build encounter -> items index
    let mut drops: HashMap<i64, Vec<Value>> = HashMap::new();
    if let Some(items_map) = ITEMS.get() {
        for item in items_map.values() {
            if let Some(sources) = item.get("sources").and_then(|s| s.as_array()) {
                for src in sources {
                    if let Some(eid) = src.get("encounterId").and_then(|e| e.as_i64()) {
                        drops.entry(eid).or_default().push(item.clone());
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
}

// ---- Accessors ----

pub fn items() -> &'static HashMap<u64, Value> {
    ITEMS.get().expect("Game data not loaded")
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

fn upgrade_max() -> &'static HashMap<u64, u64> {
    UPGRADE_MAX.get().expect("Game data not loaded")
}

pub fn instances() -> &'static Vec<Value> {
    INSTANCES.get().expect("Game data not loaded")
}

pub fn drops_by_encounter() -> &'static HashMap<i64, Vec<Value>> {
    DROPS_BY_ENCOUNTER.get().expect("Game data not loaded")
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

pub fn resolve_bonuses(bonus_ids: &[u64]) -> Value {
    let mut result = serde_json::json!({});
    for bid in bonus_ids {
        if let Some(bonus) = bonuses().get(bid) {
            if let Some(q) = bonus.get("quality") {
                result["quality"] = q.clone();
            }
            if let Some(il) = bonus.get("itemLevel").and_then(|il| il.get("amount")) {
                result["ilevel"] = il.clone();
            }
            if let Some(tag) = bonus.get("tag") {
                result["tag"] = tag.clone();
            }
            if let Some(socket) = bonus.get("socket") {
                result["sockets"] = socket.clone();
            }
            if let Some(upgrade) = bonus.get("upgrade").and_then(|u| u.get("fullName")) {
                result["upgrade"] = upgrade.clone();
            }
        }
    }
    result
}

// ---- Item Info ----

pub fn get_item_info(item_id: u64, bonus_ids: Option<&[u64]>) -> Option<Value> {
    let item = items().get(&item_id)?;

    let mut quality = item.get("quality").and_then(|q| q.as_u64()).unwrap_or(1);
    let mut ilevel = item.get("itemLevel").and_then(|i| i.as_u64()).unwrap_or(0);
    let mut tag = String::new();
    let mut sockets: u64 = 0;
    let mut upgrade = String::new();

    if let Some(bids) = bonus_ids {
        let resolved = resolve_bonuses(bids);
        if let Some(q) = resolved.get("quality").and_then(|q| q.as_u64()) {
            quality = q;
        }
        if let Some(i) = resolved.get("ilevel").and_then(|i| i.as_u64()) {
            ilevel = i;
        }
        if let Some(t) = resolved.get("tag").and_then(|t| t.as_str()) {
            tag = t.to_string();
        }
        if let Some(s) = resolved.get("sockets").and_then(|s| s.as_u64()) {
            sockets = s;
        }
        if let Some(u) = resolved.get("upgrade").and_then(|u| u.as_str()) {
            upgrade = u.to_string();
        }
    }

    let armor_subclass = if item.get("itemClass").and_then(|c| c.as_u64()) == Some(4) {
        item.get("itemSubClass")
            .and_then(|s| s.as_u64())
            .unwrap_or(0)
    } else {
        0
    };
    let inventory_type = item
        .get("inventoryType")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let item_class = item.get("itemClass").and_then(|c| c.as_u64()).unwrap_or(0);
    let item_subclass = item
        .get("itemSubClass")
        .and_then(|s| s.as_u64())
        .unwrap_or(0);

    Some(serde_json::json!({
        "item_id": item_id,
        "name": item.get("name").and_then(|n| n.as_str()).unwrap_or("Unknown"),
        "quality": quality,
        "quality_name": class_data::quality_name(quality),
        "icon": item.get("icon").and_then(|i| i.as_str()).unwrap_or("inv_misc_questionmark"),
        "ilevel": ilevel,
        "tag": tag,
        "sockets": sockets,
        "upgrade": upgrade,
        "armor_subclass": armor_subclass,
        "inventory_type": inventory_type,
        "item_class": item_class,
        "item_subclass": item_subclass,
    }))
}

pub fn get_enchant_info(enchant_id: u64) -> Option<Value> {
    let enchant = enchants().get(&enchant_id)?;
    let name = enchant
        .get("itemName")
        .or_else(|| enchant.get("displayName"))
        .and_then(|n| n.as_str())
        .unwrap_or("");
    Some(serde_json::json!({ "enchant_id": enchant_id, "name": name }))
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

pub fn get_item_armor_subclass(item_id: u64) -> Option<u64> {
    let item = items().get(&item_id)?;
    let item_class = item.get("itemClass")?.as_u64()?;
    if item_class != 4 {
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
                    let new_ilevel = resolved
                        .get("ilevel")
                        .and_then(|v: &Value| v.as_u64())
                        .unwrap_or(base_ilevel);
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
    let re = regex::Regex::new(r"enchant_id=\d+").unwrap();
    let id_re = regex::Regex::new(r"(,id=\d+)").unwrap();
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
                if is_equipped || current_ench == ench_id {
                    return item.clone();
                }

                let mut updated = item.clone();
                updated["enchant_id"] = serde_json::json!(ench_id);
                if let Some(simc) = item.get("simc_string").and_then(|s| s.as_str()) {
                    let new_simc = if re.is_match(simc) {
                        re.replace(simc, &format!("enchant_id={}", ench_id))
                            .to_string()
                    } else {
                        id_re
                            .replace(simc, &format!("$1,enchant_id={}", ench_id))
                            .to_string()
                    };
                    updated["simc_string"] = serde_json::json!(new_simc);
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
