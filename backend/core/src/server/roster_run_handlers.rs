use actix_web::{web, HttpRequest, HttpResponse};
use serde_json::{json, Value};
use std::sync::Arc;

use super::helpers::{resolve_provider_for_request, spawn_droptimizer_child};
use super::types::SimOptions;
use crate::compute::{ProviderRegistry, WorkloadEstimate};
use crate::db::{JobRepo, RosterRepo, RosterRunRepo, SettingsRepo};
use crate::log_buffer::LogBuffer;
use crate::models::JobStatus;
use crate::roster::drop_items::build_drop_items;
use crate::roster::report::{aggregate_report, MemberMeta};

#[derive(serde::Deserialize)]
pub struct StartRunRequest {
    pub instance_id: i64,
    pub difficulty: String,
    #[serde(flatten)]
    pub options: SimOptions,
}

/// POST /api/rosters/{id}/runs — fan out one droptimizer child job per importable
/// roster member (sharing a single batch_id), record the run + job mapping, and
/// return the run id. Members whose armory import failed (status != "ok" or empty
/// source_simc) or who have no eligible drops are skipped.
#[allow(clippy::too_many_arguments)]
pub(super) async fn start_run(
    http_req: HttpRequest,
    path: web::Path<String>,
    req: web::Json<StartRunRequest>,
    roster_repo: web::Data<RosterRepo>,
    run_repo: web::Data<RosterRunRepo>,
    job_repo: web::Data<JobRepo>,
    settings_repo: web::Data<SettingsRepo>,
    log_buffer: web::Data<Arc<LogBuffer>>,
    registry: web::Data<Arc<ProviderRegistry>>,
) -> HttpResponse {
    let roster_id = path.into_inner();

    match roster_repo.get(&roster_id).await {
        Ok(Some(_)) => {}
        Ok(None) => return HttpResponse::NotFound().json(json!({"detail": "Roster not found"})),
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
    }

    let members = match roster_repo.list_members(&roster_id).await {
        Ok(m) => m,
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
    };

    // Build per-member drops up front so the same data feeds both the workload
    // estimate (for provider resolution) and the spawn loop — avoids computing
    // drops twice. Only members that are importable AND have eligible drops are
    // kept; a member with zero combos would otherwise spawn a zero-combo job.
    let eligible: Vec<(&crate::db::RosterMember, Vec<Value>)> = members
        .iter()
        .filter(|m| m.armory_status == "ok" && !m.source_simc.trim().is_empty())
        .filter_map(|m| {
            let drops = build_drop_items(req.instance_id, &req.difficulty, &m.class, &m.spec);
            if drops.is_empty() {
                None
            } else {
                Some((m, drops))
            }
        })
        .collect();

    let max_combos = eligible.iter().map(|(_, d)| d.len()).max().unwrap_or(0);

    let (provider, avail) = match resolve_provider_for_request(
        "droptimizer",
        req.options.compute_provider.as_deref(),
        WorkloadEstimate {
            combo_count: max_combos,
            would_use_streaming_path: false,
        },
        http_req.headers(),
        settings_repo.get_ref(),
        registry.get_ref(),
    )
    .await
    {
        Ok(t) => t,
        Err(resp) => return resp,
    };

    let batch_id = uuid::Uuid::new_v4().to_string();
    let run = match run_repo
        .create_run(&roster_id, req.instance_id, &req.difficulty, &batch_id)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
    };

    let mut job_count = 0;
    for (member, drops) in &eligible {
        let job_id = match spawn_droptimizer_child(
            &member.source_simc,
            drops,
            &batch_id,
            &req.options,
            provider.clone(),
            &avail,
            job_repo.get_ref(),
            log_buffer.get_ref(),
        )
        .await
        {
            Ok(id) => id,
            Err(e) => {
                // Don't abort the whole run if one member's job fails to spawn.
                eprintln!(
                    "[roster-run {}] failed to spawn child for member {}: {}",
                    run.id, member.id, e
                );
                continue;
            }
        };
        if let Err(e) = run_repo.add_job(&run.id, &member.id, &job_id).await {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
        }
        job_count += 1;
    }

    HttpResponse::Ok().json(json!({
        "run_id": run.id,
        "batch_id": batch_id,
        "job_count": job_count,
    }))
}

