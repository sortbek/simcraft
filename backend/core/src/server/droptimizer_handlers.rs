use actix_web::{web, HttpRequest, HttpResponse};
use serde_json::json;
use std::sync::Arc;

use super::client_request::{parse_client_request, ClientRequest};
use super::handler_prep::{
    preprocess_simc_input, serialize_combo_metadata_value, validate_profile,
};
use super::job_spawn::{
    resolve_provider_for_request, submit_profileset_sim, validate_batch, ProfilesetSubmission,
};
use super::simc_input::inject_expert_fields;
use super::types::*;
use crate::addon_parser;
use crate::compute::SimcBinaries;
use crate::compute::{ProviderRegistry, WorkloadEstimate};
use crate::db::{JobRepo, SettingsRepo};
use crate::log_buffer::LogBuffer;
use crate::profileset_generator;

pub(super) async fn create_droptimizer_sim(
    http_req: HttpRequest,
    body: web::Json<serde_json::Value>,
    repo: web::Data<JobRepo>,
    settings_repo: web::Data<SettingsRepo>,
    simc_bins: web::Data<Arc<SimcBinaries>>,
    log_buffer: web::Data<Arc<LogBuffer>>,
    registry: web::Data<Arc<ProviderRegistry>>,
) -> HttpResponse {
    let ClientRequest {
        req,
        raw: client_request,
        rerun_of,
    } = match parse_client_request::<DroptimizerRequest>(body.into_inner()) {
        Ok(c) => c,
        Err(resp) => return resp,
    };
    // Upgrading runs BEFORE generation, so it lands on the equipped profile
    // alone: every candidate is added afterwards at the rank the browser priced
    // it at. Reversing the order would silently lift each drop to its track max.
    let raw_input = match req.upgrade_equipped_to {
        Some(rank) => crate::item_db::upgrade_simc_input_to_rank(&req.simc_input, rank),
        None => req.simc_input.clone(),
    };
    let simc_input = preprocess_simc_input(
        &raw_input,
        &req.options.talents,
        &req.options.spec_override,
        &req.options.omnium_talents,
    );
    if let Some(resp) = validate_profile(&simc_input) {
        return resp;
    }

    let parse_result = addon_parser::parse_simc_input(&simc_input);
    let base_profile = parse_result.base_profile.clone();

    let crafted_stats =
        match profileset_generator::CraftedStats::resolve(req.preferred_crafted_stats) {
            Ok(cs) => cs,
            Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
        };

    // Per-item embellishment picks ride `drop_items` (like the other variant
    // markers), not a run-level field.
    let embellishments =
        match profileset_generator::CraftedEmbellishment::resolve_picks(&req.drop_items) {
            Ok(e) => e,
            Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
        };

    // Embellishments are crafting reagents — enforce crafted-only at the trust
    // boundary, not just via the frontend gate. A preferred stat pair needs no
    // such check: the generator applies it per item, and only to gear that can
    // take one.
    if !embellishments.is_empty() && !crate::item_db::all_crafted_items(&req.drop_items) {
        return HttpResponse::BadRequest().json(json!({
            "detail": "Embellishments can only be applied to crafted items."
        }));
    }

    let (generated_input, combo_count, combo_metadata) =
        profileset_generator::generate_droptimizer_input_with(
            &base_profile,
            &req.drop_items,
            crafted_stats,
            &embellishments,
            profileset_generator::DropRunOptions {
                preferred_gem_id: req.preferred_gem_id,
                add_vault_socket: req.add_vault_socket,
            },
        );

    if combo_count == 0 {
        return HttpResponse::BadRequest().json(json!({
            "detail": "No items selected. Select at least one drop item."
        }));
    }

    let generated_input = inject_expert_fields(&generated_input, &req.options);

    if let Some(resp) = validate_batch(&req.options.batch_id, repo.get_ref()).await {
        return resp;
    }

    let (provider, avail) = match resolve_provider_for_request(
        "droptimizer",
        req.options.compute_provider.as_deref(),
        WorkloadEstimate {
            combo_count,
            would_use_streaming_path: false,
        },
        http_req.headers(),
        settings_repo.get_ref(),
        registry.get_ref(),
    )
    .await
    {
        Ok(t) => t,
        Err(resp) => return resp,
    };

    let envelope_payload = json!({
        "base_profile": base_profile,
        "drop_items": req.drop_items,
        "options": req.options.to_json(),
        "preferred_crafted_stats": req.preferred_crafted_stats,
    });

    let combo_metadata_serialized = serialize_combo_metadata_value(&combo_metadata);

    submit_profileset_sim(
        ProfilesetSubmission {
            sim_type: "droptimizer",
            sim_mode: crate::models::SimMode::Droptimizer,
            generated_input,
            combo_count,
            combo_metadata_serialized,
            envelope_payload,
            client_request: Some(client_request),
            rerun_of,
        },
        &req.options,
        provider,
        avail,
        repo.get_ref(),
        simc_bins.get_ref(),
        log_buffer.get_ref(),
        req.force_single_pass,
    )
    .await
}
