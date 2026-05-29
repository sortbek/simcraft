use actix_web::{web, HttpResponse};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;

use super::helpers::*;
use super::request_json::NormalizedRequest;
use super::types::*;
use super::SimcBinaries;
use crate::db::{ComboMetadataRepo, JobRepo};
use crate::game_data;
use crate::log_buffer::LogBuffer;
use crate::models::{Job, JobStatus, SimcInputMode};
use crate::result_parser;
use crate::simc_runner;

pub(super) async fn create_sim(
    req: web::Json<SimRequest>,
    repo: web::Data<JobRepo>,
    simc_bins: web::Data<Arc<SimcBinaries>>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let simc_input = if req.raw {
        req.simc_input.clone()
    } else {
        let mut input = if req.max_upgrade {
            game_data::upgrade_simc_input(&req.simc_input)
        } else {
            req.simc_input.clone()
        };
        input = apply_talent_override(&input, &req.options.talents);
        input = apply_spec_override(&input, &req.options.spec_override);
        input = crate::talent_normalize::normalize_simc_talents(&input);
        input = inject_expert_fields(&input, &req.options);
        input
    };

    if let Some(resp) = validate_batch(&req.options.batch_id, repo.get_ref()).await {
        return resp;
    }

    // Build the full input with sim options inline for "View Raw Input".
    let options_for_display = req.options.to_json_with_sim_type(&req.sim_type);
    let display_input = if req.raw {
        simc_input.clone()
    } else {
        simc_runner::build_simc_input_from_options(&simc_input, &options_for_display)
    };

    // Build normalized request envelope for resumability.
    let envelope = NormalizedRequest::new(
        req.sim_type.as_str(),
        json!({
            "simc_input": req.simc_input,
            "sim_type": req.sim_type,
            "max_upgrade": req.max_upgrade,
            "raw": req.raw,
            "options": req.options.to_json_with_sim_type(&req.sim_type),
        }),
    );

    // Resolve the simc binary BEFORE inserting the job — otherwise an invalid
    // branch produces an orphan Pending row that nothing will ever finish.
    let simc = match simc_bins.resolve(&req.options.simc_branch) {
        Ok(path) => path,
        Err(e) => return HttpResponse::BadRequest().json(json!({ "detail": e })),
    };

    let mut job = Job::new(
        display_input,
        req.sim_type.clone(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    job.batch_id = req.options.batch_id.clone();
    job.request_json = Some(envelope.to_json_string().unwrap_or_default());
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();
    if let Err(e) = repo.insert(&job).await {
        return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
    }
    // Quick Sim has no combo_metadata, so no table write needed.

    let repo_clone = repo.get_ref().clone();
    let mut options = req.options.to_json_with_sim_type(&req.sim_type);
    if req.raw {
        options["raw"] = serde_json::json!(true);
    }

    let job_id_clone = job_id.clone();
    let logs = log_buffer.get_ref().clone();
    let jid_logs = job_id.clone();
    let created_at_for_task = created_at.clone();

    tokio::spawn(async move {
        // update_status honors the terminal-state invariant: if the job was
        // cancelled between create and spawn, this is a no-op. The token
        // below gives run_simc a cooperative cancel signal at subprocess
        // launch so we don't burn cycles on a sim the user already aborted.
        if let Err(e) = repo_clone
            .update_status(&job_id_clone, JobStatus::Running)
            .await
        {
            eprintln!("[{}] Failed to set Running status: {}", job_id_clone, e);
        }
        if let Err(e) = repo_clone
            .update_progress(&job_id_clone, 20, "Simulating", "")
            .await
        {
            eprintln!("[{}] Failed to update progress: {}", job_id_clone, e);
        }
        let cancel_token =
            crate::cancel::CancelToken::new(repo_clone.clone(), job_id_clone.clone());
        let logs_cb = logs.clone();
        let jid_cb = jid_logs.clone();
        let result = simc_runner::run_simc(
            &simc,
            &job_id_clone,
            &simc_input,
            &options,
            move |line| logs_cb.push_line(&jid_cb, line.to_string()),
            Some(cancel_token),
        )
        .await;
        super::helpers::finalize_job_outcome(
            &repo_clone,
            &job_id_clone,
            &simc_input,
            result,
            |json| {
                let mut parsed = result_parser::parse_simc_result(json);
                inject_total_elapsed(&mut parsed, &created_at_for_task);
                parsed
            },
        )
        .await;
        logs.remove(&jid_logs);
    });

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}

#[derive(Deserialize)]
pub(super) struct SimRowRequest {
    combo_id: i64,
}

/// Strip the `profileset."<name>"+=` prefix from each line so the overrides
/// apply directly to the base actor instead of as a profileset comparison.
/// Used by sim_row to re-run a single Top Gear result row as a high-precision
/// Quick Sim.
fn profileset_overrides_to_direct(profileset_simc: &str) -> String {
    static PROFILESET_PREFIX_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r#"^\s*profileset\."[^"]+"\+="#).unwrap());
    profileset_simc
        .lines()
        .map(|line| PROFILESET_PREFIX_RE.replace(line, "").into_owned())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Re-run a single Top Gear result row as a high-precision Quick Sim. Takes
/// the source job's `base_profile` from `request_json`, the row's gear/talents
/// from `combo_metadata.profileset_simc`, and applies the overrides directly
/// to the base actor. Returns the new job_id; the caller navigates to its
/// result page.
pub(super) async fn sim_row(
    path: web::Path<String>,
    req: web::Json<SimRowRequest>,
    repo: web::Data<JobRepo>,
    simc_bins: web::Data<Arc<SimcBinaries>>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let source_id = path.into_inner();

    let source = match repo.get(&source_id).await {
        Ok(Some(j)) => j,
        Ok(None) => {
            return HttpResponse::NotFound().json(json!({"detail": "Source job not found"}))
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
    };

    if source.sim_type != "top_gear" {
        return HttpResponse::BadRequest().json(json!({
            "detail": "sim-row is only supported for top_gear jobs"
        }));
    }
    if source.simc_input_mode != SimcInputMode::Streamed {
        return HttpResponse::BadRequest().json(json!({
            "detail": "sim-row requires a streamed-mode (large combo count) source job"
        }));
    }

    let request_json = match source.request_json.as_deref() {
        Some(j) => j,
        None => {
            return HttpResponse::InternalServerError().json(json!({
                "detail": "Source job has no request_json — cannot reconstruct base profile"
            }))
        }
    };
    let envelope: NormalizedRequest = match serde_json::from_str(request_json) {
        Ok(e) => e,
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({
                "detail": format!("Invalid request_json on source job: {}", e)
            }))
        }
    };
    let base_profile = match envelope
        .payload
        .get("base_profile")
        .and_then(|v| v.as_str())
    {
        Some(s) => s.to_string(),
        None => {
            return HttpResponse::InternalServerError().json(json!({
                "detail": "Source job's request_json missing base_profile"
            }))
        }
    };

    let pool = match repo.pool() {
        Some(p) => p.clone(),
        None => {
            return HttpResponse::BadRequest().json(json!({
                "detail": "sim-row requires SQLite-backed storage"
            }))
        }
    };
    let metadata_repo = ComboMetadataRepo::new(pool);
    let combo_name = format!("Combo {}", req.combo_id);
    let row = match metadata_repo.get_by_name(&source_id, &combo_name).await {
        Ok(Some(r)) => r,
        Ok(None) => {
            return HttpResponse::NotFound().json(json!({
                "detail": format!("{} not found in source job's metadata", combo_name)
            }))
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
    };

    // Apply the combo's overrides directly to the base actor — simc parses
    // top-to-bottom, so the trailing slot= / talents= lines override the
    // matching lines in base_profile.
    let direct_overrides = profileset_overrides_to_direct(&row.profileset_simc);
    let combined_input = format!(
        "{}\n# Sim-row verification of combo {} from job {}\n{}\n",
        base_profile.trim_end(),
        req.combo_id,
        source_id,
        direct_overrides
    );

    let fight_style = source.fight_style.clone();
    // Inherit the simc branch from the source job — if the parent ran on
    // a PTR / custom / dev build, the verify needs the same binary to be
    // comparable. Falls back to the default branch when no override.
    let simc_branch = envelope
        .payload
        .get("options")
        .and_then(|o| o.get("simc_branch"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    // Fixed Quick Sim precision: 0.05% target_error, matching the
    // /quick-sim default. The point of the verify button is to nail down the
    // row's true DPS, so we always go to full Quick Sim precision regardless
    // of what the parent Top Gear job used.
    let target_error = 0.05_f64;
    let iterations: u32 = 100_000;
    let options = json!({
        "fight_style": fight_style,
        "target_error": target_error,
        "iterations": iterations,
        "desired_targets": 1,
        "max_time": 300,
        "single_actor_batch": true,
        "simc_branch": simc_branch,
    });

    // Render the input the same way Quick Sim does so "View Raw Input" on
    // the new job shows the full simc input with options inline.
    let display_input = simc_runner::build_simc_input_from_options(&combined_input, &options);

    // The new job is a regular Quick Sim. The verify-of metadata is preserved
    // in request_json so the UI can label it later if it wants.
    let verify_envelope = NormalizedRequest::new(
        "quick",
        json!({
            "simc_input": combined_input,
            "sim_type": "quick",
            "raw": true,
            "options": options,
            "verify_of": { "source_id": source_id, "combo_id": req.combo_id },
        }),
    );

    let mut job = Job::new(
        display_input,
        "quick".to_string(),
        iterations,
        fight_style,
        target_error,
    );
    job.request_json = Some(verify_envelope.to_json_string().unwrap_or_default());
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    if let Err(e) = repo.insert(&job).await {
        return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
    }

    let simc = match simc_bins.resolve(&simc_branch) {
        Ok(path) => path,
        Err(e) => return HttpResponse::BadRequest().json(json!({"detail": e})),
    };
    let repo_clone = repo.get_ref().clone();
    let logs = log_buffer.get_ref().clone();
    let job_id_clone = job_id.clone();
    let jid_logs = job_id.clone();
    let created_at_for_task = created_at.clone();
    let mut options_with_raw = options.clone();
    options_with_raw["raw"] = json!(true);
    let input_for_task = combined_input.clone();

    tokio::spawn(async move {
        if let Err(e) = repo_clone
            .update_status(&job_id_clone, JobStatus::Running)
            .await
        {
            eprintln!("[{}] Failed to set Running status: {}", job_id_clone, e);
        }
        if let Err(e) = repo_clone
            .update_progress(&job_id_clone, 20, "Simulating", "")
            .await
        {
            eprintln!("[{}] Failed to update progress: {}", job_id_clone, e);
        }
        let logs_cb = logs.clone();
        let jid_cb = jid_logs.clone();
        let cancel_token =
            crate::cancel::CancelToken::new(repo_clone.clone(), job_id_clone.clone());
        match simc_runner::run_simc(
            &simc,
            &job_id_clone,
            &input_for_task,
            &options_with_raw,
            move |line| {
                logs_cb.push_line(&jid_cb, line.to_string());
            },
            Some(cancel_token),
        )
        .await
        {
            Ok(output) => {
                let mut parsed = result_parser::parse_simc_result(&output.json);
                inject_realm(&mut parsed, &input_for_task);
                inject_total_elapsed(&mut parsed, &created_at_for_task);
                let result_str = serde_json::to_string(&parsed).unwrap_or_default();
                let raw_str = serde_json::to_string(&output.json).ok();
                if let Err(e) = repo_clone
                    .set_result(&job_id_clone, &result_str, raw_str.as_deref())
                    .await
                {
                    eprintln!("[{}] Failed to set result: {}", job_id_clone, e);
                }
                if let Err(e) = repo_clone
                    .set_report_files(
                        &job_id_clone,
                        output.html_report.as_deref(),
                        output.text_output.as_deref(),
                    )
                    .await
                {
                    eprintln!("[{}] Failed to set report files: {}", job_id_clone, e);
                }
            }
            Err(e) => {
                let is_cancelled = repo_clone
                    .get(&job_id_clone)
                    .await
                    .ok()
                    .flatten()
                    .map(|j| j.status == JobStatus::Cancelled)
                    .unwrap_or(false);
                if !is_cancelled {
                    if let Err(db_err) = repo_clone.set_error(&job_id_clone, &e).await {
                        eprintln!("[{}] Failed to set error: {}", job_id_clone, db_err);
                    }
                }
            }
        }
        logs.remove(&jid_logs);
    });

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}

#[cfg(test)]
mod sim_row_tests {
    use super::*;

    #[test]
    fn strips_profileset_prefix_from_each_line() {
        let input = "profileset.\"Combo 42\"+=head=,id=99\n\
            profileset.\"Combo 42\"+=neck=,id=100\n\
            profileset.\"Combo 42\"+=talents=ABCDEF";
        let out = profileset_overrides_to_direct(input);
        assert_eq!(out, "head=,id=99\nneck=,id=100\ntalents=ABCDEF");
    }

    #[test]
    fn leaves_non_profileset_lines_alone() {
        let input = "# comment\nhead=,id=99";
        let out = profileset_overrides_to_direct(input);
        assert_eq!(out, "# comment\nhead=,id=99");
    }
}
