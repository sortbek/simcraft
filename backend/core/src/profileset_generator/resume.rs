//! Resume entry point for paused jobs. Reads the Checkpoint from
//! `jobs.checkpoint`, the normalized request from `jobs.request_json`,
//! validates state, and dispatches to the phase-appropriate continuation.

use sqlx::AnyPool;
use std::sync::Arc;

use super::checkpoint::{Checkpoint, CheckpointPhase};
use crate::db::JobRepo;
use crate::log_buffer::LogBuffer;
use crate::models::{Job, JobStatus, SimcInputMode};
use crate::server::SimcBinaries;

/// Bundle of dependencies the resume code needs. Built once by the HTTP
/// handler and threaded through to the phase-specific continuations.
pub struct ResumeInputs {
    pub pool: AnyPool,
    pub repo: JobRepo,
    pub log_buffer: Arc<LogBuffer>,
    pub simc_bins: Arc<SimcBinaries>,
    pub queue: crate::compute::local::LocalSimQueue,
    pub local_provider: Arc<dyn crate::compute::SimcProvider>,
    /// Provider registry — cloud-streaming resume resolves the concrete Simmit
    /// provider from it. Triage/staged resume ignore it.
    pub registry: Arc<crate::compute::ProviderRegistry>,
    /// Server-side provider settings store — cloud-streaming resume reads the
    /// Simmit API key from it when no per-request key was supplied.
    pub settings_repo: crate::db::SettingsRepo,
    /// Per-request provider auth derived from the resume request's
    /// `X-Provider-<id>-Key` headers (exactly as submit builds it). Present for a
    /// web BYO-key caller; `None`/`ProviderAuth::None` for desktop or when the key
    /// only lives in server-side Settings. Cloud-streaming resume PREFERS this
    /// over the server-side Settings key so a web BYO-key cloud run can resume,
    /// not just be paused. Triage/staged resume ignore it (local-only).
    pub request_auth: crate::compute::ProviderAuth,
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
        return Err(format!("Job is not paused (status is {})", job.status));
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
        CheckpointPhase::Triage(_) => {
            resume_triage(job_id, &job, request_json, &checkpoint, inputs).await
        }
        CheckpointPhase::Staged(_) => {
            resume_staged(job_id, &job, request_json, &checkpoint, inputs).await
        }
        CheckpointPhase::LocalStage(_) => {
            resume_local_stage(job_id, &job, request_json, &checkpoint, inputs).await
        }
        CheckpointPhase::CloudStreaming(_) => {
            crate::server::cloud_streaming::resume_cloud_streaming(
                job_id,
                &job,
                request_json,
                &checkpoint,
                inputs,
            )
            .await
        }
    }
}

