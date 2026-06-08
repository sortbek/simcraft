use actix_web::{web, HttpRequest, HttpResponse};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

use super::handler_prep::{preprocess_simc_input, serialize_combo_metadata_vec};
use super::helpers::*;
use super::types::*;
use super::SimcBinaries;
use once_cell::sync::Lazy;

use crate::addon_parser;
use crate::compute::{ProviderRegistry, WorkloadEstimate};
use crate::db::{JobRepo, SettingsRepo};
use crate::game_data;
use crate::gear_resolver;
use crate::log_buffer::LogBuffer;
use crate::profileset_generator;

static RE_BONUS_ID: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"bonus_id=([0-9/:]+)").unwrap());

/// Shared prep: parse SimC input, extract upgrade budget, build upgrade options per slot.
struct PreparedUpgradeCompare {
    base_profile: String,
    upgraded_options_by_slot: HashMap<String, Vec<Value>>,
    upgrade_budget: HashMap<u64, u64>,
}

fn prepare_upgrade_compare(
    simc_input: &str,
    selected_slots: &[String],
) -> Result<PreparedUpgradeCompare, HttpResponse> {
    let upgrade_budget = addon_parser::parse_upgrade_currencies(simc_input);
    if upgrade_budget.is_empty() {
        return Err(HttpResponse::BadRequest().json(json!({
            "detail": "No upgrade_currencies found in SimC addon export."
        })));
    }

    let upgrade_currency_ids: std::collections::HashSet<u64> =
        upgrade_budget.keys().copied().collect();

    let parse_result = addon_parser::parse_simc_input(simc_input);
    let resolved = gear_resolver::resolve_gear(&parse_result);
    let base_profile = resolved.base_profile.clone();
    let items_by_slot = resolve_to_items_by_slot(&resolved);

    let bonus_re = &*RE_BONUS_ID;
    let mut upgraded_options_by_slot: HashMap<String, Vec<Value>> = HashMap::new();

    for slot in selected_slots {
        let slot_items = match items_by_slot.get(slot) {
            Some(items) => items,
            None => continue,
        };

        let equipped = match slot_items.iter().find(|it| {
            it.get("is_equipped")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        }) {
            Some(e) => e,
            None => continue,
        };

        let old_bonus_ids: Vec<u64> = equipped
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
            .unwrap_or_default();

        let options = match game_data::get_upgrade_options(&old_bonus_ids) {
            Some(o) => o,
            None => continue,
        };

        // Find current level and filter to higher levels with relevant currency costs
        let current_level = options
            .iter()
            .filter_map(|opt| {
                let bid = opt.get("bonus_id")?.as_u64()?;
                if old_bonus_ids.contains(&bid) {
                    opt.get("level")?.as_u64()
                } else {
                    None
                }
            })
            .next()
            .unwrap_or(0);

        let mut slot_upgrades: Vec<Value> = Vec::new();
        for opt in &options {
            let level = opt.get("level").and_then(|l| l.as_u64()).unwrap_or(0);
            if level <= current_level {
                continue;
            }

            // Only include if costs involve our upgrade currencies
            let has_relevant_cost = opt
                .get("cumulative_costs")
                .and_then(|c| c.as_object())
                .map(|m| {
                    m.keys()
                        .any(|k| upgrade_currency_ids.contains(&k.parse().unwrap_or(0)))
                })
                .unwrap_or(false);
            if !has_relevant_cost {
                continue;
            }

            let target_bonus_id = opt.get("bonus_id").and_then(|b| b.as_u64()).unwrap_or(0);
            if target_bonus_id == 0 {
                continue;
            }

            // Build upgraded item
            let mut new_bonus_ids = old_bonus_ids.clone();
            // Replace the upgrade bonus_id
            for bid in &mut new_bonus_ids {
                if bonuses_in_same_group(*bid, target_bonus_id) {
                    *bid = target_bonus_id;
                }
            }

            let mut upgraded = equipped.clone();
            upgraded["is_equipped"] = json!(false);
            upgraded["bonus_ids"] = json!(new_bonus_ids.clone());
            upgraded["upgrade_levels"] = json!(level.saturating_sub(current_level));

            // Update simc_string with new bonus_ids
            if let Some(simc) = equipped.get("simc_string").and_then(|s| s.as_str()) {
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
                upgraded["simc_string"] = json!(new_simc);

                // Resolve new ilevel
                let item_id = equipped
                    .get("item_id")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                if let Some(info) = game_data::get_item_info(item_id, Some(&new_bonus_ids)) {
                    upgraded["ilevel"] = json!(info.ilevel);
                }
            }

            // Cumulative cost from current to this level
            let costs = game_data::get_upgrade_cost_between(&old_bonus_ids, &new_bonus_ids);
            upgraded["upgrade_costs"] = json!(costs);

            slot_upgrades.push(upgraded);
        }

        if !slot_upgrades.is_empty() {
            upgraded_options_by_slot.insert(slot.clone(), slot_upgrades);
        }
    }

    Ok(PreparedUpgradeCompare {
        base_profile,
        upgraded_options_by_slot,
        upgrade_budget,
    })
}

