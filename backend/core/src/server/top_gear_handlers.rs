use actix_web::{web, HttpResponse};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use super::helpers::*;
use super::request_json::NormalizedRequest;
use super::types::*;
use super::SimcBinaries;
use crate::addon_parser;
use crate::db::{ComboMetadataRepo, JobRepo};
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

    let use_streaming_path = estimate >= TRIAGE_THRESHOLD;

    if use_streaming_path {
        let simc = match simc_bins.resolve(&req.options.simc_branch) {
            Ok(path) => path,
            Err(e) => return HttpResponse::BadRequest().json(json!({"detail": e})),
        };
        return start_streaming_top_gear_job(
            req,
            repo,
            simc,
            log_buffer,
            base_profile,
            items_by_slot,
            talent_builds,
            socketed_ids,
            catalyst_charges,
            estimate,
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
        "top_gear".to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
    }))
    .unwrap_or_default();

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

    let mut job = job;
    job.combo_metadata_json = Some(meta_json);
    job.request_json = Some(envelope.to_json_string().unwrap_or_default());
    job.batch_id = req.options.batch_id.clone();
    if let Err(e) = repo.insert(&job).await {
        return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
    }

    // Best-effort write of per-combo metadata rows to the combo_metadata table.
    write_combo_metadata_table(repo.get_ref(), &job_id, &combo_metadata).await;

    let simc = match simc_bins.resolve(&req.options.simc_branch) {
        Ok(path) => path,
        Err(e) => return HttpResponse::BadRequest().json(json!({"detail": e})),
    };

    spawn_staged_sim(
        repo.get_ref().clone(),
        simc,
        req.options.to_json(),
        job_id.clone(),
        generated_input,
        combo_count,
        log_buffer.get_ref().clone(),
        10, // inline/eager path: staged pipeline spans 10-95%
    );

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}

/// Task 22: Full streaming triage path.
///
/// Creates a job with `simc_input_mode = Streamed`, inserts it, then spawns a
/// background task that runs Triage and hands off survivors to the staged pipeline.
#[allow(clippy::too_many_arguments)]
async fn start_streaming_top_gear_job(
    req: web::Json<TopGearRequest>,
    repo: web::Data<JobRepo>,
    simc: std::path::PathBuf,
    log_buffer: web::Data<Arc<LogBuffer>>,
    base_profile: String,
    items_by_slot: HashMap<String, Vec<Value>>,
    talent_builds: Vec<(String, String)>,
    socketed_ids: HashSet<u64>,
    catalyst_charges: Option<u32>,
    estimate: u64,
) -> HttpResponse {
    // ── Build iterator config ─────────────────────────────────────────────────
    let gem_opts = profileset_generator::GemEnchantOptions {
        enchant_selections: Some(&req.enchant_selections),
        gem_options: &req.gem_options,
        socketed_item_ids: Some(&socketed_ids),
        replace_gems: req.replace_gems,
        diamond_always_use: req.diamond_always_use,
        max_colors: req.max_colors,
    };
    let iter_cfg = profileset_generator::build_iterator_config(
        &base_profile,
        &items_by_slot,
        &req.selected_items,
        &talent_builds,
        &gem_opts,
    );

    // ── Validate batch ────────────────────────────────────────────────────────
    if let Some(resp) = validate_batch(&req.options.batch_id, repo.get_ref()).await {
        return resp;
    }

    // ── Create Job ────────────────────────────────────────────────────────────
    // For Streamed mode we store only the base profile as simc_input (no profilesets).
    let options_json = req.options.to_json();
    let display_input =
        simc_runner::build_simc_input_from_options(&base_profile, &options_json);

    let mut job = Job::new(
        display_input,
        "top_gear".to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    job.simc_input_mode = SimcInputMode::Streamed;
    job.batch_id = req.options.batch_id.clone();

    // Normalized request envelope (mirrors eager path)
    let max_combinations = capped_max_combinations(req.max_combinations);
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
            "streaming": true,
            "estimate": estimate,
        }),
    );
    job.request_json = Some(envelope.to_json_string().unwrap_or_default());

    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    if let Err(e) = repo.insert(&job).await {
        return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
    }

    // ── Spawn background triage + staged pipeline ─────────────────────────────
    let repo_for_task = repo.get_ref().clone();
    let simc_bin_for_task = simc.clone();
    let job_id_task = job_id.clone();
    let fight_style = job.fight_style.clone();
    let target_error = job.target_error;
    let options_for_task = options_json.clone();
    let base_profile_owned = base_profile.clone();
    let log_buffer_owned = log_buffer.get_ref().clone();

    tokio::spawn(async move {
        // Progress callback: triage segment occupies 5–50% of overall progress.
        let repo_progress = repo_for_task.clone();
        let jid_progress = job_id_task.clone();

        let on_progress = move |pct: u8, detail: String| {
            // Map triage 0-100 → overall 5-50
            let mapped: u8 = 5u8.saturating_add(((pct as f64) * 0.45) as u8);
            let r = repo_progress.clone();
            let i = jid_progress.clone();
            tokio::spawn(async move {
                let _ = r.update_progress(&i, mapped, "Triage", &detail).await;
            });
        };

        let pool_opt = repo_for_task.pool().cloned();
        let pool = match pool_opt {
            Some(p) => p,
            None => {
                // In-memory backend (desktop dev mode): mark failed.
                let _ = repo_for_task
                    .set_error(&job_id_task, "Streaming path requires SQLite storage")
                    .await;
                return;
            }
        };

        let inputs = crate::profileset_generator::triage::TriageRunInputs {
            pool: &pool,
            job_id: &job_id_task,
            simc_bin: &simc_bin_for_task,
            fight_style: &fight_style,
            target_error,
            base_profile: &base_profile_owned,
            on_progress: Box::new(on_progress),
        };

        match crate::profileset_generator::triage::run_triage(iter_cfg, inputs, estimate).await {
            Ok(result) => {
                // Hand off survivors to staged pipeline (occupies 50-100% of progress).
                let _ = repo_for_task
                    .update_progress(&job_id_task, 50, "Staging", "Building final sim from survivors")
                    .await;

                handoff_to_staged(
                    &pool,
                    &repo_for_task,
                    &simc_bin_for_task,
                    &job_id_task,
                    &base_profile_owned,
                    &options_for_task,
                    &result.survivor_combo_ids,
                    &log_buffer_owned,
                )
                .await;
            }
            Err(e) => {
                let _ = repo_for_task.set_error(&job_id_task, &e).await;
                log_buffer_owned.remove(&job_id_task);
            }
        }
    });

    HttpResponse::Ok().json(json!({
        "id": job_id,
        "status": "pending",
        "created_at": created_at,
        "estimate": estimate,
    }))
}

