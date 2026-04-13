use actix_web::{web, HttpResponse};
use serde_json::json;
use std::sync::Arc;

use super::helpers::*;
use super::types::*;
use super::SimcBinaries;
use crate::db::JobRepo;
use crate::game_data;
use crate::log_buffer::LogBuffer;
use crate::models::{Job, JobStatus};
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

    let mut job = Job::new(
        display_input,
        req.sim_type.clone(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    job.batch_id = req.options.batch_id.clone();
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();
    if let Err(e) = repo.insert(&job).await {
        return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
    }

    let repo_clone = repo.get_ref().clone();
    let simc = match simc_bins.resolve(&req.options.simc_branch) {
        Ok(path) => path,
        Err(e) => return HttpResponse::BadRequest().json(json!({ "detail": e })),
    };
    let mut options = req.options.to_json_with_sim_type(&req.sim_type);
    if req.raw {
        options["raw"] = serde_json::json!(true);
    }

    let job_id_clone = job_id.clone();
    let logs = log_buffer.get_ref().clone();
    let jid_logs = job_id.clone();

    tokio::spawn(async move {
        if let Err(e) = repo_clone.update_status(&job_id_clone, JobStatus::Running).await {
            eprintln!("[{}] Failed to set Running status: {}", job_id_clone, e);
        }
        if let Err(e) = repo_clone.update_progress(&job_id_clone, 20, "Simulating", "").await {
            eprintln!("[{}] Failed to update progress: {}", job_id_clone, e);
        }
        let logs_cb = logs.clone();
        let jid_cb = jid_logs.clone();
        match simc_runner::run_simc(&simc, &job_id_clone, &simc_input, &options, move |line| {
            logs_cb.push_line(&jid_cb, line.to_string());
        })
        .await
        {
            Ok(output) => {
                let mut parsed = result_parser::parse_simc_result(&output.json);
                inject_realm(&mut parsed, &simc_input);
                let result_str = serde_json::to_string(&parsed).unwrap_or_default();
                let raw_str = serde_json::to_string(&output.json).ok();
                if let Err(e) = repo_clone.set_result(&job_id_clone, &result_str, raw_str.as_deref()).await {
                    eprintln!("[{}] Failed to set result: {}", job_id_clone, e);
                }
                if let Err(e) = repo_clone.set_report_files(&job_id_clone, output.html_report.as_deref(), output.text_output.as_deref()).await {
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
