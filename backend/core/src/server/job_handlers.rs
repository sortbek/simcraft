use actix_web::{web, HttpResponse};
use serde_json::{json, Value};

use super::types::*;
use crate::db::JobRepo;
use crate::log_buffer::LogBuffer;
use crate::models::JobStatus;
use crate::simc_runner;
use std::sync::Arc;

#[cfg(feature = "desktop")]
pub(super) async fn list_sims(repo: web::Data<JobRepo>) -> HttpResponse {
    match repo.list_recent(20, None, None).await {
        Ok(summaries) => HttpResponse::Ok().json(summaries),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

#[cfg(not(feature = "desktop"))]
pub(super) async fn list_sims_filtered(
    query: web::Query<ListSimsQuery>,
    repo: web::Data<JobRepo>,
) -> HttpResponse {
    if query.player.is_empty() || query.realm.is_empty() {
        return HttpResponse::BadRequest().json(json!({"detail": "player and realm are required"}));
    }
    match repo.list_recent(20, Some(&query.player), Some(&query.realm)).await {
        Ok(summaries) => HttpResponse::Ok().json(summaries),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

pub(super) async fn get_sim_status(
    path: web::Path<String>,
    repo: web::Data<JobRepo>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match repo.get(&job_id).await {
        Ok(Some(j)) => j,
        Ok(None) => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
        }
    };

    let status_str = match job.status {
        JobStatus::Pending => "pending",
        JobStatus::Running => "running",
        JobStatus::Done => "done",
        JobStatus::Failed => "failed",
        JobStatus::Cancelled => "cancelled",
    };

    let progress = match job.status {
        JobStatus::Done => 100,
        _ => job.progress_pct as i32,
    };

    let parsed_result: Option<Value> = if job.status == JobStatus::Done {
        job.result_json
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok())
    } else {
        None
    };

    HttpResponse::Ok().json(json!({
        "id": job.id,
        "status": status_str,
        "progress": progress,
        "progress_stage": job.progress_stage,
        "progress_detail": job.progress_detail,
        "stages_completed": job.stages_completed,
        "result": parsed_result,
        "error": job.error_message,
    }))
}

pub(super) async fn get_sim_logs(
    path: web::Path<String>,
    query: web::Query<LogsQuery>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let (lines, next) = log_buffer.get_lines_after(&job_id, query.after);
    HttpResponse::Ok().json(json!({
        "lines": lines,
        "next": next,
    }))
}

pub(super) async fn cancel_sim(
    path: web::Path<String>,
    repo: web::Data<JobRepo>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match repo.get(&job_id).await {
        Ok(Some(j)) => j,
        Ok(None) => return HttpResponse::NotFound().json(json!({"detail": "Job not found"})),
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
        }
    };

    match job.status {
        JobStatus::Pending | JobStatus::Running => {
            let _ = repo.update_status(&job_id, JobStatus::Cancelled).await;
            simc_runner::kill_job(&job_id);
            HttpResponse::Ok().json(json!({"status": "cancelled"}))
        }
        _ => HttpResponse::BadRequest().json(json!({"detail": "Job is not running"})),
    }
}

pub(super) async fn get_sim_input(
    path: web::Path<String>,
    repo: web::Data<JobRepo>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match repo.get(&job_id).await {
        Ok(Some(j)) => j,
        Ok(None) => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
        }
    };

    HttpResponse::Ok()
        .content_type("text/plain; charset=utf-8")
        .body(job.simc_input)
}

pub(super) async fn get_sim_raw(
    path: web::Path<String>,
    repo: web::Data<JobRepo>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match repo.get(&job_id).await {
        Ok(Some(j)) => j,
        Ok(None) => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
        }
    };

    match &job.raw_json {
        Some(raw) => match serde_json::from_str::<Value>(raw) {
            Ok(val) => HttpResponse::Ok().json(val),
            Err(_) => HttpResponse::InternalServerError()
                .json(json!({"detail": "Failed to parse stored raw JSON"})),
        },
        None => {
            match &job.result_json {
                Some(result) => match serde_json::from_str::<Value>(result) {
                    Ok(val) => HttpResponse::Ok().json(val),
                    Err(_) => HttpResponse::InternalServerError()
                        .json(json!({"detail": "Failed to parse stored result"})),
                },
                None => {
                    HttpResponse::NotFound().json(json!({"detail": "No results available yet"}))
                }
            }
        }
    }
}

pub(super) async fn get_sim_html(
    path: web::Path<String>,
    repo: web::Data<JobRepo>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match repo.get(&job_id).await {
        Ok(Some(j)) => j,
        Ok(None) => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
        }
    };

    match &job.html_report {
        Some(html) => HttpResponse::Ok()
            .content_type("text/html; charset=utf-8")
            .body(html.clone()),
        None => HttpResponse::NotFound()
            .json(json!({"detail": "HTML report not available for this sim"})),
    }
}

pub(super) async fn get_sim_text_output(
    path: web::Path<String>,
    repo: web::Data<JobRepo>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match repo.get(&job_id).await {
        Ok(Some(j)) => j,
        Ok(None) => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
        }
    };

    match &job.text_output {
        Some(text) => HttpResponse::Ok()
            .content_type("text/plain; charset=utf-8")
            .body(text.clone()),
        None => HttpResponse::NotFound()
            .json(json!({"detail": "Text output not available for this sim"})),
    }
}

pub(super) async fn get_sim_csv(
    path: web::Path<String>,
    repo: web::Data<JobRepo>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match repo.get(&job_id).await {
        Ok(Some(j)) => j,
        Ok(None) => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
        }
    };

    let result = match &job.result_json {
        Some(r) => match serde_json::from_str::<Value>(r) {
            Ok(v) => v,
            Err(_) => {
                return HttpResponse::InternalServerError()
                    .json(json!({"detail": "Failed to parse result"}))
            }
        },
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "No results available yet"}))
        }
    };

    let mut csv = String::from("actor,dps,dps_error\n");

    if result.get("type").and_then(|t| t.as_str()) == Some("top_gear") {
        if let Some(base_dps) = result.get("base_dps").and_then(|v| v.as_f64()) {
            let name = result
                .get("player_name")
                .and_then(|n| n.as_str())
                .unwrap_or("Base");
            csv.push_str(&format!("{},{:.1},\n", name, base_dps));
        }
        if let Some(results) = result.get("results").and_then(|r| r.as_array()) {
            for r in results {
                let name = r.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let dps = r.get("dps").and_then(|v| v.as_f64()).unwrap_or(0.0);
                csv.push_str(&format!("{},{:.1},\n", name, dps));
            }
        }
    } else {
        let name = result
            .get("player_name")
            .and_then(|n| n.as_str())
            .unwrap_or("Player");
        let dps = result.get("dps").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let error = result
            .get("dps_error")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        csv.push_str(&format!("{},{:.1},{:.1}\n", name, dps, error));
    }

    HttpResponse::Ok()
        .content_type("text/csv; charset=utf-8")
        .insert_header((
            "Content-Disposition",
            format!("attachment; filename=\"sim-{}.csv\"", job_id),
        ))
        .body(csv)
}
