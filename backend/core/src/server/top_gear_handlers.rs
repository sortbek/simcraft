use actix_web::{web, HttpRequest, HttpResponse};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

use super::handler_prep::{capped_max_combinations, preprocess_simc_input, serialize_combo_metadata_vec, socketed_item_ids};
use super::helpers::*;
use super::types::*;
use super::SimcBinaries;
use crate::addon_parser;
use crate::compute::{ProviderRegistry, WorkloadEstimate};
use crate::db::{JobRepo, SettingsRepo};
use crate::game_data;
use crate::gear_resolver;
use crate::log_buffer::LogBuffer;
use crate::profileset_generator;
use crate::profileset_generator::triage::TRIAGE_THRESHOLD;

fn normalized_talent_builds(talent_builds: &[TalentBuild]) -> Vec<(String, String)> {
    talent_builds
        .iter()
        .map(|tb| {
            let normalized = crate::talent_normalize::normalize_simc_talents(&format!(
                "talents={}",
                tb.talent_string
            ));
            let ts = normalized
                .strip_prefix("talents=")
                .unwrap_or(&tb.talent_string)
                .to_string();
            (tb.name.clone(), ts)
        })
        .collect()
}

fn build_items_by_slot(
    req: &TopGearRequest,
    resolved: &crate::types::ResolveGearResponse,
) -> HashMap<String, Vec<Value>> {
    let mut items_by_slot = if let Some(ref ibs) = req.items_by_slot {
        ibs.clone()
    } else {
        resolve_to_items_by_slot(resolved)
    };

    if req.max_upgrade {
        items_by_slot = game_data::upgrade_items_by_slot(&items_by_slot);
    }

    if req.copy_enchants {
        items_by_slot = game_data::apply_copy_enchants(&items_by_slot);
    }

    items_by_slot
}

