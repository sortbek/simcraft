use actix_web::{web, HttpRequest, HttpResponse};
use serde_json::json;
use std::sync::Arc;

use super::handler_prep::{preprocess_simc_input, serialize_combo_metadata_value};
use super::helpers::*;
use super::types::*;
use super::SimcBinaries;
use crate::addon_parser;
use crate::compute::{ProviderRegistry, WorkloadEstimate};
use crate::db::{JobRepo, SettingsRepo};
use crate::log_buffer::LogBuffer;
use crate::profileset_generator;

pub(super) async fn create_droptimizer_sim(
    http_req: HttpRequest,
    req: web::Json<DroptimizerRequest>,
    repo: web::Data<JobRepo>,
    settings_repo: web::Data<SettingsRepo>,
    simc_bins: web::Data<Arc<SimcBinaries>>,
    log_buffer: web::Data<Arc<LogBuffer>>,
    registry: web::Data<Arc<ProviderRegistry>>,
) -> HttpResponse {
    let simc_input = preprocess_simc_input(&req.simc_input, &req.options.talents, &req.options.spec_override);
    let parse_result = addon_parser::parse_simc_input(&simc_input);
    let base_profile = parse_result.base_profile.clone();

    let (generated_input, combo_count, combo_metadata) =
        profileset_generator::generate_droptimizer_input(&base_profile, &req.drop_items);

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
        "drop_items": req.drop_items,
        "options": req.options.to_json(),
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
