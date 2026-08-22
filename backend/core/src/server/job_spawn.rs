//! Job submission and spawning: resolve a compute provider, insert the `Job`
//! row, and drive the provider to completion on a background task. The single
//! provider-agnostic path shared by Top Gear, Drop Finder, Upgrade Compare and
//! the roster batch orchestrator — callers never branch on provider id.

use actix_web::HttpResponse;
use serde_json::{json, Value};
use std::sync::Arc;

use super::simc_input::inject_expert_fields;
use super::types::SimOptions;
use crate::compute::SimcBinaries;
use crate::db::{self, ComboMetadataRepo, JobRepo, SettingsRepo};
use crate::jobs::combo_metadata::write_combo_metadata_table_raw;
use crate::jobs::finalize::finalize_gear_comparison_result;
use crate::log_buffer::LogBuffer;
use crate::models::{JobStatus, SimcInputMode};

enum JobUpdate {
    Progress {
        pct: u8,
        stage: String,
        detail: String,
    },
    StageComplete {
        summary: String,
    },
}

/// Provider-agnostic profileset spawner (Top Gear, Drop Finder, Upgrade Compare).
/// Callers pass the resolved `Arc<dyn SimcProvider>` and never branch on its id.
/// Decomposed into `make_run_ctx` (update channel + callbacks),
/// `run_profileset_job_task` (spawn + execute), `finalize_gear_comparison_result`
/// (parse + report). Streaming Top Gear's post-triage handoff and resume's staged
/// path route through here via `LocalSimcProvider` (local-only by rule).
#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_profileset_sim(
    repo: JobRepo,
    provider: Arc<dyn crate::compute::SimcProvider>,
    auth: crate::compute::ProviderAuth,
    options: Value,
    job_id: String,
    sim_type: String,
    simc_input: String,
    combo_count: usize,
    log_buffer: Arc<LogBuffer>,
    staged_ctx: crate::compute::StagedExecutionContext,
) {
    tokio::spawn(run_profileset_job_task(
        repo,
        provider,
        auth,
        options,
        job_id,
        sim_type,
        simc_input,
        combo_count,
        log_buffer,
        staged_ctx,
    ));
}

/// Set up an ordered progress/stage-complete writer task and return a `RunCtx`
/// whose callbacks feed that writer. The returned `JoinHandle` must be awaited
/// (after dropping `_tx`) before writing the final result, so queued updates
/// drain without overwriting the terminal state.
fn make_run_ctx<'a>(
    job_id: &'a str,
    repo: &JobRepo,
    log_buffer: &Arc<LogBuffer>,
    auth: crate::compute::ProviderAuth,
) -> (
    crate::compute::RunCtx<'a>,
    tokio::sync::mpsc::UnboundedSender<JobUpdate>,
    tokio::task::JoinHandle<()>,
) {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<JobUpdate>();
    let writer_repo = repo.clone();
    let writer_jid = job_id.to_string();
    let writer_handle = tokio::spawn(async move {
        while let Some(update) = rx.recv().await {
            match update {
                JobUpdate::Progress { pct, stage, detail } => {
                    if let Err(e) = writer_repo
                        .update_progress(&writer_jid, pct, &stage, &detail)
                        .await
                    {
                        eprintln!("[{}] Failed to update progress: {}", writer_jid, e);
                    }
                }
                JobUpdate::StageComplete { summary } => {
                    if let Err(e) = writer_repo.complete_stage(&writer_jid, &summary).await {
                        eprintln!("[{}] Failed to complete stage: {}", writer_jid, e);
                    }
                }
            }
        }
    });

    let cancel_token = crate::cancel::CancelToken::new(repo.clone(), job_id.to_string());

    let tx_progress = tx.clone();
    let tx_stages = tx.clone();
    let logs_cb = log_buffer.clone();
    let jid_logs = job_id.to_string();

    let ctx = crate::compute::RunCtx {
        job_id,
        on_progress: Arc::new(move |pct, lbl: &str, sub: &str| {
            let _ = tx_progress.send(JobUpdate::Progress {
                pct,
                stage: lbl.to_string(),
                detail: sub.to_string(),
            });
        }),
        on_stage_complete: Arc::new(move |summary: &str| {
            let _ = tx_stages.send(JobUpdate::StageComplete {
                summary: summary.to_string(),
            });
        }),
        on_log: Arc::new(move |line: &str| logs_cb.push_line(&jid_logs, line.to_string())),
        cancel: Some(cancel_token),
        auth,
    };

    (ctx, tx, writer_handle)
}