/// Check if two bonus IDs belong to the same upgrade group.
fn bonuses_in_same_group(a: u64, b: u64) -> bool {
    let bonuses = crate::item_db::bonuses();
    let group_a = bonuses
        .get(&a)
        .and_then(|v| v.get("upgrade"))
        .and_then(|u| u.get("group"))
        .and_then(|g| g.as_u64());
    let group_b = bonuses
        .get(&b)
        .and_then(|v| v.get("upgrade"))
        .and_then(|u| u.get("group"))
        .and_then(|g| g.as_u64());
    group_a.is_some() && group_a == group_b
}

/// Returns everything the frontend needs to render the upgrade-compare UI in one call:
/// equipped items, upgrade options per slot, currency budget with metadata.
pub(super) async fn get_upgrade_compare_prepare(req: web::Json<serde_json::Value>) -> HttpResponse {
    let simc_input = req.get("simc_input").and_then(|v| v.as_str()).unwrap_or("");
    if simc_input.len() < 10 {
        return HttpResponse::BadRequest().json(json!({ "detail": "SimC input too short." }));
    }

    let upgrade_budget = addon_parser::parse_upgrade_currencies(simc_input);
    let upgrade_currency_ids: std::collections::HashSet<u64> =
        upgrade_budget.keys().copied().collect();

    let parse_result = addon_parser::parse_simc_input(simc_input);
    let resolved = gear_resolver::resolve_gear(&parse_result);
    let items_by_slot = resolve_to_items_by_slot(&resolved);

    let mut candidates: Vec<Value> = Vec::new();

    for slot in crate::types::class_data::GEAR_SLOTS {
        let slot_items = match items_by_slot.get(*slot) {
            Some(items) => items,
            None => continue,
        };
        let equipped = match slot_items.iter().find(|it| {
            it.get("is_equipped")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        }) {
            Some(e) => e,
            None => continue,
        };
        let bonus_ids: Vec<u64> = equipped
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
            .unwrap_or_default();
        if bonus_ids.is_empty() {
            continue;
        }

        let options = match game_data::get_upgrade_options(&bonus_ids) {
            Some(o) => o,
            None => continue,
        };

        // Find current level and its cumulative cost
        let mut current_level: u64 = 0;
        let mut current_cumulative: HashMap<u64, u64> = HashMap::new();
        for opt in &options {
            let bid = opt.get("bonus_id").and_then(|v| v.as_u64()).unwrap_or(0);
            if bonus_ids.contains(&bid) {
                current_level = opt.get("level").and_then(|v| v.as_u64()).unwrap_or(0);
                if let Some(cc) = opt.get("cumulative_costs").and_then(|v| v.as_object()) {
                    for (k, v) in cc {
                        if let (Ok(cid), Some(amt)) = (k.parse::<u64>(), v.as_u64()) {
                            current_cumulative.insert(cid, amt);
                        }
                    }
                }
                break;
            }
        }

        // Filter to upgrades that cost our currencies
        let upgrades: Vec<&Value> = options
            .iter()
            .filter(|o| {
                let level = o.get("level").and_then(|l| l.as_u64()).unwrap_or(0);
                if level <= current_level {
                    return false;
                }
                o.get("cumulative_costs")
                    .and_then(|c| c.as_object())
                    .map(|m| {
                        m.keys()
                            .any(|k| upgrade_currency_ids.contains(&k.parse().unwrap_or(0)))
                    })
                    .unwrap_or(false)
            })
            .collect();

        if upgrades.is_empty() {
            continue;
        }

        let max_upgrade = upgrades.last().unwrap();
        let item_id = equipped
            .get("item_id")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let ilevel = equipped.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0);
        let target_ilevel = max_upgrade
            .get("itemLevel")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        // Delta cost = target cumulative - current cumulative
        let mut delta_costs: HashMap<String, u64> = HashMap::new();
        if let Some(target_cc) = max_upgrade
            .get("cumulative_costs")
            .and_then(|v| v.as_object())
        {
            for (k, v) in target_cc {
                let target_amt = v.as_u64().unwrap_or(0);
                let current_amt = current_cumulative
                    .get(&k.parse::<u64>().unwrap_or(0))
                    .copied()
                    .unwrap_or(0);
                let delta = target_amt.saturating_sub(current_amt);
                if delta > 0 {
                    delta_costs.insert(k.clone(), delta);
                }
            }
        }
        let costs = json!(delta_costs);

        candidates.push(json!({
            "slot": slot,
            "item_id": item_id,
            "bonus_ids": bonus_ids,
            "ilevel": ilevel,
            "target_ilevel": target_ilevel,
            "costs": costs,
        }));
    }

    // Build currency info
    let mut currency_info: HashMap<String, Value> = HashMap::new();
    for (cid, amount) in &upgrade_budget {
        let meta = game_data::get_currency_info(*cid);
        currency_info.insert(
            cid.to_string(),
            json!({
                "id": cid,
                "amount": amount,
                "name": meta.as_ref().and_then(|m| m.get("name")).and_then(|n| n.as_str()).unwrap_or(""),
                "icon": meta.as_ref().and_then(|m| m.get("icon")).and_then(|i| i.as_str()).unwrap_or(""),
            }),
        );
    }

    HttpResponse::Ok().json(json!({
        "candidates": candidates,
        "currencies": currency_info,
    }))
}

