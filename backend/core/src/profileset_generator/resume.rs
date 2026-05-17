//! Resume entry point for paused jobs. Reads the Checkpoint from
//! `jobs.checkpoint`, the normalized request from `jobs.request_json`,
//! validates state, and dispatches to the phase-appropriate continuation.

use std::sync::Arc;
use sqlx::AnyPool;

use crate::db::JobRepo;
use crate::log_buffer::LogBuffer;
use crate::models::{Job, JobStatus, SimcInputMode};
use crate::server::SimcBinaries;
use super::checkpoint::{Checkpoint, CheckpointPhase};

/// Bundle of dependencies the resume code needs. Built once by the HTTP
/// handler and threaded through to the phase-specific continuations.
pub struct ResumeInputs {
    pub pool: AnyPool,
    pub repo: JobRepo,
    pub log_buffer: Arc<LogBuffer>,
    pub simc_bins: Arc<SimcBinaries>,
}

/// Resume a paused job. Reads checkpoint + request_json, validates, and
/// dispatches by phase. On success, the spawned continuation has been
/// scheduled and the job status is back to Running.
pub async fn resume_job(job_id: &str, inputs: ResumeInputs) -> Result<(), String> {
    // 1. Load and validate the job.
    let job = inputs
        .repo
        .get(job_id)
        .await
        .map_err(|e| format!("Failed to load job: {}", e))?
        .ok_or_else(|| "Job not found".to_string())?;

    if job.status != JobStatus::Paused {
        return Err(format!(
            "Job is not paused (status is {})",
            job.status
        ));
    }

    if !matches!(job.simc_input_mode, SimcInputMode::Streamed) {
        return Err("Inline-mode jobs are not resumable".to_string());
    }

    let request_json = job
        .request_json
        .as_deref()
        .ok_or_else(|| "Job has no request_json — cannot resume".to_string())?;

    let checkpoint_json = job
        .checkpoint
        .as_deref()
        .ok_or_else(|| "Job has no checkpoint — cannot resume".to_string())?;

    let checkpoint = Checkpoint::from_json_str(checkpoint_json)
        .map_err(|e| format!("Invalid checkpoint JSON: {}", e))?;

    // 2. Dispatch by phase.
    match checkpoint.phase {
        CheckpointPhase::Triage(_) => resume_triage(job_id, &job, request_json, &checkpoint, inputs).await,
        CheckpointPhase::Staged(_) => resume_staged(job_id, &job, request_json, &checkpoint, inputs).await,
    }
}

