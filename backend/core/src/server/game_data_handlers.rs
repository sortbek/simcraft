use actix_web::{web, HttpResponse};
use serde_json::{json, Value};
use std::collections::HashMap;

use super::types::*;
use crate::addon_parser;
use crate::game_data;
use crate::gear_resolver;
use crate::item_db;

pub(super) async fn get_item_names() -> HttpResponse {
    match item_db::item_names() {
        Some(names) => HttpResponse::Ok()
            .insert_header(("Cache-Control", "public, max-age=3600"))
            .json(names),
        None => HttpResponse::Ok().json(json!({})),
    }
}

pub(super) async fn get_item_info(
    path: web::Path<u64>,
    query: web::Query<BonusIdsQuery>,
) -> HttpResponse {
    let item_id = path.into_inner();
    let bonus_list: Vec<u64> = if query.bonus_ids.is_empty() {
        Vec::new()
    } else {
        query
            .bonus_ids
            .split(',')
            .filter_map(|s| s.trim().parse().ok())
            .collect()
    };

    let bonus_ref = if bonus_list.is_empty() {
        None
    } else {
        Some(bonus_list.as_slice())
    };

    let result = game_data::get_item_info(item_id, bonus_ref)
        .unwrap_or_else(|| crate::types::ItemInfo::unknown(item_id));

    HttpResponse::Ok().json(result)
}

pub(super) async fn get_item_info_batch(req: web::Json<ItemInfoBatchRequest>) -> HttpResponse {
    let mut items_list = req.items.clone();
    if items_list.is_empty() && !req.item_ids.is_empty() {
        items_list = req
            .item_ids
            .iter()
            .map(|iid| json!({"item_id": iid}))
            .collect();
    }

    if items_list.is_empty() || items_list.len() > 100 {
        return HttpResponse::BadRequest().json(json!({"detail": "Provide 1-100 items"}));
    }

    let mut seen = std::collections::HashSet::new();
    let mut unique_items: Vec<(u64, Vec<u64>)> = Vec::new();

    for item in &items_list {
        let iid = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
        let bonus: Vec<u64> = item
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
            .unwrap_or_default();
        let mut sorted_bonus = bonus.clone();
        sorted_bonus.sort();
        let key = format!(
            "{}:{}",
            iid,
            sorted_bonus
                .iter()
                .map(|b| b.to_string())
                .collect::<Vec<_>>()
                .join(":")
        );
        if seen.insert(key) {
            unique_items.push((iid, bonus));
        }
    }

    let mut results: HashMap<String, crate::types::ItemInfo> = HashMap::new();
    for (iid, bonus) in &unique_items {
        let bonus_ref = if bonus.is_empty() {
            None
        } else {
            Some(bonus.as_slice())
        };
        let info = game_data::get_item_info(*iid, bonus_ref)
            .unwrap_or_else(|| crate::types::ItemInfo::unknown(*iid));
        results.insert(iid.to_string(), info);
    }

    HttpResponse::Ok().json(results)
}

pub(super) async fn get_enchant_info(path: web::Path<u64>) -> HttpResponse {
    let enchant_id = path.into_inner();
    let result = game_data::get_enchant_info(enchant_id)
        .unwrap_or_else(|| json!({"enchant_id": enchant_id, "name": ""}));
    HttpResponse::Ok().json(result)
}

pub(super) async fn get_gem_info(path: web::Path<u64>) -> HttpResponse {
    let gem_id = path.into_inner();
    let result = game_data::get_gem_info(gem_id)
        .unwrap_or_else(|| json!({"gem_id": gem_id, "name": "", "icon": "", "quality": 3}));
    HttpResponse::Ok().json(result)
}

