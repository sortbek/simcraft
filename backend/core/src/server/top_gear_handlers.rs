use actix_web::{web, HttpResponse};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use super::helpers::*;
use super::request_json::NormalizedRequest;
use super::types::*;
use super::SimcBinaries;
use crate::addon_parser;
use crate::db::JobRepo;
use crate::game_data;
use crate::gear_resolver;
use crate::log_buffer::LogBuffer;
use crate::models::{Job, SimcInputMode};
use crate::profileset_generator;
use crate::profileset_generator::triage::TRIAGE_THRESHOLD;
use crate::simc_runner;

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
    req: web::Json<TopGearRequest>,
    repo: web::Data<JobRepo>,
    simc_bins: web::Data<Arc<SimcBinaries>>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let mut simc_input = if req.max_upgrade {
        game_data::upgrade_simc_input(&req.simc_input)
    } else {
        req.simc_input.clone()
    };
    simc_input = apply_spec_override(
        &apply_talent_override(&simc_input, &req.options.talents),
        &req.options.spec_override,
    );
    simc_input = crate::talent_normalize::normalize_simc_talents(&simc_input);

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

    let options_json = req.options.to_json();
    let display_input = simc_runner::build_simc_input_from_options(&generated_input, &options_json);
    let job = Job::new(
        display_input,
        crate::models::SimMode::TopGear.as_wire().to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    // Build normalized request envelope for resumability.
    let envelope = NormalizedRequest::new(
        "top_gear",
        json!({
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
        SimcInputMode::Inline,
        crate::simc_runner::StagedResumeState::default(),
        crate::profileset_generator::triage::TriageConstants::default(),
    );

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}
pub(super) async fn get_top_gear_combo_count(req: web::Json<TopGearRequest>) -> HttpResponse {
    let mut simc_input = if req.max_upgrade {
        game_data::upgrade_simc_input(&req.simc_input)
    } else {
        req.simc_input.clone()
    };
    simc_input = apply_spec_override(
        &apply_talent_override(&simc_input, &req.options.talents),
        &req.options.spec_override,
    );
    simc_input = crate::talent_normalize::normalize_simc_talents(&simc_input);

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
