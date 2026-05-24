use actix_web::{web, HttpResponse};
use serde_json::json;
use std::sync::Arc;

use super::helpers::*;
use super::request_json::NormalizedRequest;
use super::types::*;
use super::SimcBinaries;
use crate::addon_parser;
use crate::db::JobRepo;
use crate::log_buffer::LogBuffer;
use crate::models::Job;
use crate::profileset_generator;
use crate::simc_runner;

pub(super) async fn create_droptimizer_sim(
    req: web::Json<DroptimizerRequest>,
    repo: web::Data<JobRepo>,
    simc_bins: web::Data<Arc<SimcBinaries>>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let simc_input = apply_spec_override(
        &apply_talent_override(&req.simc_input, &req.options.talents),
        &req.options.spec_override,
    );
    let simc_input = crate::talent_normalize::normalize_simc_talents(&simc_input);
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

    let options_json_drop = req.options.to_json();
    let display_input_drop =
        simc_runner::build_simc_input_from_options(&generated_input, &options_json_drop);
    let job = Job::new(
        display_input_drop,
        crate::models::SimMode::Droptimizer.as_wire().to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    // Build normalized request envelope for resumability.
    let envelope = NormalizedRequest::new(
        "droptimizer",
        json!({
            "base_profile": base_profile,
            "drop_items": req.drop_items,
            "options": req.options.to_json(),
        }),
    );

    // Resolve simc BEFORE insert — invalid branch must not create an orphan
    // Pending row.
    let simc = match simc_bins.resolve(&req.options.simc_branch) {
        Ok(path) => path,
        Err(e) => return HttpResponse::BadRequest().json(json!({"detail": e})),
    };

    let mut job = job;
    job.request_json = Some(envelope.to_json_string().unwrap_or_default());
    job.batch_id = req.options.batch_id.clone();
    if let Err(e) = repo.insert(&job).await {
        return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
    }

    // Best-effort write of per-combo metadata rows to the combo_metadata table.
    write_combo_metadata_table_value(repo.get_ref(), &job_id, &combo_metadata).await;

    spawn_staged_sim(
        repo.get_ref().clone(),
        simc,
        req.options.to_json(),
        job_id.clone(),
        generated_input,
        combo_count,
        log_buffer.get_ref().clone(),
        10, // inline/eager path: staged pipeline spans 10-95%
        crate::models::SimcInputMode::Inline,
        crate::simc_runner::StagedResumeState::default(),
        crate::profileset_generator::triage::TriageConstants::default(),
    );

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}