/// The spawned future: set Running, build `RunCtx`, call provider, drain writer,
/// finalize via gear-comparison parser. Testable without `tokio::spawn`.
#[allow(clippy::too_many_arguments)]
async fn run_profileset_job_task(
    repo: JobRepo,
    provider: Arc<dyn crate::compute::SimcProvider>,
    auth: crate::compute::ProviderAuth,
    options: Value,
    job_id: String,
    sim_type: String,
    simc_input: String,
    combo_count: usize,
    log_buffer: Arc<LogBuffer>,
    staged_ctx: crate::compute::StagedExecutionContext,
) {
    if let Err(e) = repo.update_status(&job_id, JobStatus::Running).await {
        eprintln!("[{}] Failed to set Running status: {}", job_id, e);
    }

    let (ctx, tx, writer_handle) = make_run_ctx(&job_id, &repo, &log_buffer, auth);

    let result = provider
        .run_with_profilesets(ctx, &simc_input, &options, combo_count, staged_ctx)
        .await;

    // Close the writer channel and drain queued updates before writing the
    // final result — otherwise a late progress write could clobber it.
    drop(tx);
    let _ = writer_handle.await;

    finalize_gear_comparison_result(&repo, &job_id, &simc_input, &sim_type, result).await;
    log_buffer.remove(&job_id);
}

/// Sim-type-agnostic payload describing a profileset workload that has been
/// generated and is ready to submit. Built by each handler from its own
/// gear/talent/enchant logic, then consumed by `submit_profileset_sim`.
pub(crate) struct ProfilesetSubmission {
    pub sim_type: &'static str,
    pub sim_mode: crate::models::SimMode,
    pub generated_input: String,
    pub combo_count: usize,
    /// Pre-serialized `(combo_name, json_string)` pairs for `combo_metadata`.
    /// Each handler serializes its own per-combo metadata shape (top_gear and
    /// upgrade_compare use `Vec<Value>`; droptimizer uses `Value`) before passing
    /// here so this helper stays sim-type-agnostic.
    pub combo_metadata_serialized: Vec<(String, String)>,
    /// JSON body for the `NormalizedRequest` envelope (sim-type-specific).
    pub envelope_payload: Value,
}

/// Resolve the compute provider for an incoming sim request. Shared by all
/// profileset-using handlers (and Top Gear's streaming-path pre-check).
/// Returns the chosen provider + the availability snapshot used to derive auth.
pub(crate) async fn resolve_provider_for_request(
    sim_type: &str,
    compute_provider: Option<&str>,
    est: crate::compute::WorkloadEstimate,
    req_headers: &actix_web::http::header::HeaderMap,
    settings_repo: &SettingsRepo,
    registry: &crate::compute::ProviderRegistry,
) -> Result<
    (
        Arc<dyn crate::compute::SimcProvider>,
        crate::compute::ProviderAvailability,
    ),
    HttpResponse,
> {
    let settings = crate::compute::ProviderSettings::load(settings_repo, &registry.remote_ids())
        .await
        .map_err(|e| HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})))?;
    let avail = crate::compute::ProviderAvailability::build(&settings, registry, req_headers);
    let provider = registry
        .for_request(sim_type, compute_provider, &avail, &est)
        .map_err(|e| HttpResponse::BadRequest().json(json!({"detail": e.to_string()})))?;
    Ok((provider, avail))
}

/// Pure decision: should an eager submit be rejected up front for a bad branch?
/// Only LOCAL submits need a resolvable binary; a cloud provider doesn't use a
/// local binary, so a branch that won't resolve locally is the remote's concern.
fn eager_branch_reject(is_local: bool, resolve_ok: bool) -> bool {
    is_local && !resolve_ok
}

/// Up-front `simc_branch` validation for the EAGER (non-streaming) submit path.
/// LOCAL provider: branch must resolve to a local binary BEFORE inserting a Job,
/// else a bad branch leaves an orphan Pending row that only fails async. Skipped
/// for cloud. Returns `Some(BadRequest)` to reject, `None` to proceed.
pub(crate) fn validate_eager_branch(
    provider: &Arc<dyn crate::compute::SimcProvider>,
    simc_bins: &SimcBinaries,
    branch: &str,
) -> Option<HttpResponse> {
    let is_local = provider.id() == "local";
    if !is_local {
        // Cloud provider: branch validation is the remote's concern.
        return None;
    }
    match simc_bins.resolve(branch) {
        Ok(_) => None,
        Err(e) if eager_branch_reject(is_local, false) => {
            Some(HttpResponse::BadRequest().json(json!({ "detail": e })))
        }
        Err(_) => None,
    }
}

