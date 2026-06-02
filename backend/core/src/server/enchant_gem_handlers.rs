use actix_web::{web, HttpRequest, HttpResponse};
use serde_json::json;
use std::sync::Arc;

use super::handler_prep::{capped_max_combinations, preprocess_simc_input, serialize_combo_metadata_vec, socketed_item_ids};
use super::helpers::*;
use super::types::*;
use super::SimcBinaries;
use crate::addon_parser;
use crate::compute::{ProviderRegistry, WorkloadEstimate};
use crate::db::{JobRepo, SettingsRepo};
use crate::gear_resolver;
use crate::log_buffer::LogBuffer;
use crate::profileset_generator;

pub(super) async fn create_enchant_gem_sim(
    http_req: HttpRequest,
    req: web::Json<EnchantGemSimRequest>,
    repo: web::Data<JobRepo>,
    settings_repo: web::Data<SettingsRepo>,
    simc_bins: web::Data<Arc<SimcBinaries>>,
    log_buffer: web::Data<Arc<LogBuffer>>,
    registry: web::Data<Arc<ProviderRegistry>>,
) -> HttpResponse {
    let simc_input = preprocess_simc_input(&req.simc_input, &req.options.talents, &req.options.spec_override);
    let parse_result = addon_parser::parse_simc_input(&simc_input);
    let resolved = gear_resolver::resolve_gear(&parse_result);
    let base_profile = resolved.base_profile.clone();
    let max_combinations = capped_max_combinations(req.max_combinations);
    let socketed_item_ids = socketed_item_ids(&resolved);

    let (generated_input, combo_count, combo_metadata) =
        match profileset_generator::generate_enchant_gem_input(
            &base_profile,
            &req.enchant_selections,
            &req.gem_options,
            &socketed_item_ids,
            max_combinations,
        ) {
            Ok(r) => r,
            Err(e) => {
                return HttpResponse::BadRequest().json(json!({"detail": e}));
            }
        };

    if combo_count == 0 {
        return HttpResponse::BadRequest().json(json!({
            "detail": "No enchant or gem options selected. Select at least two options for a slot."
        }));
    }

    let generated_input = inject_expert_fields(&generated_input, &req.options);

    if let Some(resp) = validate_batch(&req.options.batch_id, repo.get_ref()).await {
        return resp;
    }

    let (provider, avail) = match resolve_provider_for_request(
        "enchant_gem",
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
        "base_profile": base_profile,
        "enchant_selections": req.enchant_selections,
        "gem_options": req.gem_options,
        "socketed_item_ids": socketed_item_ids.iter().collect::<Vec<_>>(),
        "max_combinations": max_combinations,
        "options": req.options.to_json(),
    });

    let combo_metadata_serialized = serialize_combo_metadata_vec(&combo_metadata);

    submit_profileset_sim(
        ProfilesetSubmission {
            sim_type: "enchant_gem",
            sim_mode: crate::models::SimMode::EnchantGem,
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

pub(super) async fn get_enchant_gem_combo_count(
    req: web::Json<EnchantGemSimRequest>,
) -> HttpResponse {
    let simc_input = preprocess_simc_input(&req.simc_input, &req.options.talents, &req.options.spec_override);
    let parse_result = addon_parser::parse_simc_input(&simc_input);
    let resolved = gear_resolver::resolve_gear(&parse_result);
    let base_profile = resolved.base_profile.clone();
    let max_combinations = capped_max_combinations(req.max_combinations);
    let socketed_item_ids = socketed_item_ids(&resolved);

    match profileset_generator::generate_enchant_gem_input(
        &base_profile,
        &req.enchant_selections,
        &req.gem_options,
        &socketed_item_ids,
        max_combinations,
    ) {
        Ok((_, count, _)) => HttpResponse::Ok().json(json!({"combo_count": count})),
        Err(e) => HttpResponse::BadRequest().json(json!({"detail": e})),
    }
}
