use actix_web::{web, HttpRequest, HttpResponse};
use serde_json::{json, Value};
use std::sync::Arc;

use super::job_spawn::{resolve_provider_for_request, spawn_droptimizer_child};
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
    #[serde(default)]
    pub upgrade_level: Option<u64>,
    #[serde(default)]
    pub encounters: Option<Vec<i64>>,
    #[serde(default)]
    pub void_forge: bool,
    #[serde(default)]
    pub catalyst: bool,
    /// Missive stat pair for crafted-pool runs, like the droptimizer request.
    #[serde(default)]
    pub preferred_crafted_stats: Option<[u64; 2]>,
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

    let crafted_stats =
        match crate::profileset_generator::CraftedStats::resolve(req.preferred_crafted_stats) {
            Ok(cs) => cs,
            Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
        };

    // Build per-member drops up front so the same data feeds both the workload
    // estimate (for provider resolution) and the spawn loop — avoids computing
    // drops twice. Only members that are importable AND have eligible drops are
    // kept; a member with zero combos would otherwise spawn a zero-combo job.
    let tracks = crate::game_data::get_upgrade_tracks();
    let eligible: Vec<(&crate::db::RosterMember, Vec<Value>)> = members
        .iter()
        .filter(|m| m.armory_status == "ok" && !m.source_simc.trim().is_empty())
        .filter_map(|m| {
            let drops = build_drop_items(
                req.instance_id,
                &req.difficulty,
                &m.class,
                &m.spec,
                req.upgrade_level.unwrap_or(0),
                req.encounters.as_deref().unwrap_or(&[]),
                &tracks,
                req.void_forge,
                req.catalyst,
            );
            if drops.is_empty() {
                None
            } else {
                Some((m, drops))
            }
        })
        .collect();

    // Same trust-boundary rule as the droptimizer handler.
    if crafted_stats.is_some()
        && !eligible
            .iter()
            .all(|(_, drops)| crate::item_db::all_crafted_items(drops))
    {
        return HttpResponse::BadRequest().json(json!({
            "detail": "Preferred crafted stats can only be applied to crafted items."
        }));
    }

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
            crafted_stats,
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

/// GET /api/rosters/{id}/runs — list that roster's runs, newest first. `report_json`
/// is omitted to keep the payload small; fetch the full report via get_run.
pub(super) async fn list_runs(
    path: web::Path<String>,
    repo: web::Data<RosterRunRepo>,
) -> HttpResponse {
    let roster_id = path.into_inner();
    match repo.list_runs(&roster_id).await {
        Ok(runs) => HttpResponse::Ok().json(runs),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

/// `None` means the job looks fine from here; `aggregate_report` still rejects
/// results without a baseline DPS.
fn failure_reason(job: Option<&crate::models::Job>, result: &Option<Value>) -> Option<String> {
    let Some(job) = job else {
        return Some("Sim job record is no longer available.".into());
    };
    match job.status {
        JobStatus::Failed => Some(
            job.error_message
                .clone()
                .unwrap_or_else(|| "Sim failed without an error message.".into()),
        ),
        JobStatus::Cancelled => Some("Sim was cancelled.".into()),
        _ if result.is_none() => Some("Sim finished without a result.".into()),
        _ => None,
    }
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

    // Fetch every child job in one batched query; reuse the snapshots for both the
    // progress count and (if all terminal) the aggregation inputs. A mapping whose
    // job row is absent maps to None — same as the per-id `get` returning None.
    let job_ids: Vec<String> = mappings.iter().map(|m| m.job_id.clone()).collect();
    let fetched = match job_repo.get_many(&job_ids).await {
        Ok(v) => v,
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
    };
    let by_id: std::collections::HashMap<String, crate::models::Job> =
        fetched.into_iter().map(|j| (j.id.clone(), j)).collect();
    let jobs: Vec<(String, Option<crate::models::Job>)> = mappings
        .iter()
        .map(|mapping| {
            (
                mapping.member_id.clone(),
                by_id.get(&mapping.job_id).cloned(),
            )
        })
        .collect();

    let total = mappings.len();
    // A GC'd job row can never reach a terminal status, so count it as terminal —
    // otherwise the run sits at partial progress forever and never reports at all.
    let is_terminal = |j: &Option<crate::models::Job>| match j {
        None => true,
        Some(j) => matches!(
            j.status,
            JobStatus::Done | JobStatus::Failed | JobStatus::Cancelled
        ),
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

    let inputs: Vec<(MemberMeta, Option<Value>, Option<String>)> = jobs
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
            let why = failure_reason(job.as_ref(), &result);
            (meta, result, why)
        })
        .collect();

    let report = aggregate_report(&run.roster_id, run.instance_id, &run.difficulty, &inputs);

    // Serialize once for the cached column, then parse that string back into a
    // Value for the response — avoids serializing the whole report struct twice.
    let json = match serde_json::to_string(&report) {
        Ok(j) => j,
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
    };
    if let Err(e) = run_repo.set_report(&run_id, &json).await {
        return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
    }
    let report_value = serde_json::from_str::<Value>(&json).unwrap_or(Value::Null);
    HttpResponse::Ok().json(json!({ "status": "done", "report": report_value }))
}

#[cfg(test)]
mod failure_reason_tests {
    use super::*;
    use crate::models::Job;

    fn job(status: JobStatus, error: Option<&str>) -> Job {
        let mut j = Job::new_with_provider(
            String::new(),
            "droptimizer".into(),
            100_000,
            "Patchwerk".into(),
            0.1,
            "simmit".into(),
        );
        j.status = status;
        j.error_message = error.map(str::to_string);
        j
    }

    #[test]
    fn failed_job_reports_its_own_error() {
        let msg = "Simmit error [422 Unprocessable Entity runtime_override_exceeds_policy]";
        let j = job(JobStatus::Failed, Some(msg));
        assert_eq!(failure_reason(Some(&j), &None).as_deref(), Some(msg));
    }

    #[test]
    fn failed_job_without_a_message_still_explains_itself() {
        let j = job(JobStatus::Failed, None);
        assert_eq!(
            failure_reason(Some(&j), &None).as_deref(),
            Some("Sim failed without an error message.")
        );
    }

    #[test]
    fn cancelled_and_missing_jobs_are_distinguished() {
        let j = job(JobStatus::Cancelled, None);
        assert_eq!(
            failure_reason(Some(&j), &None).as_deref(),
            Some("Sim was cancelled.")
        );
        assert_eq!(
            failure_reason(None, &None).as_deref(),
            Some("Sim job record is no longer available.")
        );
    }

    #[test]
    fn done_job_with_a_result_has_no_reason() {
        let j = job(JobStatus::Done, None);
        let result = Some(serde_json::json!({"base_dps": 1000.0}));
        assert!(failure_reason(Some(&j), &result).is_none());
    }

    #[test]
    fn done_job_whose_result_did_not_parse_is_flagged() {
        let j = job(JobStatus::Done, None);
        assert_eq!(
            failure_reason(Some(&j), &None).as_deref(),
            Some("Sim finished without a result.")
        );
    }
}
