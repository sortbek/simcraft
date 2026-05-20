use actix_web::{web, HttpResponse};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use super::helpers::{spawn_staged_sim, validate_batch};
use super::request_json::NormalizedRequest;
use super::types::TopGearRequest;
use crate::db::{ComboMetadataRepo, JobRepo};
use crate::log_buffer::LogBuffer;
use crate::models::{Job, SimcInputMode};
use crate::profileset_generator;
use crate::simc_runner;

pub(super) struct StreamingTopGearStart {
    pub req: web::Json<TopGearRequest>,
    pub repo: web::Data<JobRepo>,
    pub simc: PathBuf,
    pub log_buffer: web::Data<Arc<LogBuffer>>,
    pub base_profile: String,
    pub items_by_slot: HashMap<String, Vec<Value>>,
    pub talent_builds: Vec<(String, String)>,
    pub socketed_ids: HashSet<u64>,
    pub catalyst_charges: Option<u32>,
    pub max_combinations: Option<usize>,
    pub estimate: u64,
}

/// Full streaming triage path.
///
/// Creates a streamed job, inserts it, then spawns the background triage and
/// staged pipeline. HTTP handlers should stay thin and delegate here once they
/// have decided that a Top Gear request needs streaming.
pub(super) async fn start_streaming_top_gear_job(start: StreamingTopGearStart) -> HttpResponse {
    let StreamingTopGearStart {
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
    } = start;

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

    if let Some(resp) = validate_batch(&req.options.batch_id, repo.get_ref()).await {
        return resp;
    }

    let options_json = req.options.to_json();
    let display_input = simc_runner::build_simc_input_from_options(&base_profile, &options_json);

    let mut job = Job::new(
        display_input,
        "top_gear".to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    job.simc_input_mode = SimcInputMode::Streamed;
    job.batch_id = req.options.batch_id.clone();

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

    let repo_for_task = repo.get_ref().clone();
    let simc_bin_for_task = simc.clone();
    let job_id_task = job_id.clone();
    let fight_style = job.fight_style.clone();
    let target_error = job.target_error;
    let options_for_task = options_json.clone();
    let base_profile_owned = base_profile.clone();
    let log_buffer_owned = log_buffer.get_ref().clone();

    tokio::spawn(async move {
        // Flip status to Running so the UI shows the Pause affordance and the
        // pause endpoint accepts requests during Triage. Without this the job
        // sits at Pending throughout triage and pause is unreachable.
        if let Err(e) = repo_for_task
            .update_status(&job_id_task, crate::models::JobStatus::Running)
            .await
        {
            eprintln!("[{}] Failed to set Running status: {}", job_id_task, e);
        }

        let repo_progress = repo_for_task.clone();
        let jid_progress = job_id_task.clone();

        let on_progress = move |pct: u8, detail: String| {
            let mapped: u8 = 5u8.saturating_add(((pct as f64) * 0.45) as u8);
            let r = repo_progress.clone();
            let i = jid_progress.clone();
            tokio::spawn(async move {
                let _ = r.update_progress(&i, mapped, "Triage", &detail).await;
            });
        };

        let Some(pool) = repo_for_task.pool().cloned() else {
            let _ = repo_for_task
                .set_error(&job_id_task, "Streaming path requires SQLite storage")
                .await;
            return;
        };

        let inputs = crate::profileset_generator::triage::TriageRunInputs {
            pool: &pool,
            job_id: &job_id_task,
            simc_bin: &simc_bin_for_task,
            fight_style: &fight_style,
            target_error,
            base_profile: &base_profile_owned,
            log_buffer: log_buffer_owned.clone(),
            on_progress: Box::new(on_progress),
        };

        match crate::profileset_generator::triage::run_triage(iter_cfg, inputs, estimate).await {
            Ok(result) => {
                let _ = repo_for_task
                    .update_progress(
                        &job_id_task,
                        50,
                        "Staging",
                        "Building final sim from survivors",
                    )
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
    if survivor_combo_ids.is_empty() {
        let _ = repo
            .set_error(
                job_id,
                "Triage eliminated all candidates; no survivors to sim.",
            )
            .await;
        log_buffer.remove(job_id);
        return;
    }

    let metadata_repo = ComboMetadataRepo::new(pool.clone());
    let rows = match metadata_repo
        .list_for_combo_ids(job_id, survivor_combo_ids)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let _ = repo
                .set_error(
                    job_id,
                    &format!("Handoff: failed to read combo metadata: {}", e),
                )
                .await;
            log_buffer.remove(job_id);
            return;
        }
    };

    let survivor_simc_lines: Vec<&str> = rows.iter().map(|r| r.profileset_simc.as_str()).collect();
    let combo_count = survivor_simc_lines.len();

    if combo_count == 0 {
        let _ = repo
            .set_error(job_id, "Triage produced no survivor profilesets to sim.")
            .await;
        log_buffer.remove(job_id);
        return;
    }

    let profileset_block = survivor_simc_lines.join("\n");
    let combined_input = format!("# Base Actor\n{}\n{}", base_profile, profileset_block);

    spawn_staged_sim(
        repo.clone(),
        simc_bin.to_path_buf(),
        options.clone(),
        job_id.to_string(),
        combined_input,
        combo_count,
        log_buffer.clone(),
        50,
        SimcInputMode::Streamed,
        crate::simc_runner::StagedResumeState::default(),
        crate::profileset_generator::triage::TriageConstants::default(),
    );
}
