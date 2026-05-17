//! Resume entry point for paused jobs. Reads the Checkpoint from
//! `jobs.checkpoint`, the normalized request from `jobs.request_json`,
//! validates state, and dispatches to the phase-appropriate continuation.
//!
//! Tasks 7 + 8 implement the actual continuation logic; this module is the
//! dispatcher.

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
            match job.status {
                JobStatus::Pending => "pending",
                JobStatus::Running => "running",
                JobStatus::Paused => "paused",
                JobStatus::Done => "done",
                JobStatus::Failed => "failed",
                JobStatus::Cancelled => "cancelled",
            }
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

    // 2. Dispatch by phase. Tasks 7 + 8 implement these stubs.
    match checkpoint.phase {
        CheckpointPhase::Triage(_) => resume_triage(job_id, &job, request_json, &checkpoint, inputs).await,
        CheckpointPhase::Staged(_) => resume_staged(job_id, &job, request_json, &checkpoint, inputs).await,
    }
}

/// Triage-phase resume. Task 7 fills this in.
async fn resume_triage(
    _job_id: &str,
    _job: &Job,
    _request_json: &str,
    _checkpoint: &Checkpoint,
    _inputs: ResumeInputs,
) -> Result<(), String> {
    Err("resume_triage not yet implemented (Phase 2 Task 7)".to_string())
}

/// Staged-phase resume. Task 8 fills this in.
async fn resume_staged(
    _job_id: &str,
    _job: &Job,
    _request_json: &str,
    _checkpoint: &Checkpoint,
    _inputs: ResumeInputs,
) -> Result<(), String> {
    Err("resume_staged not yet implemented (Phase 2 Task 8)".to_string())
}

#[cfg(test)]
mod tests {
    // Integration tests against a real sqlx pool are deferred to Task 16
    // (manual verification). Unit-testing the dispatcher logic in isolation
    // would require mocking JobRepo, which has no current mock infrastructure.
}