async fn resume_local_stage(
    job_id: &str,
    job: &Job,
    request_json: &str,
    checkpoint: &Checkpoint,
    inputs: ResumeInputs,
) -> Result<(), String> {
    let envelope: crate::server::request_json::NormalizedRequest =
        serde_json::from_str(request_json).map_err(|e| format!("Invalid request_json: {}", e))?;
    let payload = &envelope.payload;
    let options_for_task = payload.get("options").cloned().unwrap_or_else(|| {
        serde_json::json!({
            "iterations": job.iterations,
            "target_error": job.target_error,
            "fight_style": job.fight_style,
        })
    });
    let base_profile_owned = payload
        .get("base_profile")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "request_json missing base_profile".to_string())?
        .to_string();
    let iter_cfg = super::iterator_from_request::build_iterator_from_request_json(request_json)?;

    // Checkpoint-driven mid-stage resume: load the LocalStage checkpoint, find
    // any committed-but-incomplete batch, validate it forms a clean suffix,
    // clean up its uncommitted side effects (dedup keys + ledger row), and
    // compute the resume state (rewind to the pending batch, or use the
    // pre-advanced checkpoint scalars at a clean boundary).
    let local_cp = match &checkpoint.phase {
        CheckpointPhase::LocalStage(c) => c.clone(),
        _ => {
            return Err("resume_local_stage called with non-LocalStage checkpoint".to_string());
        }
    };

    let stage_batches_repo = crate::db::StageBatchesRepo::new(inputs.pool.clone());
    let dedup_repo = crate::db::ComboDedupRepo::new(inputs.pool.clone());
    let pending = stage_batches_repo
        .committed_pending(job_id)
        .await
        .map_err(|e| format!("Failed to load committed-pending batches: {e}"))?;

    let max_done = stage_batches_repo
        .max_completed_batch_idx(job_id, local_cp.stage_idx as i64)
        .await
        .map_err(|e| format!("Failed to load max completed batch: {e}"))?;
    validate_pending_stage_batches(&pending, max_done)?;

    // Cleanup in order (abort resume if either fails): dedup first, batch row second.
    for batch in &pending {
        if batch.source_kind == "generated" {
            dedup_repo
                .delete_for_batch(job_id, batch.batch_idx)
                .await
                .map_err(|e| format!("Failed to delete pending dedup keys: {e}"))?;
        }
    }
    for batch in &pending {
        sqlx::query(
            "DELETE FROM stage_batches WHERE job_id = $1 AND stage_idx = $2 AND batch_idx = $3",
        )
        .bind(job_id)
        .bind(batch.stage_idx)
        .bind(batch.batch_idx)
        .execute(&inputs.pool)
        .await
        .map_err(|e| format!("Failed to delete pending stage batch: {e}"))?;
    }

    let rewind = rewind_for_pending_stage_batches(&local_cp, &pending)?;
    let resume_state = super::stage_pipeline::StagePipelineResume {
        start_stage_idx: local_cp.stage_idx,
        start_batch_idx: rewind
            .as_ref()
            .map(|r| r.start_batch_idx)
            .unwrap_or(local_cp.next_batch_idx),
        input_survivor_ids: local_cp.survivor_combo_ids.clone(),
        iterator_cursor: rewind
            .as_ref()
            .and_then(|r| r.iterator_cursor.clone())
            .or_else(|| local_cp.generated_cursor.clone().filter(|c| !c.is_empty())),
        next_combo_id: rewind
            .as_ref()
            .map(|r| r.next_combo_id)
            .unwrap_or(local_cp.next_combo_id),
    };

    inputs
        .repo
        .set_pause_requested(job_id, false)
        .await
        .map_err(|e| format!("Failed to clear pause_requested: {}", e))?;

    let simc_bin_path = inputs
        .simc_bins
        .resolve(simc_branch_from_payload(&envelope.payload))
        .map_err(|e| format!("Failed to resolve simc binary: {}", e))?;

    let pool_for_task = inputs.pool.clone();
    let repo_for_task = inputs.repo.clone();
    let log_buffer_for_task = inputs.log_buffer.clone();
    let queue_for_task = inputs.queue.clone();
    let job_id_owned = job_id.to_string();
    let fight_style = job.fight_style.clone();

    tokio::spawn(async move {
        let permit = if let Ok(p) = queue_for_task.clone().try_acquire_owned() {
            p
        } else {
            let _ = repo_for_task
                .update_progress(
                    &job_id_owned,
                    0,
                    "Queued",
                    "waiting for active local sim to finish",
                )
                .await;
            let cancel_tok =
                crate::cancel::CancelToken::new(repo_for_task.clone(), job_id_owned.clone());
            match crate::compute::local::await_local_queue_permit(
                &queue_for_task,
                Some(&cancel_tok),
            )
            .await
            {
                Ok(p) => p,
                Err(_) => return,
            }
        };

        if let Err(e) = repo_for_task
            .update_status(&job_id_owned, crate::models::JobStatus::Running)
            .await
        {
            eprintln!("[{}] Failed to set Running status: {}", job_id_owned, e);
        }

        let on_progress = {
            let repo = repo_for_task.clone();
            let jid = job_id_owned.clone();
            move |pct: u8, detail: String| {
                let mapped: u8 = 5u8.saturating_add(((pct as f64) * 0.90) as u8);
                let r = repo.clone();
                let i = jid.clone();
                tokio::spawn(async move {
                    let _ = r.update_progress(&i, mapped, "Staging", &detail).await;
                });
            }
        };
        let stage_inputs = super::stage_pipeline::StagePipelineInputs {
            pool: &pool_for_task,
            job_id: &job_id_owned,
            simc_bin: &simc_bin_path,
            fight_style: &fight_style,
            options: &options_for_task,
            base_profile: &base_profile_owned,
            log_buffer: log_buffer_for_task.clone(),
            simc_input_mode: SimcInputMode::Streamed,
            on_progress: Box::new(on_progress),
            on_stage_complete: Box::new({
                let repo = repo_for_task.clone();
                let jid = job_id_owned.clone();
                move |summary| {
                    let r = repo.clone();
                    let i = jid.clone();
                    tokio::spawn(async move {
                        let _ = r.update_progress(&i, 90, "Staging", &summary).await;
                    });
                }
            }),
        };
        let plan = super::stage_pipeline::default_local_topgear_plan(&options_for_task);
        match super::stage_pipeline::run_stage_pipeline(
            iter_cfg,
            stage_inputs,
            plan,
            Some(resume_state),
        )
        .await
        {
            Ok(super::stage_pipeline::StagePipelineOutcome::Completed(result)) => {
                drop(permit);
                crate::server::helpers::finalize_local_stage_result(
                    &repo_for_task,
                    &job_id_owned,
                    &base_profile_owned,
                    &result.output.json,
                    &log_buffer_for_task,
                )
                .await;
            }
            Ok(super::stage_pipeline::StagePipelineOutcome::Paused) => {}
            Err(e) => {
                let _ = repo_for_task
                    .set_error(&job_id_owned, &format!("Local stage resume failed: {}", e))
                    .await;
            }
        }
    });

    Ok(())
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

