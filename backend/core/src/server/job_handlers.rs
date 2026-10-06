use actix_web::{web, HttpResponse};
use serde_json::{json, Value};

use super::types::*;
use crate::compute::SimcBinaries;
use crate::db::{ComboDedupRepo, ComboMetadataRepo, JobRepo, TriageBatchesRepo};
use crate::log_buffer::LogBuffer;
use crate::models::{JobStatus, SimcInputMode};
use crate::share::client::{HttpShareClient, ShareClient};
use crate::share::service::unshare_job;
use crate::simc_runner;
use std::sync::Arc;

/// Whether a Simmit job advertises pause/resume, given the chunk count.
/// `None` = read failed (transient) → advertise Pause (a no-op press beats hiding
/// it on a real multi-chunk job). `Some(1)` can't pause; `Some(>1)` can.
fn simmit_pause_capability(chunk_count: Option<i64>) -> bool {
    match chunk_count {
        None => true,
        Some(c) => c > 1,
    }
}

/// Per-run effective capabilities. For a cloud-streaming run, pause is only
/// possible when the run spans more than one chunk.
pub(super) fn effective_capabilities(
    provider_id: &str,
    chunk_count: Option<i64>,
) -> serde_json::Value {
    let is_cloud = provider_id == "simmit"; // any cloud-streaming provider
    serde_json::json!({
        "cancel": true, // both local and cloud runs are cancellable
        "pause": if is_cloud { simmit_pause_capability(chunk_count) } else { true },
    })
}

#[cfg(test)]
mod cap_tests {
    use super::*;
    #[test]
    fn cloud_single_chunk_cannot_pause() {
        assert_eq!(effective_capabilities("simmit", Some(1))["pause"], false);
        assert_eq!(effective_capabilities("simmit", Some(1))["cancel"], true);
    }
    #[test]
    fn cloud_multi_chunk_can_pause() {
        assert_eq!(effective_capabilities("simmit", Some(3))["pause"], true);
    }
    #[test]
    fn local_can_pause() {
        assert_eq!(effective_capabilities("local", None)["pause"], true);
    }
    #[test]
    fn simmit_pause_capability_does_not_hide_on_read_failure() {
        assert!(simmit_pause_capability(None)); // transient read error → still pausable
        assert!(!simmit_pause_capability(Some(1)));
        assert!(simmit_pause_capability(Some(3)));
    }
}

/// Cap on terminal-state jobs included in the active-sims overview alongside
/// any in-flight jobs. Tracked by `fetchActiveJobs` docs on the frontend.
const RECENT_TERMINAL_LIMIT: usize = 20;

#[derive(serde::Deserialize, Default, Copy, Clone)]
#[serde(rename_all = "lowercase")]
pub(super) enum StatusFilter {
    #[default]
    Active,
    All,
    Terminal,
}

#[derive(serde::Deserialize, Default)]
pub(super) struct ListJobsQuery {
    #[serde(default)]
    pub status: StatusFilter,
    pub player: Option<String>,
    pub realm: Option<String>,
    pub limit: Option<usize>,
}