pub(super) async fn create_top_gear_sim(
    http_req: HttpRequest,
    req: web::Json<TopGearRequest>,
    repo: web::Data<JobRepo>,
    settings_repo: web::Data<SettingsRepo>,
    simc_bins: web::Data<Arc<SimcBinaries>>,
    log_buffer: web::Data<Arc<LogBuffer>>,
    registry: web::Data<Arc<ProviderRegistry>>,
    local_queue: web::Data<crate::compute::local::LocalSimQueue>,
) -> HttpResponse {
    let raw_input = if req.max_upgrade {
        game_data::upgrade_simc_input(&req.simc_input)
    } else {
        req.simc_input.clone()
    };
    let simc_input = preprocess_simc_input(&raw_input, &req.options.talents, &req.options.spec_override);

    let parse_result = addon_parser::parse_simc_input(&simc_input);
    let currency_id_sim = crate::item_db::catalyst_currency_id();
    let catalyst_charges = req
        .catalyst_charges
        .or_else(|| crate::addon_parser::parse_catalyst_charges(&req.simc_input, currency_id_sim));

    let mut resolved = if req.catalyst || catalyst_charges.is_some() {
        gear_resolver::resolve_gear_with_catalyst(&parse_result, catalyst_charges)
    } else {
        gear_resolver::resolve_gear(&parse_result)
    };
    if req.void_forge {
        gear_resolver::generate_void_forge_alternatives(&mut resolved.slots);
    }
    let base_profile = resolved.base_profile.clone();
    let items_by_slot = build_items_by_slot(&req, &resolved);
    let talent_builds = normalized_talent_builds(&req.talent_builds);
    let max_combinations = capped_max_combinations(req.max_combinations);
    let socketed_ids = socketed_item_ids(&resolved);
    let gem_opts = profileset_generator::GemEnchantOptions {
        enchant_selections: Some(&req.enchant_selections),
        gem_options: &req.gem_options,
        socketed_item_ids: Some(&socketed_ids),
        replace_gems: req.replace_gems,
        diamond_always_use: req.diamond_always_use,
        max_colors: req.max_colors,
    };

    // ── Path decision ────────────────────────────────────────────────────────
    let estimate = profileset_generator::estimate_top_gear_combo_count(
        &items_by_slot,
        &req.selected_items,
        &req.enchant_selections,
        &req.gem_options,
        &socketed_ids,
        talent_builds.len().max(1),
    );

    let effective_estimate = max_combinations
        .map(|cap| estimate.min(cap as u64))
        .unwrap_or(estimate);
    let use_streaming_path = effective_estimate >= TRIAGE_THRESHOLD;

    let (provider, avail) = match resolve_provider_for_request(
        "top_gear",
        req.options.compute_provider.as_deref(),
        WorkloadEstimate {
            combo_count: effective_estimate as usize,
            would_use_streaming_path: use_streaming_path,
        },
        http_req.headers(),
        settings_repo.get_ref(),
        registry.get_ref(),
    ).await {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    let provider_id_str = provider.id().to_string();

    if use_streaming_path {
        let simc = match simc_bins.resolve(&req.options.simc_branch) {
            Ok(path) => path,
            Err(e) => return HttpResponse::BadRequest().json(json!({"detail": e})),
        };
        return super::streaming_top_gear::start_streaming_top_gear_job(
            super::streaming_top_gear::StreamingTopGearStart {
                req,
                repo,
                simc,
                log_buffer,
                base_profile,
                items_by_slot,
                talent_builds,
                socketed_ids,
                catalyst_charges,
                max_combinations,
                estimate,
                provider_id: provider_id_str.clone(),
                provider: provider.clone(),
                provider_auth: avail.auth_for(provider.id()),
                local_queue: local_queue.get_ref().clone(),
                local_provider: registry
                    .get("local")
                    .expect("local provider always registered"),
            },
        )
        .await;
    }

    // ── Existing eager path (unchanged) ──────────────────────────────────────
    let (generated_input, combo_count, combo_metadata) =
        match profileset_generator::generate_top_gear_input_with_talents(
            &base_profile,
            &items_by_slot,
            &req.selected_items,
            max_combinations,
            &talent_builds,
            catalyst_charges,
            &gem_opts,
        ) {
            Ok(r) => r,
            Err(e) => {
                return HttpResponse::BadRequest().json(json!({"detail": e}));
            }
        };

    let has_enchant_gem =
        req.enchant_selections.values().any(|v| !v.is_empty()) || !req.gem_options.is_empty();
    if combo_count == 0 && req.talent_builds.len() <= 1 && !has_enchant_gem {
        return HttpResponse::BadRequest().json(json!({
            "detail": "No alternative items selected. Select at least one non-equipped item or multiple talent builds."
        }));
    }

    let generated_input = inject_expert_fields(&generated_input, &req.options);

    if let Some(resp) = validate_batch(&req.options.batch_id, repo.get_ref()).await {
        return resp;
    }

    let envelope_payload = json!({
        "items_by_slot": items_by_slot,
        "selected_items": req.selected_items,
        "enchant_selections": req.enchant_selections,
        "gem_options": req.gem_options,
        "socketed_item_ids": socketed_ids.iter().collect::<Vec<_>>(),
        "replace_gems": req.replace_gems,
        "diamond_always_use": req.diamond_always_use,
        "max_colors": req.max_colors,
        "talent_builds": talent_builds,
        "catalyst_charges": catalyst_charges,
        "spec": req.options.spec_override,
        "base_profile": base_profile,
        "max_combinations": max_combinations,
        "void_forge": req.void_forge,
        "options": req.options.to_json(),
    });

    let combo_metadata_serialized = serialize_combo_metadata_vec(&combo_metadata);

    submit_profileset_sim(
        ProfilesetSubmission {
            sim_type: "top_gear",
            sim_mode: crate::models::SimMode::TopGear,
            generated_input,
            combo_count,
            combo_metadata_serialized,
            envelope_payload,
        },
        &req.options,
        provider,
        avail,
        repo.get_ref(),
        log_buffer.get_ref(),
    )
    .await
}
pub(super) async fn get_top_gear_combo_count(req: web::Json<TopGearRequest>) -> HttpResponse {
    let raw_input = if req.max_upgrade {
        game_data::upgrade_simc_input(&req.simc_input)
    } else {
        req.simc_input.clone()
    };
    let simc_input = preprocess_simc_input(&raw_input, &req.options.talents, &req.options.spec_override);

    let parse_result = addon_parser::parse_simc_input(&simc_input);
    let currency_id = crate::item_db::catalyst_currency_id();
    let catalyst_charges = req
        .catalyst_charges
        .or_else(|| crate::addon_parser::parse_catalyst_charges(&req.simc_input, currency_id));

    let mut resolved = if req.catalyst || catalyst_charges.is_some() {
        gear_resolver::resolve_gear_with_catalyst(&parse_result, catalyst_charges)
    } else {
        gear_resolver::resolve_gear(&parse_result)
    };
    if req.void_forge {
        gear_resolver::generate_void_forge_alternatives(&mut resolved.slots);
    }
    let base_profile = resolved.base_profile.clone();
    let items_by_slot = build_items_by_slot(&req, &resolved);
    let talent_builds = normalized_talent_builds(&req.talent_builds);
    let max_combinations = capped_max_combinations(req.max_combinations);
    let socketed_item_ids = socketed_item_ids(&resolved);
    let gem_opts = profileset_generator::GemEnchantOptions {
        enchant_selections: Some(&req.enchant_selections),
        gem_options: &req.gem_options,
        socketed_item_ids: Some(&socketed_item_ids),
        replace_gems: req.replace_gems,
        diamond_always_use: req.diamond_always_use,
        max_colors: req.max_colors,
    };

    match profileset_generator::count_top_gear_combos_with_talents(
        &base_profile,
        &items_by_slot,
        &req.selected_items,
        max_combinations,
        &talent_builds,
        catalyst_charges,
        &gem_opts,
    ) {
        Ok(count) => HttpResponse::Ok().json(json!({ "combo_count": count })),
        Err(e) => {
            // Use the typed error classifier so we don't re-parse "(N)" out
            // of the raw error message inside the handler.
            let (count, message) = match profileset_generator::classify_generator_error(&e) {
                profileset_generator::GeneratorError::TooMany { count, .. } => (count, e),
                other => (0, other.to_message()),
            };
            HttpResponse::Ok().json(json!({ "combo_count": count, "error": message }))
        }
    }
}