/// Shared post-resolution finalize for profileset workloads: build Job, insert,
/// write metadata, spawn, return SimResponse (previously duplicated across four
/// handlers). Streaming Top Gear bypasses this — its flow lives in
/// `streaming_top_gear.rs` and is local-only by routing rule.
pub(crate) async fn submit_profileset_sim(
    submission: ProfilesetSubmission,
    options: &crate::server::types::SimOptions,
    provider: Arc<dyn crate::compute::SimcProvider>,
    avail: crate::compute::ProviderAvailability,
    repo: &JobRepo,
    simc_bins: &SimcBinaries,
    log_buffer: &Arc<LogBuffer>,
) -> HttpResponse {
    // Reject an invalid simc_branch BEFORE inserting the Job — otherwise a bad
    // local branch leaves an orphan Pending row that only fails asynchronously.
    if let Some(resp) = validate_eager_branch(&provider, simc_bins, &options.simc_branch) {
        return resp;
    }

    let batch_id = options.batch_id.clone();
    match insert_and_spawn_profileset_job(
        submission, options, batch_id, provider, &avail, repo, log_buffer, false,
    )
    .await
    {
        Ok((job_id, created_at)) => HttpResponse::Ok().json(crate::server::types::SimResponse {
            id: job_id,
            status: "pending".to_string(),
            created_at,
        }),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

/// Job-creation core shared by `submit_profileset_sim` (HTTP) and batch
/// orchestrators (e.g. `spawn_droptimizer_child`): build the `Job`, insert it,
/// write combo metadata, spawn the profileset task. Returns `(job_id, created_at)`.
///
/// `batch_id` is passed explicitly (rather than read off `options`) so batch
/// orchestrators can stamp every child with a shared run id without mutating a
/// borrowed `SimOptions`.
///
/// Does NOT validate `simc_branch` — callers that need eager branch rejection
/// (the HTTP handler) run `validate_eager_branch` first; batch orchestrators
/// validate once before their loop.
#[allow(clippy::too_many_arguments)]
async fn insert_and_spawn_profileset_job(
    submission: ProfilesetSubmission,
    options: &crate::server::types::SimOptions,
    batch_id: Option<String>,
    provider: Arc<dyn crate::compute::SimcProvider>,
    avail: &crate::compute::ProviderAvailability,
    repo: &JobRepo,
    log_buffer: &Arc<LogBuffer>,
    force_single_pass: bool,
) -> Result<(String, String), sqlx::Error> {
    let provider_id_str = provider.id().to_string();
    let mut options_json = options.to_json();
    // `display_input` is the final ready-to-execute text (stored on the Job, handed
    // to the provider). `prebuilt: true` tells simc_runner to skip its rebuild;
    // SimmitProvider submits the text as-is.
    let display_input = crate::simc_runner::build_simc_input_from_options(
        &submission.generated_input,
        &options_json,
    );
    options_json["prebuilt"] = serde_json::json!(true);
    // Roster loot reports run every combo in one pass at the user target_error
    // (no staging). Only stamped when requested, so other sim types are unaffected.
    if force_single_pass {
        options_json["force_single_pass"] = serde_json::json!(true);
    }

    let mut job = crate::models::Job::new_with_provider(
        display_input.clone(),
        submission.sim_mode.as_wire().to_string(),
        options.iterations,
        options.fight_style.clone(),
        options.target_error,
        provider_id_str,
    );
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    let envelope = crate::jobs::request_json::NormalizedRequest::new(
        submission.sim_type,
        submission.envelope_payload,
    );
    job.request_json = Some(envelope.to_json_string().unwrap_or_default());
    job.batch_id = batch_id;

    repo.insert(&job).await?;

    // Non-streamed (eager) jobs never sim-row, so no per-combo override lines are
    // persisted here (`&[]` → profileset_simc stays empty).
    write_combo_metadata_table_raw(repo, &job_id, &submission.combo_metadata_serialized, &[]).await;

    let sim_type = submission.sim_type.to_string();
    let auth = avail.auth_for(provider.id());
    spawn_profileset_sim(
        repo.clone(),
        provider,
        auth,
        options_json,
        job_id.clone(),
        sim_type,
        display_input,
        submission.combo_count,
        log_buffer.clone(),
        crate::compute::StagedExecutionContext {
            base_start: 10, // inline/eager: staged pipeline spans 10-95%
            simc_input_mode: crate::models::SimcInputMode::Inline,
            ..Default::default()
        },
    );

    Ok((job_id, created_at))
}

/// Create + spawn one droptimizer child job; returns its job id. Mirrors the
/// droptimizer handler's submission flow but returns the id (for batch
/// orchestration across roster members) instead of an HttpResponse.
///
/// The caller is responsible for resolving the provider/availability once and
/// for any up-front `simc_branch` validation; this helper reuses the same
/// job-creation core as `submit_profileset_sim`, so child jobs are spawned with
/// identical auth/staged-context semantics to the HTTP path.
// Consumed by the Phase 2 roster-run endpoint (`roster_run_handlers::start_run`).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn spawn_droptimizer_child(
    simc_input: &str,
    drop_items: &[Value],
    batch_id: &str,
    options: &SimOptions,
    provider: Arc<dyn crate::compute::SimcProvider>,
    avail: &crate::compute::ProviderAvailability,
    repo: &JobRepo,
    log_buffer: &Arc<LogBuffer>,
) -> Result<String, sqlx::Error> {
    let simc_input = crate::server::handler_prep::preprocess_simc_input(
        simc_input,
        &options.talents,
        &options.spec_override,
    );
    let parse_result = crate::addon_parser::parse_simc_input(&simc_input);
    let base_profile = parse_result.base_profile.clone();

    let (generated_input, combo_count, combo_metadata) =
        crate::profileset_generator::generate_droptimizer_input(&base_profile, drop_items, None);

    let generated_input = inject_expert_fields(&generated_input, options);

    let envelope_payload = json!({
        "base_profile": base_profile,
        "drop_items": drop_items,
        "options": options.to_json(),
    });

    let combo_metadata_serialized =
        crate::server::handler_prep::serialize_combo_metadata_value(&combo_metadata);

    let submission = ProfilesetSubmission {
        sim_type: "droptimizer",
        sim_mode: crate::models::SimMode::Droptimizer,
        generated_input,
        combo_count,
        combo_metadata_serialized,
        envelope_payload,
    };

    // Stamp every child with the shared run batch_id so the orchestrator can poll
    // them collectively (overriding whatever options.batch_id may hold).
    let (job_id, _created_at) = insert_and_spawn_profileset_job(
        submission,
        options,
        Some(batch_id.to_string()),
        provider,
        avail,
        repo,
        log_buffer,
        true, // roster loot report: run all combos in one pass at target_error (no staging)
    )
    .await?;
    Ok(job_id)
}

// Threads the streamed run's full context into the staged phase; grouping these
// into a struct would only move the same fields behind one more indirection.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn handoff_streamed_top_gear_to_staged(
    pool: &sqlx::AnyPool,
    repo: &JobRepo,
    provider: Arc<dyn crate::compute::SimcProvider>,
    job_id: &str,
    base_profile: &str,
    options: &Value,
    survivor_combo_ids: &[i64],
    log_buffer: &Arc<LogBuffer>,
    constants: crate::profileset_generator::triage::TriageConstants,
) {
    if survivor_combo_ids.is_empty() {
        let _ = repo
            .set_error(
                job_id,
                "Triage eliminated all candidates; no survivors to sim.",
            )
            .await;
        log_buffer.remove(job_id);
        return;
    }

    let metadata_repo = ComboMetadataRepo::new(pool.clone());
    let rows = match metadata_repo
        .list_for_combo_ids(job_id, survivor_combo_ids)
        .await
    {
        Ok(rows) => rows,
        Err(e) => {
            let _ = repo
                .set_error(
                    job_id,
                    &format!("Handoff: failed to read combo metadata: {}", e),
                )
                .await;
            log_buffer.remove(job_id);
            return;
        }
    };

    let survivor_simc_lines: Vec<&str> = rows.iter().map(|r| r.profileset_simc.as_str()).collect();
    if survivor_simc_lines.is_empty() {
        let _ = repo
            .set_error(job_id, "Triage produced no survivor profilesets to sim.")
            .await;
        log_buffer.remove(job_id);
        return;
    }

    let combined_input = format!(
        "# Base Actor\n{}\n{}",
        base_profile,
        survivor_simc_lines.join("\n")
    );
    // Pre-build through the same pipeline the eager handlers use so the
    // streamed final stage sees identically-prepared input. `prebuilt: true`
    // tells run_simc_staged to append per-stage target_error overrides
    // instead of rebuilding the whole input each stage.
    let prebuilt_input =
        crate::simc_runner::build_simc_input_from_options(&combined_input, options);
    let mut staged_options = options.clone();
    staged_options["prebuilt"] = serde_json::json!(true);

    spawn_profileset_sim(
        repo.clone(),
        provider,
        crate::compute::ProviderAuth::None, // local provider ignores auth
        staged_options,
        job_id.to_string(),
        "top_gear".to_string(),
        prebuilt_input,
        survivor_simc_lines.len(),
        log_buffer.clone(),
        crate::compute::StagedExecutionContext {
            base_start: 50, // Triage consumed 5-50%; staged pipeline spans 50-95%
            simc_input_mode: SimcInputMode::Streamed,
            resume_state: crate::simc_runner::StagedResumeState::default(),
            triage_constants: constants,
        },
    );
}

