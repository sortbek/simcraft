use actix_web::{web, HttpResponse};
use serde_json::json;
use std::collections::HashSet;
use std::sync::Arc;

use super::helpers::*;
use super::request_json::NormalizedRequest;
use super::types::*;
use super::SimcBinaries;
use crate::addon_parser;
use crate::db::JobRepo;
use crate::gear_resolver;
use crate::log_buffer::LogBuffer;
use crate::models::Job;
use crate::profileset_generator;
use crate::simc_runner;

fn capped_max_combinations(requested: Option<usize>) -> Option<usize> {
    let server_max = crate::db::MAX_COMBINATIONS.load(std::sync::atomic::Ordering::Relaxed);
    match (requested, server_max) {
        (Some(client), max) if max > 0 => Some(client.min(max)),
        (None, max) if max > 0 => Some(max),
        (client, _) => client,
    }
}

fn socketed_item_ids(resolved: &crate::types::ResolveGearResponse) -> HashSet<u64> {
    resolved
        .slots
        .values()
        .flat_map(|res| {
            let mut ids = Vec::new();
            if let Some(eq) = &res.equipped {
                if eq.sockets > 0 {
                    ids.push(eq.item_id);
                }
            }
            for alt in &res.alternatives {
                if alt.sockets > 0 {
                    ids.push(alt.item_id);
                }
            }
            ids
        })
        .collect()
}

pub(super) async fn create_enchant_gem_sim(
    req: web::Json<EnchantGemSimRequest>,
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

    let options_json_eg = req.options.to_json();
    let display_input_eg =
        simc_runner::build_simc_input_from_options(&generated_input, &options_json_eg);
    let job = Job::new(
        display_input_eg,
        crate::models::SimMode::EnchantGem.as_wire().to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    // Build normalized request envelope for resumability.
    let envelope = NormalizedRequest::new(
        "enchant_gem",
        json!({
            "base_profile": base_profile,
            "enchant_selections": req.enchant_selections,
            "gem_options": req.gem_options,
            "socketed_item_ids": socketed_item_ids.iter().collect::<Vec<_>>(),
            "max_combinations": max_combinations,
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
    write_combo_metadata_table(repo.get_ref(), &job_id, &combo_metadata).await;

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

pub(super) async fn get_enchant_gem_combo_count(
    req: web::Json<EnchantGemSimRequest>,
) -> HttpResponse {
    let simc_input = apply_spec_override(
        &apply_talent_override(&req.simc_input, &req.options.talents),
        &req.options.spec_override,
    );
    let simc_input = crate::talent_normalize::normalize_simc_talents(&simc_input);
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