/// Read `options.simc_branch` from a parsed envelope payload. Returns `""`
/// when absent, which `SimcBinaries::resolve` treats as "use the default branch".
fn simc_branch_from_payload(payload: &serde_json::Value) -> &str {
    payload
        .get("options")
        .and_then(|opts| opts.get("simc_branch"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
}

/// Triage-phase resume. Reconstructs the iterator, restores state from the
/// checkpoint, discards any orphaned committed-pending batches, and spawns
/// `run_triage_with_constants` to continue from the saved cursor.
async fn resume_triage(
    job_id: &str,
    job: &Job,
    request_json: &str,
    checkpoint: &Checkpoint,
    inputs: ResumeInputs,
) -> Result<(), String> {
    let triage_cp = match &checkpoint.phase {
        CheckpointPhase::Triage(tc) => tc,
        _ => return Err("resume_triage called with non-Triage checkpoint".to_string()),
    };

    // 1. Clean up orphaned committed-but-not-completed batches. The checkpoint we
    // wrote inside pre_simc_phase already advanced next_cursor PAST this batch,
    // so resume continues from there. Dedup rows for orphan batches stay; they
    // don't interfere with the forward-only iterator. Net effect: any
    // candidates accepted in the orphan batch but never sim'd are silently
    // skipped. Worst-case data loss: one batch's worth of survivors. Acceptable
    // for Phase 2 v1 — the alternative is rewinding cursor + deleting dedup
    // rows, which is materially more complex.
    let triage_repo = crate::db::TriageBatchesRepo::new(inputs.pool.clone());
    let pending = triage_repo
        .committed_pending(job_id)
        .await
        .map_err(|e| format!("Failed to load committed-pending batches: {}", e))?;
    for batch in &pending {
        let _ = sqlx::query("DELETE FROM triage_batches WHERE job_id = $1 AND batch_idx = $2")
            .bind(job_id)
            .bind(batch.batch_idx)
            .execute(&inputs.pool)
            .await;
    }

    // 2. Re-load already-collected survivors from combo_metadata so the
    // all_survivors accumulator in run_triage_with_constants is seeded correctly
    // for the final Triage→Staged handoff checkpoint. Only combo_ids are needed;
    // loading full rows (including profileset_simc payloads) would be ~200 MB at
    // 150K survivors.
    let metadata_repo = crate::db::ComboMetadataRepo::new(inputs.pool.clone());
    let already_collected_survivors = metadata_repo
        .list_combo_ids_for_job(job_id)
        .await
        .map_err(|e| format!("Failed to load survivors: {}", e))?;

    // 3. Rebuild the iterator config from request_json. Also parse the
    // envelope once so step 6 can read options.simc_branch without re-parsing.
    let iter_cfg =
        super::iterator_from_request::build_iterator_from_request_json(request_json)?;
    let envelope: crate::server::request_json::NormalizedRequest =
        serde_json::from_str(request_json)
            .map_err(|e| format!("Invalid request_json: {}", e))?;

    // 4. Restore TriageState from the checkpoint.
    let restored_state = super::triage::TriageState {
        next_combo_id: triage_cp.next_combo_id,
        next_batch_idx: triage_cp.next_batch_idx,
        survivors_so_far: triage_cp.survivors_so_far,
        avg_bytes_per_profileset: triage_cp.avg_bytes_per_profileset,
        estimated_total_batches: triage_cp.estimated_total_batches,
    };
    let resume_state = super::triage::TriageResumeState {
        state: restored_state,
        cursor: triage_cp.next_cursor.clone(),
        already_collected_survivors,
    };

    // 5. Flip status back to Running and clear pause_requested.
    inputs
        .repo
        .set_pause_requested(job_id, false)
        .await
        .map_err(|e| format!("Failed to clear pause_requested: {}", e))?;
    inputs
        .repo
        .update_status(job_id, crate::models::JobStatus::Running)
        .await
        .map_err(|e| format!("Failed to set Running: {}", e))?;

    // 6. Resolve the simc binary using the original branch from request_json
    // (an empty string falls back to the default branch).
    let simc_bin_path = inputs
        .simc_bins
        .resolve(simc_branch_from_payload(&envelope.payload))
        .map_err(|e| format!("Failed to resolve simc binary: {}", e))?;

    // 7. Spawn the Triage continuation as a background task.
    let pool_for_task = inputs.pool.clone();
    let repo_for_task = inputs.repo.clone();
    let log_buffer_for_task = inputs.log_buffer.clone();
    let job_id_owned = job_id.to_string();
    let fight_style = job.fight_style.clone();
    let target_error = job.target_error;
    let base_profile_owned = job.simc_input.clone();
    let constants_for_task = checkpoint.constants;
    let estimate = constants_for_task.global_survivor_target as u64;

    tokio::spawn(async move {
        let on_progress = {
            let repo = repo_for_task.clone();
            let jid = job_id_owned.clone();
            move |pct: u8, detail: String| {
                // Map triage 0-100 → overall 5-50
                let mapped: u8 = (5u32 + (pct as u32 * 45 / 100)).min(50) as u8;
                let r = repo.clone();
                let i = jid.clone();
                tokio::spawn(async move {
                    let _ = r.update_progress(&i, mapped, "Triage", &detail).await;
                });
            }
        };

        let triage_inputs = super::triage::TriageRunInputs {
            pool: &pool_for_task,
            job_id: &job_id_owned,
            simc_bin: &simc_bin_path,
            fight_style: &fight_style,
            target_error,
            base_profile: &base_profile_owned,
            log_buffer: log_buffer_for_task,
            on_progress: Box::new(on_progress),
        };

        match super::triage::run_triage_with_constants(
            iter_cfg,
            triage_inputs,
            estimate,
            constants_for_task,
            Some(resume_state),
        )
        .await
        {
            Ok(_result) => {
                // Triage finished. The final Staged checkpoint was written by
                // run_triage_with_constants. The user can click Resume again to
                // continue from the staged path.
            }
            Err(e) => {
                let _ = repo_for_task
                    .set_error(&job_id_owned, &format!("Triage resume failed: {}", e))
                    .await;
            }
        }
    });

    Ok(())
}

/// Staged-phase resume. Loads survivor profileset_simc fragments from
/// combo_metadata for the combo_ids saved in the Staged checkpoint, builds the
/// combined simc input (raw base_profile + "# Base Actor\n" prefix + survivors),
/// and spawns `spawn_staged_sim` starting at the saved `next_stage_idx`.
/// The base_profile is taken from request_json.payload.base_profile (not from
/// job.simc_input, which for streamed jobs is the decorated form produced by
/// build_simc_input_from_options and not suitable as a raw profileset base).
async fn resume_staged(
    job_id: &str,
    job: &Job,
    request_json: &str,
    checkpoint: &Checkpoint,
    inputs: ResumeInputs,
) -> Result<(), String> {
    let staged_cp = match &checkpoint.phase {
        CheckpointPhase::Staged(sc) => sc,
        _ => return Err("resume_staged called with non-Staged checkpoint".to_string()),
    };

    // 0. Parse the original request envelope to recover full options + base_profile.
    let envelope: crate::server::request_json::NormalizedRequest =
        serde_json::from_str(request_json)
            .map_err(|e| format!("Invalid request_json: {}", e))?;
    let payload = &envelope.payload;
    let options = payload
        .get("options")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({
            "iterations": job.iterations,
            "target_error": job.target_error,
            "fight_style": job.fight_style,
        }));
    let base_profile = payload
        .get("base_profile")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "request_json missing base_profile".to_string())?;

    // 1. Load survivor profileset_simc fragments for the saved combo_ids.
    let metadata_repo = crate::db::ComboMetadataRepo::new(inputs.pool.clone());
    let rows = metadata_repo
        .list_for_job(job_id, None)
        .await
        .map_err(|e| format!("Failed to load survivors: {}", e))?;
    let id_set: std::collections::HashSet<i64> =
        staged_cp.survivor_combo_ids.iter().copied().collect();
    let survivor_simc: String = rows
        .iter()
        .filter(|r| id_set.contains(&r.combo_id))
        .map(|r| r.profileset_simc.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    if survivor_simc.is_empty() {
        return Err("No survivor profileset_simc fragments to resume with".to_string());
    }

    // Use raw base_profile prefixed with "# Base Actor\n" to match the format
    // produced by the fresh handoff_to_staged path in top_gear_handlers.rs.
    let combined = format!("# Base Actor\n{}\n{}", base_profile, survivor_simc);
    let combo_count = id_set.len();

    // 2. Flip status back to Running and clear pause_requested.
    inputs
        .repo
        .set_pause_requested(job_id, false)
        .await
        .map_err(|e| format!("Failed to clear pause_requested: {}", e))?;
    inputs
        .repo
        .update_status(job_id, crate::models::JobStatus::Running)
        .await
        .map_err(|e| format!("Failed to set Running: {}", e))?;

    // 3. Resolve the simc binary using the original branch from request_json.
    let simc_bin = inputs
        .simc_bins
        .resolve(simc_branch_from_payload(payload))
        .map_err(|e| format!("Failed to resolve simc binary: {}", e))?;

    // 4. Spawn the staged pipeline at the saved next_stage_idx.
    //    base_start=50 because Triage already ran (5-50% covered); staged
    //    pipeline uses 50-95%.
    crate::server::helpers::spawn_staged_sim(
        inputs.repo.clone(),
        simc_bin,
        options,
        job_id.to_string(),
        combined,
        combo_count,
        inputs.log_buffer.clone(),
        50, // base_start: Triage consumed 5-50%
        SimcInputMode::Streamed,
        staged_cp.next_stage_idx,
        checkpoint.constants,
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    // Integration tests against a real sqlx pool require mocking JobRepo,
    // which has no current mock infrastructure.
}