/// Unified job listing for the /sims overview page (stats + batch grouping +
/// view-mode filter). Supports `?status=active|all|terminal` and optional
/// player/realm scoping. With `status=active` returns active jobs plus
/// RECENT_TERMINAL_LIMIT most recent terminal jobs (used by the polling loop);
/// other modes load up to `limit` rows (default 200).
pub(super) async fn list_jobs(
    query: web::Query<ListJobsQuery>,
    repo: web::Data<JobRepo>,
) -> HttpResponse {
    let result = match query.status {
        StatusFilter::Active => repo.list_active(RECENT_TERMINAL_LIMIT).await,
        other => {
            let status = match other {
                StatusFilter::All => crate::db::JobStatusFilter::All,
                StatusFilter::Terminal => crate::db::JobStatusFilter::Terminal,
                StatusFilter::Active => unreachable!(),
            };
            let filter = crate::db::ListJobsFilter {
                status,
                player: query.player.as_deref().filter(|s| !s.is_empty()),
                realm: query.realm.as_deref().filter(|s| !s.is_empty()),
                limit: query.limit,
            };
            repo.list_jobs(filter).await
        }
    };
    match result {
        Ok(summaries) => HttpResponse::Ok().json(summaries),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

pub(super) async fn delete_job(
    path: web::Path<String>,
    query: web::Query<DeleteJobQuery>,
    repo: web::Data<JobRepo>,
) -> HttpResponse {
    delete_job_with(
        &HttpShareClient::new(),
        repo.get_ref(),
        &path.into_inner(),
        query.force,
    )
    .await
}

async fn delete_job_with(
    client: &dyn ShareClient,
    repo: &JobRepo,
    job_id: &str,
    force: bool,
) -> HttpResponse {
    let job_id = job_id.to_string();
    let job = match repo.get(&job_id).await {
        Ok(Some(j)) => j,
        Ok(None) => return HttpResponse::NotFound().json(json!({"detail": "Job not found"})),
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
    };
    match job.status {
        JobStatus::Done | JobStatus::Failed | JobStatus::Cancelled => {}
        _ => {
            return HttpResponse::BadRequest().json(json!({
                "detail": "Only terminal-state jobs can be deleted. Cancel an active job first."
            }))
        }
    }
    if job.share_id.is_some() && job.share_delete_token.is_some() {
        if let Err(e) = unshare_job(client, repo, &job_id).await {
            eprintln!("[{job_id}] Failed to revoke share before delete: {e:?}");
            // Deleting the row would drop the only token that can take the link down.
            if !force {
                return HttpResponse::Conflict().json(json!({
                    "detail": "The public share link could not be removed",
                    "share_revoke_failed": true,
                }));
            }
        }
    }
    match repo.delete_job(&job_id).await {
        Ok(_) => HttpResponse::Ok().json(json!({"ok": true})),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

pub(super) async fn get_sim_status(
    path: web::Path<String>,
    repo: web::Data<JobRepo>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match repo.get_status_summary(&job_id).await {
        Ok(Some(j)) => j,
        Ok(None) => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
        }
    };

    let progress = match job.status {
        JobStatus::Done => 100,
        _ => job.progress_pct as i32,
    };

    let mut parsed_result: Option<Value> = job
        .result_json
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok());
    // Results stored before `setup` existed: rebuild it from the raw SimC output
    // once and store it, so later loads skip the full-row read.
    if let Some(result) = parsed_result
        .as_mut()
        .filter(|r| matches!(job.status, JobStatus::Done) && r.get("setup").is_none())
    {
        if let Ok(Some(full)) = repo.get(&job_id).await {
            if crate::result_parser::backfill_setup(result, full.raw_json.as_deref()) {
                if let Err(e) = repo.update_result_json(&job_id, &result.to_string()).await {
                    eprintln!("[{job_id}] Failed to store the backfilled setup: {e}");
                }
            }
        }
    }

    // `None` means the read failed (transient); `Some(n)` is the real count.
    // Non-simmit jobs never have chunks, so they get `Some(0)` (irrelevant to
    // the capability decision, which only fires for simmit).
    let chunk_count: Option<i64> = if job.provider_id == "simmit" {
        if let Some(pool) = repo.pool() {
            crate::db::CloudChunksRepo::new(pool.clone())
                .list_for_job(&job.id)
                .await
                .ok()
                .map(|rows| rows.len() as i64) // transient error → None (unknown)
        } else {
            Some(0)
        }
    } else {
        Some(0)
    };

    HttpResponse::Ok().json(json!({
        "id": job.id,
        "status": job.status,
        "progress": progress,
        "progress_stage": job.progress_stage,
        "progress_detail": job.progress_detail,
        "stages_completed": job.stages_completed,
        "result": parsed_result,
        "error": job.error_message,
        "simc_input_mode": job.simc_input_mode.as_str(),
        "pause_requested": job.pause_requested,
        "provider_id": job.provider_id,
        "share_id": job.share_id,
        "rerun_of": job.rerun_of,
        "chunk_count": chunk_count.unwrap_or(0), // display 0 on transient error; capability uses the Option
        "effective_capabilities": effective_capabilities(&job.provider_id, chunk_count),
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

/// Most combos one request may ask for; the live view asks for what it shows.
const MAX_COMBO_LOOKUP: usize = 40;

/// The changed items behind each named combo, from the metadata written when the
/// job was spawned, so the live view can show gear while the sim still runs.
pub(super) async fn get_sim_combos(
    path: web::Path<String>,
    query: web::Query<CombosQuery>,
    repo: web::Data<JobRepo>,
) -> HttpResponse {
    let names: Vec<&str> = query
        .names
        .split(',')
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .take(MAX_COMBO_LOOKUP)
        .collect();
    HttpResponse::Ok().json(combo_items(repo.get_ref(), &path.into_inner(), &names).await)
}

async fn combo_items(
    repo: &JobRepo,
    job_id: &str,
    names: &[&str],
) -> serde_json::Map<String, Value> {
    let mut out = serde_json::Map::new();
    let Some(pool) = repo.pool() else {
        return out;
    };
    let metadata = ComboMetadataRepo::new(pool.clone());
    for name in names {
        if let Ok(Some(row)) = metadata.get_by_name(job_id, name).await {
            if let Ok(items) = serde_json::from_str::<Value>(&row.metadata_json) {
                out.insert((*name).to_string(), items);
            }
        }
    }
    out
}

pub(super) async fn cancel_sim(path: web::Path<String>, repo: web::Data<JobRepo>) -> HttpResponse {
    let job_id = path.into_inner();

    // Atomic transition closes the read-then-write race: a separate `get`
    // followed by `update_status(Cancelled)` could clobber a Done write that
    // landed between the two calls. `cancel_if_active` succeeds only when the
    // row is still Pending, Running, or Paused.
    match repo.cancel_if_active(&job_id).await {
        Ok(true) => {
            simc_runner::kill_job(&job_id);

            // Best-effort cleanup of per-job triage rows; failures don't block cancellation.
            if let Some(pool) = repo.pool() {
                let dedup = ComboDedupRepo::new(pool.clone());
                let triage = TriageBatchesRepo::new(pool.clone());
                let metadata = ComboMetadataRepo::new(pool.clone());
                let _ = dedup.delete_for_job(&job_id).await;
                let _ = triage.delete_for_job(&job_id).await;
                let _ = metadata.delete_for_job(&job_id).await;
            }

            // Defensive: clear pause_requested so a hypothetical re-use of this job_id
            // doesn't see a stale pending pause.
            let _ = repo.set_pause_requested(&job_id, false).await;

            HttpResponse::Ok().json(json!({"status": "cancelled"}))
        }
        Ok(false) => match repo.get(&job_id).await {
            Ok(Some(_)) => HttpResponse::BadRequest().json(json!({"detail": "Job is not running"})),
            Ok(None) => HttpResponse::NotFound().json(json!({"detail": "Job not found"})),
            Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
        },
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

pub(super) async fn pause_sim(path: web::Path<String>, repo: web::Data<JobRepo>) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match repo.get(&job_id).await {
        Ok(Some(j)) => j,
        Ok(None) => return HttpResponse::NotFound().json(json!({"detail": "Job not found"})),
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
    };

    if job.status != JobStatus::Running {
        return HttpResponse::BadRequest().json(json!({
            "detail": format!("Job is not running (status is {})", job.status)
        }));
    }

    if matches!(job.simc_input_mode, SimcInputMode::Inline) {
        return HttpResponse::BadRequest().json(json!({
            "detail": "Inline-mode jobs cannot be paused (only streamed Top Gear jobs support pause/resume)"
        }));
    }

    if let Err(e) = repo.set_pause_requested(&job_id, true).await {
        return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
    }
    simc_runner::kill_job(&job_id);

    HttpResponse::Ok().json(json!({
        "status": "pause_requested",
        "message": "Pause will take effect at the next batch or stage boundary."
    }))
}

// actix extractors are one-per-param; the added HttpRequest (for per-request
// provider-key headers) pushes this to 8 — can't be collapsed.
#[allow(clippy::too_many_arguments)]
pub(super) async fn resume_sim(
    http_req: actix_web::HttpRequest,
    path: web::Path<String>,
    repo: web::Data<JobRepo>,
    simc_bins: web::Data<Arc<SimcBinaries>>,
    log_buffer: web::Data<Arc<LogBuffer>>,
    local_queue: web::Data<crate::compute::local::LocalSimQueue>,
    registry: web::Data<Arc<crate::compute::ProviderRegistry>>,
    settings_repo: web::Data<crate::db::SettingsRepo>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let pool = match repo.pool() {
        Some(p) => p.clone(),
        None => {
            return HttpResponse::InternalServerError().json(json!({
                "detail": "Resume requires a SQLite-backed JobRepo"
            }))
        }
    };

    // Build per-request provider auth exactly as submit does: merge ProviderSettings
    // with the request's `X-Provider-<id>-Key` headers, then resolve auth for this
    // job's provider. A web BYO-key arrives only on this request, so threading it lets
    // a cloud-streaming run resume instead of staying paused. Best-effort: on load
    // failure / missing job, fall through with no auth and let resume_job surface it.
    let request_auth = match crate::compute::ProviderSettings::load(
        settings_repo.get_ref(),
        &registry.remote_ids(),
    )
    .await
    {
        Ok(settings) => {
            let avail = crate::compute::ProviderAvailability::build(
                &settings,
                registry.get_ref(),
                http_req.headers(),
            );
            match repo.get(&job_id).await {
                Ok(Some(job)) => {
                    let provider_id = if job.provider_id.is_empty() {
                        "simmit"
                    } else {
                        job.provider_id.as_str()
                    };
                    avail.auth_for(provider_id)
                }
                _ => crate::compute::ProviderAuth::None,
            }
        }
        Err(_) => crate::compute::ProviderAuth::None,
    };

    let inputs = crate::profileset_generator::ResumeInputs {
        pool,
        repo: repo.get_ref().clone(),
        log_buffer: log_buffer.get_ref().clone(),
        simc_bins: simc_bins.get_ref().clone(),
        queue: local_queue.get_ref().clone(),
        local_provider: registry
            .get("local")
            .expect("local provider always registered"),
        registry: registry.get_ref().clone(),
        settings_repo: settings_repo.get_ref().clone(),
        request_auth,
    };

    match crate::profileset_generator::resume_job(&job_id, inputs).await {
        Ok(()) => HttpResponse::Ok().json(json!({"status": "resumed"})),
        Err(e) => HttpResponse::BadRequest().json(json!({"detail": e})),
    }
}

/// Survivor count + first 50 profilesets for a streamed job; `None` if the repo
/// isn't SQLite-backed. Shared by `get_sim_input` and `get_sim_input_preview`.
async fn streamed_profileset_preview(repo: &JobRepo, job_id: &str) -> Option<(i64, Vec<String>)> {
    let pool = repo.pool()?;
    let metadata_repo = ComboMetadataRepo::new(pool.clone());
    let survivor_count = metadata_repo.count_for_job(job_id).await.unwrap_or(0);
    let rows = metadata_repo
        .list_for_job(job_id, Some(50))
        .await
        .unwrap_or_default();
    Some((
        survivor_count,
        rows.into_iter().map(|r| r.profileset_simc).collect(),
    ))
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

    // Streamed sims don't store the full input, so return a readable text preview
    // (base profile + first N profilesets) instead of a JSON error. The structured
    // preview for the in-app panel lives at /input/preview.
    match job.simc_input_mode {
        SimcInputMode::Inline => HttpResponse::Ok()
            .content_type("text/plain; charset=utf-8")
            .body(job.simc_input),
        SimcInputMode::Streamed => {
            let body = match streamed_profileset_preview(repo.get_ref(), &job_id).await {
                Some((survivor_count, preview)) => format!(
                    "# NOTE: This sim used streamed input. The full SimC input is generated in\n\
                     # batches during the run and is not stored, so only a preview is available:\n\
                     # the base profile plus the first {} of {} profilesets.\n\n\
                     {}\n\n# Profilesets (preview)\n{}",
                    preview.len(),
                    survivor_count,
                    job.simc_input,
                    preview.join("\n"),
                ),
                None => format!(
                    "# NOTE: This sim used streamed input; the full input is not stored.\n\n{}",
                    job.simc_input
                ),
            };
            HttpResponse::Ok()
                .content_type("text/plain; charset=utf-8")
                .body(body)
        }
    }
}

pub(super) async fn get_sim_input_preview(
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

    match job.simc_input_mode {
        SimcInputMode::Inline => HttpResponse::Ok().json(json!({
            "mode": "inline",
            "input": job.simc_input,
        })),
        SimcInputMode::Streamed => {
            let Some((survivor_count, preview_profilesets)) =
                streamed_profileset_preview(repo.get_ref(), &job_id).await
            else {
                return HttpResponse::InternalServerError().json(json!({
                    "error": "no_pool",
                    "message": "Streamed mode requires SQLite-backed JobRepo",
                }));
            };
            let shown = preview_profilesets.len();
            HttpResponse::Ok().json(json!({
                "mode": "streamed",
                "base_profile": job.simc_input,
                "survivor_count": survivor_count,
                "preview_profilesets": preview_profilesets,
                "note": format!(
                    "Only the first {} of {} profilesets are shown. Full input is streamed in batches and not stored.",
                    shown, survivor_count
                ),
            }))
        }
    }
}

pub(super) async fn get_sim_raw(path: web::Path<String>, repo: web::Data<JobRepo>) -> HttpResponse {
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
        None => match &job.result_json {
            Some(result) => match serde_json::from_str::<Value>(result) {
                Ok(val) => HttpResponse::Ok().json(val),
                Err(_) => HttpResponse::InternalServerError()
                    .json(json!({"detail": "Failed to parse stored result"})),
            },
            None => HttpResponse::NotFound().json(json!({"detail": "No results available yet"})),
        },
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

pub(super) async fn get_sim_csv(path: web::Path<String>, repo: web::Data<JobRepo>) -> HttpResponse {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Job;
    use crate::share::client::{CreatedShare, ShareClient, ShareError};
    use std::sync::Mutex;

    struct Mock {
        deletes: Mutex<Vec<(String, String)>>,
        result: Result<(), ShareError>,
    }

    #[async_trait::async_trait]
    impl ShareClient for Mock {
        async fn create(&self, _: &Value) -> Result<CreatedShare, ShareError> {
            unreachable!()
        }
        async fn delete(&self, id: &str, token: &str) -> Result<(), ShareError> {
            self.deletes.lock().unwrap().push((id.into(), token.into()));
            self.result.clone()
        }
    }

    async fn shared_done_job(repo: &JobRepo) -> String {
        let mut job = Job::new_with_provider(
            "in".into(),
            "quick".into(),
            1000,
            "Patchwerk".into(),
            0.1,
            "local".into(),
        );
        job.status = JobStatus::Done;
        job.share_id = Some("K3Fq9xTz2a".into());
        job.share_delete_token = Some("tok".into());
        repo.insert(&job).await.unwrap();
        job.id
    }

    #[tokio::test]
    async fn combo_items_returns_the_stored_gear_by_combo_name() {
        sqlx::any::install_default_drivers();
        let db = crate::db::Database::connect("sqlite::memory:")
            .await
            .unwrap();
        let repo = JobRepo::new(db.pool.clone());
        let job = Job::new_with_provider(
            "in".into(),
            "top_gear".into(),
            1000,
            "Patchwerk".into(),
            0.1,
            "local".into(),
        );
        repo.insert(&job).await.unwrap();
        let neck = r#"[{"slot":"neck","item_id":268265,"name":"Aqirbane Reliquary"}]"#;
        crate::jobs::combo_metadata::write_combo_metadata_table_raw(
            &repo,
            &job.id,
            &[
                ("Combo 2".into(), "[]".into()),
                ("Combo 3".into(), neck.into()),
            ],
            &[],
        )
        .await;
        let got = combo_items(&repo, &job.id, &["Combo 3", "Combo 99"]).await;
        assert_eq!(got.len(), 1);
        assert_eq!(got["Combo 3"][0]["item_id"], 268265);
    }

    #[tokio::test]
    async fn delete_revokes_the_remote_share() {
        let repo = JobRepo::new_memory();
        let id = shared_done_job(&repo).await;
        let mock = Mock {
            deletes: Mutex::new(vec![]),
            result: Ok(()),
        };
        let r = delete_job_with(&mock, &repo, &id, false).await;
        assert!(r.status().is_success());
        assert_eq!(
            mock.deletes.lock().unwrap()[0],
            ("K3Fq9xTz2a".to_string(), "tok".to_string())
        );
        assert!(repo.get(&id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn delete_keeps_the_job_when_the_share_cannot_be_revoked() {
        let repo = JobRepo::new_memory();
        let id = shared_done_job(&repo).await;
        let mock = Mock {
            deletes: Mutex::new(vec![]),
            result: Err(ShareError::Unreachable("down".into())),
        };
        let r = delete_job_with(&mock, &repo, &id, false).await;
        assert_eq!(r.status(), actix_web::http::StatusCode::CONFLICT);
        let kept = repo.get(&id).await.unwrap().unwrap();
        assert_eq!(kept.share_delete_token.as_deref(), Some("tok"));

        let r = delete_job_with(&mock, &repo, &id, true).await;
        assert!(r.status().is_success());
        assert!(repo.get(&id).await.unwrap().is_none());
    }
}