pub(crate) struct StageRewind {
    pub start_batch_idx: usize,
    pub iterator_cursor: Option<Vec<usize>>,
    pub next_combo_id: i64,
}

/// Compute the in-flight replay target from committed-pending stage batches.
/// Returns Ok(None) at a clean boundary (no pending rows). Only generated
/// pending batches reclaim combo IDs (Invariant 7); checked subtraction
/// guards against missing/over-large counts.
pub(crate) fn rewind_for_pending_stage_batches(
    checkpoint: &super::checkpoint::LocalStageCheckpoint,
    pending: &[crate::db::StageBatchRow],
) -> Result<Option<StageRewind>, String> {
    let Some(first) = pending.first() else {
        return Ok(None);
    };
    let generated_accepted: i64 = pending
        .iter()
        .filter(|b| b.source_kind == "generated")
        .map(|b| {
            b.accepted_count
                .ok_or_else(|| "Pending generated batch missing accepted_count".to_string())
        })
        .sum::<Result<i64, String>>()?;
    let next_combo_id = checkpoint
        .next_combo_id
        .checked_sub(generated_accepted)
        .filter(|v| *v >= 1)
        .ok_or_else(|| "Combo-ID reclaim underflow on resume".to_string())?;
    let iterator_cursor = match first.start_cursor_json.as_deref() {
        Some(s) => Some(
            serde_json::from_str(s).map_err(|e| format!("Invalid pending start cursor: {e}"))?,
        ),
        None => None,
    };
    Ok(Some(StageRewind {
        start_batch_idx: first.batch_idx as usize,
        iterator_cursor,
        next_combo_id,
    }))
}

/// Enforce Invariants 5 & 6: pending rows are at most one, in a single stage,
/// and form a suffix (no completed batch above the committed one).
pub(crate) fn validate_pending_stage_batches(
    pending: &[crate::db::StageBatchRow],
    max_completed_batch_idx: Option<i64>,
) -> Result<(), String> {
    if pending.is_empty() {
        return Ok(());
    }
    if pending.len() > 1 {
        return Err(format!(
            "Expected ≤1 committed-pending batch, found {}",
            pending.len()
        ));
    }
    let stage = pending[0].stage_idx;
    if pending.iter().any(|b| b.stage_idx != stage) {
        return Err("Committed-pending batches span multiple stages".to_string());
    }
    if let Some(max_done) = max_completed_batch_idx {
        if max_done >= pending[0].batch_idx {
            return Err(format!(
                "Completed batch {max_done} sits at/above committed batch {} — not a suffix",
                pending[0].batch_idx
            ));
        }
    }
    Ok(())
}