pub(super) async fn get_max_upgrade_ilevels(body: web::Json<Vec<Value>>) -> HttpResponse {
    let mut results: HashMap<String, u64> = HashMap::new();
    for item in body.iter().take(200) {
        let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
        let bonus_ids: Vec<u64> = item
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
            .unwrap_or_default();
        let upgraded = game_data::upgrade_bonus_ids_to_max(&bonus_ids);
        if let Some(info) = game_data::get_item_info(item_id, Some(&upgraded)) {
            let ilevel = info.ilevel;
            let mut sorted_ids = bonus_ids.clone();
            sorted_ids.sort();
            let key = format!(
                "{}:{}",
                item_id,
                sorted_ids
                    .iter()
                    .map(|b| b.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            );
            results.insert(key, ilevel);
        }
    }
    HttpResponse::Ok().json(results)
}

pub(super) async fn list_upgrade_tracks() -> HttpResponse {
    HttpResponse::Ok().json(game_data::get_upgrade_tracks())
}

pub(super) async fn resolve_gear(req: web::Json<ResolveGearRequest>) -> HttpResponse {
    let simc_input = if req.max_upgrade {
        game_data::upgrade_simc_input(&req.simc_input)
    } else {
        req.simc_input.clone()
    };
    let parse_result = addon_parser::parse_simc_input(&simc_input);
    // Always parse catalyst charges so the frontend can show the toggle
    let currency_id = crate::item_db::catalyst_currency_id();
    let catalyst_charges =
        crate::addon_parser::parse_catalyst_charges(&req.simc_input, currency_id);
    let mut resolved = if req.catalyst && catalyst_charges.is_some() {
        gear_resolver::resolve_gear_with_catalyst(&parse_result, catalyst_charges)
    } else {
        gear_resolver::resolve_gear(&parse_result)
    };
    resolved.catalyst_charges = catalyst_charges;
    HttpResponse::Ok().json(resolved)
}

pub(super) async fn catalyst_convert(
    req: web::Json<super::types::CatalystConvertRequest>,
) -> HttpResponse {
    let class_id = match crate::types::class_data::class_wow_id(&req.class_name) {
        Some(id) => id,
        None => return HttpResponse::BadRequest().json(json!({"detail": "Unknown class"})),
    };
    let inv_type = match gear_resolver::slot_to_inv_type(&req.slot) {
        Some(t) => t,
        None => {
            return HttpResponse::BadRequest().json(json!({"detail": "Slot not eligible for catalyst"}))
        }
    };
    let tier_info = match crate::item_db::catalyst_tier_item(class_id, inv_type) {
        Some(t) => t,
        None => {
            return HttpResponse::BadRequest()
                .json(json!({"detail": "No catalyst tier item for this class/slot"}))
        }
    };
    let catalyst_item = gear_resolver::build_catalyst_item(&req.item, tier_info, &req.slot);
    HttpResponse::Ok().json(catalyst_item)
}

pub(super) async fn get_talent_tree(path: web::Path<u64>) -> HttpResponse {
    let spec_id = path.into_inner();
    let tree = match game_data::talent_tree(spec_id) {
        Some(t) => t,
        None => return HttpResponse::NotFound().json(json!({"detail": "Talent tree not found"})),
    };

    // Build fullNodeMaxRanks by combining all specs of the same class.
    // The fullNodeOrder covers ALL nodes across all specs, but each spec's
    // node arrays only include its own subset. The decoder needs maxRanks
    // for every node in fullNodeOrder to correctly parse the bit stream.
    let mut max_ranks: HashMap<u64, u64> = HashMap::new();
    for (key, nodes_key) in [
        ("classNodes", "classNodes"),
        ("specNodes", "specNodes"),
        ("heroNodes", "heroNodes"),
    ] {
        for sibling in crate::item_db::talent_trees_for_class(spec_id) {
            if let Some(nodes) = sibling.get(nodes_key).and_then(|v| v.as_array()) {
                for node in nodes {
                    if let (Some(id), Some(mr)) = (
                        node.get("id").and_then(|v| v.as_u64()),
                        node.get("maxRanks").and_then(|v| v.as_u64()),
                    ) {
                        max_ranks.insert(id, mr);
                    }
                }
            }
        }
        let _ = key; // suppress unused warning
    }
    // SubTree nodes (maxRanks defaults to 1)
    for sibling in crate::item_db::talent_trees_for_class(spec_id) {
        if let Some(nodes) = sibling.get("subTreeNodes").and_then(|v| v.as_array()) {
            for node in nodes {
                if let Some(id) = node.get("id").and_then(|v| v.as_u64()) {
                    max_ranks.entry(id).or_insert(1);
                }
            }
        }
    }

    let mut response = tree.clone();
    if let Some(obj) = response.as_object_mut() {
        obj.insert("fullNodeMaxRanks".to_string(), json!(max_ranks));
    }
    HttpResponse::Ok().json(response)
}

pub(super) async fn get_season_config() -> HttpResponse {
    use crate::types::season::*;
    let cfg = crate::item_db::season_cfg();

    let season = cfg
        .get("season")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();

    let raid_difficulties: Vec<DifficultyDef> = cfg
        .get("raidDifficulties")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let dungeon_categories: Vec<DungeonCategory> = cfg
        .get("dungeonCategories")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    HttpResponse::Ok().json(SeasonConfigResponse {
        season,
        raid_difficulties,
        dungeon_categories,
    })
}

pub(super) async fn list_instances() -> HttpResponse {
    HttpResponse::Ok().json(game_data::get_instances())
}

pub(super) async fn get_drops_by_type(
    path: web::Path<String>,
    query: web::Query<DropsQuery>,
) -> HttpResponse {
    let instance_type = path.into_inner();
    let class_name = if query.class_name.is_empty() {
        None
    } else {
        Some(query.class_name.as_str())
    };
    let spec = if query.spec.is_empty() {
        None
    } else {
        Some(query.spec.as_str())
    };
    match game_data::get_drops_by_type(&instance_type, class_name, spec) {
        Some(drops) => HttpResponse::Ok().json(drops),
        None => HttpResponse::NotFound()
            .json(json!({"detail": "No drops found for this instance type"})),
    }
}

pub(super) async fn get_instance_drops(
    path: web::Path<i64>,
    query: web::Query<DropsQuery>,
) -> HttpResponse {
    let instance_id = path.into_inner();
    let class_name = if query.class_name.is_empty() {
        None
    } else {
        Some(query.class_name.as_str())
    };
    let spec = if query.spec.is_empty() {
        None
    } else {
        Some(query.spec.as_str())
    };
    match game_data::get_instance_drops(instance_id, class_name, spec) {
        Some(drops) => HttpResponse::Ok().json(drops),
        None => {
            HttpResponse::NotFound().json(json!({"detail": "Instance not found or has no drops"}))
        }
    }
}
