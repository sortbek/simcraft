//! Terminal-state writers: parse a finished SimC run, stamp metadata onto the
//! result, and persist it. Single owner of "how a job ends" so success/failure
//! semantics can't drift between the eager, streaming, and resume paths.

use serde_json::{json, Value};
use std::collections::HashMap;

use crate::db::JobRepo;
use crate::jobs::combo_metadata::load_combo_metadata;
use crate::models::JobStatus;
use crate::result_parser;
use crate::simc_runner;

/// Write the terminal state for a simulation job (success or failure).
///
/// Single owner of parse → stamp realm → persist result/raw/report → suppress
/// the error write on an already-cancelled job, so finalize semantics can't drift
/// across handlers. `parse` lets callers pick their mode's result-shape parser
/// (single-actor vs gear-comparison + metadata); both go through one terminal guard.
pub async fn finalize_job_outcome(
    repo: &JobRepo,
    job_id: &str,
    simc_input: &str,
    result: Result<simc_runner::SimcOutput, String>,
    parse: impl FnOnce(&Value) -> Value,
) {
    match result {
        Ok(output) => {
            let mut parsed = parse(&output.json);
            inject_realm(&mut parsed, simc_input);
            let result_str = serde_json::to_string(&parsed).unwrap_or_default();
            let raw_str = serde_json::to_string(&output.json).ok();
            if let Err(e) = repo
                .set_result(job_id, &result_str, raw_str.as_deref())
                .await
            {
                eprintln!("[{}] Failed to set result: {}", job_id, e);
            }
            if let Err(e) = repo
                .set_report_files(
                    job_id,
                    output.html_report.as_deref(),
                    output.text_output.as_deref(),
                )
                .await
            {
                eprintln!("[{}] Failed to set report files: {}", job_id, e);
            }
        }
        Err(e) => {
            // CANCEL_ERR is the explicit cancellation marker. set_error also
            // refuses to overwrite a Cancelled job (terminal-state invariant)
            // but skipping the call keeps the eprintln from firing.
            if e != simc_runner::CANCEL_ERR {
                if let Err(db_err) = repo.set_error(job_id, &e).await {
                    eprintln!("[{}] Failed to set error: {}", job_id, db_err);
                }
            }
        }
    }
}

/// Inject end-to-end elapsed time (job creation → now) into the parsed result.
/// Covers the full process including Triage and all staged-pipeline stages, not
/// just the final-stage simc wall time that simc itself reports.
pub(crate) fn inject_total_elapsed(parsed: &mut Value, created_at: &str) {
    if let Ok(created) = chrono::DateTime::parse_from_rfc3339(created_at) {
        let now = chrono::Utc::now();
        let total = (now - created.with_timezone(&chrono::Utc)).num_milliseconds() as f64 / 1000.0;
        parsed["total_elapsed_seconds"] = json!((total * 100.0).round() / 100.0);
    }
}

/// Extract server= (realm), region=, talents= from a simc input string and inject into result.
pub(crate) fn inject_realm(parsed: &mut Value, simc_input: &str) {
    for line in simc_input.lines() {
        let trimmed = line.trim();
        if let Some(val) = trimmed.strip_prefix("server=") {
            parsed["realm"] = json!(val);
        }
        if let Some(val) = trimmed.strip_prefix("region=") {
            parsed["region"] = json!(val);
        }
        if let Some(val) = trimmed.strip_prefix("talents=") {
            parsed["talent_string"] = json!(val);
        }
    }
}

/// Parse a completed local-stage-pipeline simc result, inject realm/elapsed
/// metadata, persist it as the job result, and drop the job's log buffer. Shared
/// by the live streaming Top Gear handler and the resume path so the two stay in
/// lockstep.
pub(crate) async fn finalize_local_stage_result(
    repo: &JobRepo,
    job_id: &str,
    base_profile: &str,
    output_json: &Value,
    log_buffer: &crate::log_buffer::LogBuffer,
) {
    let raw_meta = load_combo_metadata(repo, job_id).await;
    let meta = if raw_meta.is_empty() {
        None
    } else {
        Some(raw_meta)
    };
    let mut parsed =
        crate::result_parser::parse_gear_comparison_result(output_json, meta.as_ref(), "top_gear");
    inject_realm(&mut parsed, base_profile);
    if let Ok(Some(job_snap)) = repo.get(job_id).await {
        inject_total_elapsed(&mut parsed, &job_snap.created_at);
    }
    let result_str = serde_json::to_string(&parsed).unwrap_or_else(|_| "{}".to_string());
    let raw_str = serde_json::to_string(output_json).ok();
    let _ = repo
        .set_result(job_id, &result_str, raw_str.as_deref())
        .await;
    log_buffer.remove(job_id);
}

/// Translate the provider's `Result<SimcOutput, RunError>` into a terminal state:
/// parse via gear-comparison + persist; Paused/Cancelled are no-ops (status set
/// elsewhere); Other writes an error. `sim_type` is the wire string ("top_gear",
/// "droptimizer", …), stamped into the parsed result so mode identity isn't lost.
pub async fn finalize_gear_comparison_result(
    repo: &JobRepo,
    job_id: &str,
    simc_input: &str,
    sim_type: &str,
    result: Result<crate::simc_runner::SimcOutput, crate::compute::RunError>,
) {
    match result {
        Ok(output) => {
            let job_snap = repo.get(job_id).await.ok().flatten();
            let raw_meta = load_combo_metadata(repo, job_id).await;
            let meta: Option<HashMap<String, Vec<Value>>> = if raw_meta.is_empty() {
                None
            } else {
                Some(raw_meta)
            };

            let mut parsed =
                result_parser::parse_gear_comparison_result(&output.json, meta.as_ref(), sim_type);
            inject_realm(&mut parsed, simc_input);
            if let Some(ref snap) = job_snap {
                inject_total_elapsed(&mut parsed, &snap.created_at);
            }
            let result_str = serde_json::to_string(&parsed).unwrap_or_default();
            let raw_str = serde_json::to_string(&output.json).ok();
            if let Err(e) = repo
                .set_result(job_id, &result_str, raw_str.as_deref())
                .await
            {
                eprintln!("[{}] Failed to set result: {}", job_id, e);
            }
            if let Err(e) = repo
                .set_report_files(
                    job_id,
                    output.html_report.as_deref(),
                    output.text_output.as_deref(),
                )
                .await
            {
                eprintln!("[{}] Failed to set report files: {}", job_id, e);
            }
        }
        Err(crate::compute::RunError::Paused) => {
            // Status was already set to Paused inside run_simc_staged.
        }
        Err(crate::compute::RunError::Cancelled) => {
            // Cancel already handled by the CancelToken terminal-state invariant.
        }
        Err(crate::compute::RunError::Other(e)) => {
            let is_cancelled = repo
                .get(job_id)
                .await
                .ok()
                .flatten()
                .map(|j| j.status == JobStatus::Cancelled)
                .unwrap_or(false);
            if !is_cancelled {
                if let Err(db_err) = repo.set_error(job_id, &e).await {
                    eprintln!("[{}] Failed to set error: {}", job_id, db_err);
                }
            }
        }
    }
}