/// Read survivor profileset_simc fragments from the combo_metadata table,
/// concatenate them with the base profile, and hand off to the existing staged pipeline.
async fn handoff_to_staged(
    pool: &sqlx::AnyPool,
    repo: &JobRepo,
    simc_bin: &std::path::Path,
    job_id: &str,
    base_profile: &str,
    options: &Value,
    survivor_combo_ids: &[i64],
    log_buffer: &Arc<LogBuffer>,
) {
    let metadata_repo = ComboMetadataRepo::new(pool.clone());
    let rows = match metadata_repo.list_for_job(job_id, None).await {
        Ok(r) => r,
        Err(e) => {
            let _ = repo
                .set_error(job_id, &format!("Handoff: failed to read combo metadata: {}", e))
                .await;
            log_buffer.remove(job_id);
            return;
        }
    };

    if survivor_combo_ids.is_empty() {
        let _ = repo
            .set_error(job_id, "Triage eliminated all candidates; no survivors to sim.")
            .await;
        log_buffer.remove(job_id);
        return;
    }

    let id_set: std::collections::HashSet<i64> =
        survivor_combo_ids.iter().copied().collect();

    // Build profileset simc from survivors, renaming sequentially so the staged
    // pipeline's combo_count is accurate.
    let mut survivor_simc_lines: Vec<String> = Vec::new();
    let mut combo_number = 2usize; // Combo 1 is always the base actor
    for row in rows.iter().filter(|r| id_set.contains(&r.combo_id)) {
        // Row's profileset_simc uses the triage-assigned name (e.g. "Combo 42").
        // Re-number sequentially starting from 2 for the staged run.
        let renamed = row
            .profileset_simc
            .replace(
                &format!("Combo {}", row.combo_id),
                &format!("Combo {}", combo_number),
            );
        survivor_simc_lines.push(renamed);
        combo_number += 1;
    }

    let combo_count = combo_number - 2; // number of survivor profilesets

    if combo_count == 0 {
        let _ = repo
            .set_error(job_id, "Triage produced no survivor profilesets to sim.")
            .await;
        log_buffer.remove(job_id);
        return;
    }

    // Build the full simc input: base actor + profilesets.
    let profileset_block = survivor_simc_lines.join("\n");
    let combined_input = format!("# Base Actor\n{}\n{}", base_profile, profileset_block);

    // Delegate to spawn_staged_sim. Triage already consumed 5-50% of the
    // progress bar, so the staged pipeline starts at 50 rather than 10.
    spawn_staged_sim(
        repo.clone(),
        simc_bin.to_path_buf(),
        options.clone(),
        job_id.to_string(),
        combined_input,
        combo_count,
        log_buffer.clone(),
        50, // streamed path: Triage consumed 5-50%, staged pipeline spans 50-95%
    );
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
            let count: usize = e
                .split('(')
                .nth(1)
                .and_then(|s| s.split(')').next())
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            HttpResponse::Ok().json(json!({ "combo_count": count, "error": e }))
        }
    }
}