/// Validate batch_id against MAX_SCENARIOS. Returns an error response if rejected.
pub(super) async fn validate_batch(
    batch_id: &Option<String>,
    repo: &JobRepo,
) -> Option<actix_web::HttpResponse> {
    let bid = match batch_id {
        Some(b) if !b.is_empty() => b,
        _ => return None,
    };
    let max = db::MAX_SCENARIOS.load(std::sync::atomic::Ordering::Relaxed);
    if max == 0 {
        return Some(actix_web::HttpResponse::BadRequest().json(json!({
            "detail": "Batch scenarios are disabled on this server."
        })));
    }
    if repo.count_batch(bid).await.unwrap_or(0) >= max {
        return Some(actix_web::HttpResponse::BadRequest().json(json!({
            "detail": format!("Batch limit reached ({max} scenarios max).")
        })));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::eager_branch_reject;

    #[test]
    fn eager_branch_reject_only_rejects_bad_local_branch() {
        // Local provider + branch won't resolve → reject up front.
        assert!(eager_branch_reject(true, false));
        // Local provider + branch resolves → allow.
        assert!(!eager_branch_reject(true, true));
        // Cloud provider + branch won't resolve locally → allow (remote's concern).
        assert!(!eager_branch_reject(false, false));
        // Cloud provider + resolves → allow.
        assert!(!eager_branch_reject(false, true));
    }

    #[test]
    fn dungeon_route_custom_apl_is_appended_after_gear_not_before_combos() {
        use super::inject_expert_fields;
        use crate::server::types::SimOptions;
        use serde_json::json;

        // A route block ends with the enemy actor + pull events. If it were
        // injected before "### Combo 1" (where ordinary custom_apl goes), the gear
        // emitted under "### Combo 1" would bind to the enemy actor and SimC would
        // abort with "Enemy '…': Item '…' Slot '…': Invalid type".
        let route = "fight_style=DungeonRoute\n\
            enemy=\"Dayshade\"\n\
            raid_events+=/pull,pull=1,enemies=\"x_1\":100";
        let options: SimOptions = serde_json::from_value(json!({ "custom_apl": route })).unwrap();

        let input = "# Base Actor\nhunter=\"T\"\n### Combo 1\nhead=,id=1\nhands=,id=2\n\n\
            profileset.\"Combo 2\"+=head=,id=3";
        let out = inject_expert_fields(input, &options);

        let route_idx = out.find("fight_style=DungeonRoute").expect("route present");
        let combo_idx = out.find("### Combo 1").expect("combo marker present");
        let gear_idx = out.find("hands=,id=2").expect("equipped gear present");
        assert!(route_idx > combo_idx, "route must come after ### Combo 1");
        assert!(
            route_idx > gear_idx,
            "route must come after the equipped gear"
        );
        // Route is emitted as its own trailing block, not a pre-combo "# Custom APL".
        assert!(out.contains("# Dungeon Route"));
        assert!(
            !out.contains("# Custom APL"),
            "dungeon route must not be injected before the combos"
        );
    }
}