pub(super) async fn get_upgrade_compare_combo_count(
    req: web::Json<UpgradeCompareRequest>,
) -> HttpResponse {
    // Apply both talent AND spec override, matching every other sim handler.
    // Without the spec_override pass, a cross-spec talent build would sim
    // the wrong profile silently.
    let simc_input = preprocess_simc_input(&req.simc_input, &req.options.talents, &req.options.spec_override);

    let prepared = match prepare_upgrade_compare(&simc_input, &req.selected_slots) {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    match profileset_generator::generate_upgrade_compare_input(
        &prepared.base_profile,
        &prepared.upgraded_options_by_slot,
        &prepared.upgrade_budget,
        req.max_combinations,
    ) {
        Ok((_, count, _)) => HttpResponse::Ok().json(json!({ "combo_count": count })),
        Err(e) => {
            let (count, message) = match profileset_generator::classify_generator_error(&e) {
                profileset_generator::GeneratorError::TooMany { count, .. } => (count, e),
                other => (0, other.to_message()),
            };
            HttpResponse::Ok().json(json!({ "combo_count": count, "error": message }))
        }
    }
}

pub(super) async fn create_upgrade_compare_sim(
    http_req: HttpRequest,
    req: web::Json<UpgradeCompareRequest>,
    repo: web::Data<JobRepo>,
    settings_repo: web::Data<SettingsRepo>,
    simc_bins: web::Data<Arc<SimcBinaries>>,
    log_buffer: web::Data<Arc<LogBuffer>>,
    registry: web::Data<Arc<ProviderRegistry>>,
) -> HttpResponse {
    let simc_input = preprocess_simc_input(&req.simc_input, &req.options.talents, &req.options.spec_override);

    let prepared = match prepare_upgrade_compare(&simc_input, &req.selected_slots) {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let (generated_input, combo_count, combo_metadata) =
        match profileset_generator::generate_upgrade_compare_input(
            &prepared.base_profile,
            &prepared.upgraded_options_by_slot,
            &prepared.upgrade_budget,
            req.max_combinations,
        ) {
            Ok(result) => result,
            Err(e) => {
                return HttpResponse::BadRequest().json(json!({ "detail": e }));
            }
        };

    if combo_count == 0 {
        return HttpResponse::BadRequest().json(json!({
            "detail": "No valid upgrade combinations within budget."
        }));
    }

    let generated_input = inject_expert_fields(&generated_input, &req.options);

    if let Some(resp) = validate_batch(&req.options.batch_id, repo.get_ref()).await {
        return resp;
    }

    let (provider, avail) = match resolve_provider_for_request(
        "upgrade_compare",
        req.options.compute_provider.as_deref(),
        WorkloadEstimate { combo_count, would_use_streaming_path: false },
        http_req.headers(),
        settings_repo.get_ref(),
        registry.get_ref(),
    ).await {
        Ok(t) => t,
        Err(resp) => return resp,
    };

    let envelope_payload = json!({
        "base_profile": prepared.base_profile,
        "upgraded_options_by_slot": prepared.upgraded_options_by_slot,
        "upgrade_budget": prepared.upgrade_budget,
        "selected_slots": req.selected_slots,
        "max_combinations": req.max_combinations,
        "options": req.options.to_json(),
    });

    let combo_metadata_serialized = serialize_combo_metadata_vec(&combo_metadata);

    submit_profileset_sim(
        ProfilesetSubmission {
            sim_type: "upgrade_compare",
            sim_mode: crate::models::SimMode::UpgradeCompare,
            generated_input,
            combo_count,
            combo_metadata_serialized,
            envelope_payload,
        },
        &req.options,
        provider,
        avail,
        repo.get_ref(),
        simc_bins.get_ref(),
        log_buffer.get_ref(),
    )
    .await
}

pub(super) async fn get_upgrade_options_handler(
    query: web::Query<HashMap<String, String>>,
) -> HttpResponse {
    let bonus_ids: Vec<u64> = query
        .get("bonus_ids")
        .unwrap_or(&String::new())
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    match game_data::get_upgrade_options(&bonus_ids) {
        Some(options) => HttpResponse::Ok().json(json!({ "options": options })),
        None => HttpResponse::Ok().json(json!({ "options": [] })),
    }
}