struct TriageRewind {
    cursor: Vec<usize>,
    next_batch_idx: i64,
    next_combo_id: i64,
}

fn rewind_for_pending_batches(
    checkpoint: &super::checkpoint::TriageCheckpoint,
    pending: &[crate::db::TriageBatchRow],
) -> Result<Option<TriageRewind>, String> {
    let Some(first_pending) = pending.first() else {
        return Ok(None);
    };

    let cursor: Vec<usize> = serde_json::from_str(&first_pending.start_cursor_json)
        .map_err(|e| format!("Invalid pending triage start cursor: {}", e))?;
    let accepted_to_replay: i64 = pending
        .iter()
        .map(|batch| batch.accepted_count.unwrap_or(0))
        .sum();
    let next_combo_id = checkpoint
        .next_combo_id
        .saturating_sub(accepted_to_replay)
        .max(1);

    Ok(Some(TriageRewind {
        cursor,
        next_batch_idx: first_pending.batch_idx,
        next_combo_id,
    }))
}

/// Triage-phase resume. Reconstructs the iterator, restores state from the
/// checkpoint, rewinds any committed-pending batches, and spawns
/// `run_triage_with_constants` to continue from the correct cursor.
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

    // 1. Clean up committed-but-not-completed batches. The checkpoint is written
    // before simc runs, so a crash here means the batch's dedup keys exist but
    // survivor metadata does not. Delete those batch-scoped keys and rewind to
    // the first pending batch's start cursor so no candidates are lost.
    let triage_repo = crate::db::TriageBatchesRepo::new(inputs.pool.clone());
    let dedup_repo = crate::db::ComboDedupRepo::new(inputs.pool.clone());
    let pending = triage_repo
        .committed_pending(job_id)
        .await
        .map_err(|e| format!("Failed to load committed-pending batches: {}", e))?;
    let rewind = rewind_for_pending_batches(triage_cp, &pending)?;
    for batch in &pending {
        dedup_repo
            .delete_for_batch(job_id, batch.batch_idx)
            .await
            .map_err(|e| format!("Failed to delete pending dedup keys: {}", e))?;
        sqlx::query("DELETE FROM triage_batches WHERE job_id = $1 AND batch_idx = $2")
            .bind(job_id)
            .bind(batch.batch_idx)
            .execute(&inputs.pool)
            .await
            .map_err(|e| format!("Failed to delete pending triage batch: {}", e))?;
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
    let survivors_so_far = already_collected_survivors.len();

    // 3. Rebuild the iterator config from request_json. Also parse the
    // envelope once so step 6 can read options.simc_branch without re-parsing.
    let iter_cfg = super::iterator_from_request::build_iterator_from_request_json(request_json)?;
    let envelope: crate::server::request_json::NormalizedRequest =
        serde_json::from_str(request_json).map_err(|e| format!("Invalid request_json: {}", e))?;
    let payload = &envelope.payload;
    let base_profile_owned = payload
        .get("base_profile")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "request_json missing base_profile".to_string())?
        .to_string();
    let options_for_task = payload.get("options").cloned().unwrap_or_else(|| {
        serde_json::json!({
            "iterations": job.iterations,
            "target_error": job.target_error,
            "fight_style": job.fight_style,
        })
    });
    let estimate = payload
        .get("estimate")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "request_json missing estimate for triage resume".to_string())?;

    // 4. Restore TriageState from the checkpoint.
    let restored_state = super::triage::TriageState {
        next_combo_id: rewind
            .as_ref()
            .map(|r| r.next_combo_id)
            .unwrap_or(triage_cp.next_combo_id),
        next_batch_idx: rewind
            .as_ref()
            .map(|r| r.next_batch_idx)
            .unwrap_or(triage_cp.next_batch_idx),
        survivors_so_far,
        avg_bytes_per_profileset: triage_cp.avg_bytes_per_profileset,
        estimated_total_batches: triage_cp.estimated_total_batches,
    };
    let resume_state = super::triage::TriageResumeState {
        state: restored_state,
        cursor: rewind
            .map(|r| r.cursor)
            .unwrap_or_else(|| triage_cp.next_cursor.clone()),
        already_collected_survivors,
    };

    // 5. Clear pause_requested. Running status is set inside the spawn after
    //    the queue permit is acquired, so the UI correctly shows Queued while
    //    the job waits for the semaphore (mirrors streaming_top_gear.rs).
    inputs
        .repo
        .set_pause_requested(job_id, false)
        .await
        .map_err(|e| format!("Failed to clear pause_requested: {}", e))?;

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
    let queue_for_task = inputs.queue.clone();
    let local_provider_for_task = inputs.local_provider.clone();
    let job_id_owned = job_id.to_string();
    let fight_style = job.fight_style.clone();
    let constants_for_task = checkpoint.constants;

    tokio::spawn(async move {
        // Mirror the fresh streaming path: hold a queue permit across the
        // entire triage run so resumed triage doesn't fight Quick Sim for
        // the CPU. Emit a Queued banner if we have to wait.
        let permit = if let Ok(p) = queue_for_task.clone().try_acquire_owned() {
            p
        } else {
            let _ = repo_for_task
                .update_progress(
                    &job_id_owned,
                    0,
                    "Queued",
                    "waiting for active local sim to finish",
                )
                .await;
            let cancel_tok = crate::cancel::CancelToken::new(
                repo_for_task.clone(),
                job_id_owned.clone(),
            );
            match crate::compute::local::await_local_queue_permit(
                &queue_for_task,
                Some(&cancel_tok),
            )
            .await
            {
                Ok(p) => p,
                Err(_) => return,
            }
        };

        // Flip status to Running now that the permit is held and the sim is
        // about to start. Mirrors the fresh streaming path in streaming_top_gear.rs.
        if let Err(e) = repo_for_task
            .update_status(&job_id_owned, crate::models::JobStatus::Running)
            .await
        {
            eprintln!("[{}] Failed to set Running status: {}", job_id_owned, e);
        }

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
            options: &options_for_task,
            base_profile: &base_profile_owned,
            log_buffer: log_buffer_for_task.clone(),
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
            Ok(super::triage::TriageRunOutcome::Completed(result)) => {
                // Release the triage permit so the provider-driven staged run
                // can acquire it itself (single-permit queue → holding it here
                // while the provider re-acquires would deadlock).
                drop(permit);
                crate::server::helpers::handoff_streamed_top_gear_to_staged(
                    &pool_for_task,
                    &repo_for_task,
                    local_provider_for_task,
                    &job_id_owned,
                    &base_profile_owned,
                    &options_for_task,
                    &result.survivor_combo_ids,
                    &log_buffer_for_task,
                    constants_for_task,
                )
                .await;
            }
            Ok(super::triage::TriageRunOutcome::Paused) => {}
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
/// and spawns a staged run via `spawn_profileset_sim` starting at the saved
/// `next_stage_idx`. The base_profile is taken from request_json.payload.base_profile
/// (not from job.simc_input, which for streamed jobs is the decorated form produced
/// by build_simc_input_from_options and not suitable as a raw profileset base).
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
        serde_json::from_str(request_json).map_err(|e| format!("Invalid request_json: {}", e))?;
    let payload = &envelope.payload;
    let options = payload.get("options").cloned().unwrap_or_else(|| {
        serde_json::json!({
            "iterations": job.iterations,
            "target_error": job.target_error,
            "fight_style": job.fight_style,
        })
    });
    let base_profile = payload
        .get("base_profile")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "request_json missing base_profile".to_string())?;

    // 1. Load survivor profileset_simc fragments for the saved combo_ids.
    let metadata_repo = crate::db::ComboMetadataRepo::new(inputs.pool.clone());
    let rows = metadata_repo
        .list_for_combo_ids(job_id, &staged_cp.survivor_combo_ids)
        .await
        .map_err(|e| format!("Failed to load survivors: {}", e))?;
    let survivor_simc: String = rows
        .iter()
        .map(|r| r.profileset_simc.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    if survivor_simc.is_empty() {
        return Err("No survivor profileset_simc fragments to resume with".to_string());
    }

    // Use raw base_profile prefixed with "# Base Actor\n" to match the format
    // produced by the fresh handoff_to_staged path in top_gear_handlers.rs.
    let combined = format!("# Base Actor\n{}\n{}", base_profile, survivor_simc);
    let combo_count = rows.len();

    // 2. Clear pause_requested so the job is resumable. Running status is set
    //    by run_profileset_job_task after the provider acquires a queue permit,
    //    so the UI correctly shows Queued while the job waits for the semaphore.
    inputs
        .repo
        .set_pause_requested(job_id, false)
        .await
        .map_err(|e| format!("Failed to clear pause_requested: {}", e))?;

    // 3. Spawn the staged pipeline at the saved next_stage_idx + next_batch_idx.
    //    (simc binary resolution is handled internally by the provider — it
    //    reads simc_branch from the options payload, same as a fresh job.)
    //    base_start=50 because Triage already ran (5-50% covered); staged
    //    pipeline uses 50-95%. If the checkpoint captured mid-stage batch
    //    state, resumed_batch_results gets seeded so completed batches don't
    //    re-run.
    //    The resume path holds no permit (unlike triage) — the provider acquires
    //    the queue permit internally, so no release-before-acquire concern here.
    let resume_state = crate::simc_runner::StagedResumeState {
        start_stage_idx: staged_cp.next_stage_idx,
        start_batch_idx: staged_cp.next_batch_idx,
        resumed_batch_results: staged_cp.batch_results.clone(),
    };
    crate::server::helpers::spawn_profileset_sim(
        inputs.repo.clone(),
        inputs.local_provider.clone(),
        crate::compute::ProviderAuth::None,
        options,
        job_id.to_string(),
        "top_gear".to_string(),
        combined,
        combo_count,
        inputs.log_buffer.clone(),
        crate::compute::StagedExecutionContext {
            base_start: 50, // Triage already ran (5-50%); staged uses 50-95%
            simc_input_mode: SimcInputMode::Streamed,
            resume_state,
            triage_constants: checkpoint.constants,
        },
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{StageBatchRow, TriageBatchRow};
    use crate::profileset_generator::checkpoint::{CheckpointSource, LocalStageCheckpoint};

    fn gen_row(batch_idx: i64, start: &str, accepted: i64, status: &str) -> StageBatchRow {
        StageBatchRow {
            stage_idx: 0,
            batch_idx,
            source_kind: "generated".to_string(),
            start_cursor_json: Some(start.to_string()),
            end_cursor_json: Some("[9]".to_string()),
            candidate_count: Some(accepted),
            accepted_count: Some(accepted),
            local_survivor_count: None,
            status: status.to_string(),
        }
    }

    #[test]
    fn rewind_uses_pending_cursor_and_reclaims_generated_ids() {
        // checkpoint advanced to next_combo_id=43 after a generated batch that accepted 7.
        let cp = LocalStageCheckpoint {
            stage_idx: 0, stage_name: "Broad".into(), next_batch_idx: 6,
            source: CheckpointSource::GeneratedCombinations,
            survivor_combo_ids: vec![], generated_cursor: Some(vec![9, 9]), next_combo_id: 43,
        };
        let pending = vec![gen_row(5, "[3,4]", 7, "committed")];
        let r = rewind_for_pending_stage_batches(&cp, &pending).unwrap().unwrap();
        assert_eq!(r.start_batch_idx, 5);
        assert_eq!(r.iterator_cursor, Some(vec![3, 4]));
        assert_eq!(r.next_combo_id, 36); // 43 - 7
    }

    #[test]
    fn rewind_is_none_without_pending() {
        let cp = LocalStageCheckpoint {
            stage_idx: 0, stage_name: "Broad".into(), next_batch_idx: 6,
            source: CheckpointSource::GeneratedCombinations,
            survivor_combo_ids: vec![], generated_cursor: Some(vec![9, 9]), next_combo_id: 43,
        };
        assert!(rewind_for_pending_stage_batches(&cp, &[]).unwrap().is_none());
    }

    #[test]
    fn rewind_errors_on_missing_accepted_count() {
        let cp = LocalStageCheckpoint {
            stage_idx: 0, stage_name: "Broad".into(), next_batch_idx: 6,
            source: CheckpointSource::GeneratedCombinations,
            survivor_combo_ids: vec![], generated_cursor: None, next_combo_id: 43,
        };
        let mut row = gen_row(5, "[3,4]", 0, "committed");
        row.accepted_count = None;
        assert!(rewind_for_pending_stage_batches(&cp, &[row]).is_err());
    }

    #[test]
    fn validate_pending_rejects_multi_stage() {
        let mut a = gen_row(0, "[0]", 1, "committed");
        a.stage_idx = 0;
        let mut b = gen_row(1, "[1]", 1, "committed");
        b.stage_idx = 1;
        assert!(validate_pending_stage_batches(&[a, b], None).is_err());
    }

    #[test]
    fn validate_pending_rejects_completed_above_committed() {
        // committed at batch 2, but a completed batch exists at 3 → not a suffix.
        let committed = gen_row(2, "[2]", 1, "committed");
        assert!(validate_pending_stage_batches(&[committed], Some(3)).is_err());
    }

    #[test]
    fn validate_pending_ok_for_single_tail() {
        let committed = gen_row(3, "[3]", 1, "committed");
        assert!(validate_pending_stage_batches(&[committed], Some(2)).is_ok());
    }

    #[test]
    fn rewind_survivor_pending_does_not_touch_combo_ids() {
        let cp = LocalStageCheckpoint {
            stage_idx: 1, stage_name: "Refine".into(), next_batch_idx: 3,
            source: CheckpointSource::PreviousStageSurvivors,
            survivor_combo_ids: vec![1, 2, 3], generated_cursor: None, next_combo_id: 50,
        };
        let mut row = gen_row(2, "[]", 9, "committed");
        row.source_kind = "previous_survivors".into();
        row.start_cursor_json = None;
        let r = rewind_for_pending_stage_batches(&cp, &[row]).unwrap().unwrap();
        assert_eq!(r.start_batch_idx, 2);
        assert_eq!(r.iterator_cursor, None);
        assert_eq!(r.next_combo_id, 50); // unchanged: survivor batches don't allocate ids
    }

    #[test]
    fn rewind_for_pending_batches_replays_from_first_pending_batch() {
        let checkpoint = super::super::checkpoint::TriageCheckpoint {
            next_cursor: vec![9, 9],
            next_batch_idx: 4,
            next_combo_id: 140,
            estimated_total_batches: 10,
            survivors_so_far: 25,
            avg_bytes_per_profileset: 1200,
        };
        let pending = vec![
            TriageBatchRow {
                batch_idx: 2,
                start_cursor_json: "[3,4]".to_string(),
                end_cursor_json: Some("[5,6]".to_string()),
                candidate_count: Some(500),
                accepted_count: Some(30),
                survivors_count: None,
                status: "committed".to_string(),
            },
            TriageBatchRow {
                batch_idx: 3,
                start_cursor_json: "[5,6]".to_string(),
                end_cursor_json: Some("[9,9]".to_string()),
                candidate_count: Some(500),
                accepted_count: Some(20),
                survivors_count: None,
                status: "committed".to_string(),
            },
        ];

        let rewind = rewind_for_pending_batches(&checkpoint, &pending)
            .unwrap()
            .unwrap();

        assert_eq!(rewind.cursor, vec![3, 4]);
        assert_eq!(rewind.next_batch_idx, 2);
        assert_eq!(rewind.next_combo_id, 90);
    }

    #[test]
    fn rewind_for_pending_batches_is_empty_without_pending_rows() {
        let checkpoint = super::super::checkpoint::TriageCheckpoint {
            next_cursor: vec![1],
            next_batch_idx: 1,
            next_combo_id: 5,
            estimated_total_batches: 1,
            survivors_so_far: 0,
            avg_bytes_per_profileset: 0,
        };

        assert!(rewind_for_pending_batches(&checkpoint, &[])
            .unwrap()
            .is_none());
    }
}