/// GET /api/rosters/runs/{run_id} — report progress. Once every child job is
/// terminal, build + cache the aggregated `RosterReport` (idempotent: a cached
/// report short-circuits subsequent polls) and return it.
pub(super) async fn get_run(
    path: web::Path<String>,
    run_repo: web::Data<RosterRunRepo>,
    roster_repo: web::Data<RosterRepo>,
    job_repo: web::Data<JobRepo>,
) -> HttpResponse {
    let run_id = path.into_inner();

    let run = match run_repo.get_run(&run_id).await {
        Ok(Some(r)) => r,
        Ok(None) => return HttpResponse::NotFound().json(json!({"detail": "Run not found"})),
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
    };

    // Already aggregated: serve the cached report.
    if let Some(s) = run.report_json.as_deref() {
        return HttpResponse::Ok().json(json!({
            "status": "done",
            "report": serde_json::from_str::<Value>(s).unwrap_or(Value::Null),
        }));
    }

    let mappings = match run_repo.list_jobs(&run_id).await {
        Ok(m) => m,
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
    };

    // Fetch every child job once; reuse the snapshots for both the progress count
    // and (if all terminal) the aggregation inputs.
    let mut jobs: Vec<(String, Option<crate::models::Job>)> = Vec::with_capacity(mappings.len());
    for mapping in &mappings {
        let job = match job_repo.get(&mapping.job_id).await {
            Ok(j) => j,
            Err(e) => {
                return HttpResponse::InternalServerError()
                    .json(json!({"detail": e.to_string()}))
            }
        };
        jobs.push((mapping.member_id.clone(), job));
    }

    let total = mappings.len();
    let is_terminal = |j: &Option<crate::models::Job>| {
        matches!(
            j.as_ref().map(|j| &j.status),
            Some(JobStatus::Done) | Some(JobStatus::Failed) | Some(JobStatus::Cancelled)
        )
    };
    let done = jobs.iter().filter(|(_, j)| is_terminal(j)).count();
    let progress_pct = (100 * done).checked_div(total).unwrap_or(100);

    if done < total {
        return HttpResponse::Ok().json(json!({
            "status": "running",
            "progress_pct": progress_pct,
            "done": done,
            "total": total,
        }));
    }

    // All children terminal: aggregate. Index members by id for meta lookup.
    let members = match roster_repo.list_members(&run.roster_id).await {
        Ok(m) => m,
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
    };

    let inputs: Vec<(MemberMeta, Option<Value>)> = jobs
        .iter()
        .map(|(member_id, job)| {
            let meta = members
                .iter()
                .find(|m| &m.id == member_id)
                .map(|m| MemberMeta {
                    member_id: m.id.clone(),
                    name: m.name.clone(),
                    class: m.class.clone(),
                    spec: m.spec.clone(),
                })
                .unwrap_or_else(|| MemberMeta {
                    member_id: member_id.clone(),
                    name: String::new(),
                    class: String::new(),
                    spec: String::new(),
                });
            // A failed/empty child → None, which aggregate_report records as sim_failed.
            let result = job
                .as_ref()
                .and_then(|j| j.result_json.as_deref())
                .and_then(|s| serde_json::from_str::<Value>(s).ok());
            (meta, result)
        })
        .collect();

    let report = aggregate_report(&run.roster_id, run.instance_id, &run.difficulty, &inputs);

    match serde_json::to_string(&report) {
        Ok(json) => {
            if let Err(e) = run_repo.set_report(&run_id, &json).await {
                return HttpResponse::InternalServerError()
                    .json(json!({"detail": e.to_string()}));
            }
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
    }

    HttpResponse::Ok().json(json!({
        "status": "done",
        "report": serde_json::to_value(&report).unwrap_or(Value::Null),
    }))
}
