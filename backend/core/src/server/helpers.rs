use actix_web::HttpResponse;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

// Hot-path regexes compiled once at startup.
static RE_BLOCKED_DIRECTIVES: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"(?mi)^\s*(output|html|json2?|xml)\s*=").unwrap());
static RE_TALENTS_LINE: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"(?m)^talents=.+$").unwrap());
static RE_SPEC_LINE: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"(?m)^spec=.+$").unwrap());

use super::types::SimOptions;
use super::SimcBinaries;
use crate::db::{self, ComboMetadataInsert, ComboMetadataRepo, JobRepo, SettingsRepo};
use crate::log_buffer::LogBuffer;
use crate::models::{JobStatus, SimcInputMode};
use crate::result_parser;
use crate::simc_runner;
use crate::types::ResolveGearResponse;

/// Write the terminal state for a simulation job (success or failure).
///
/// One place owns: parsing the simc result into the user-facing shape,
/// stamping the realm onto it, persisting result/raw/report rows, and
/// suppressing the error write when the job was already cancelled. Use
/// this from every code path that drives a job to completion so the
/// finalize semantics can't drift across handlers.
///
/// `parse` lets callers pick the result-shape parser their sim mode emits
/// (single-actor `parse_simc_result` vs gear-comparison `parse_gear_comparison_result`
/// + metadata). Both shapes go through the same terminal-state guard.
pub(super) async fn finalize_job_outcome(
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

/// Sanitize user-provided custom SimC input by stripping dangerous directives.
pub(super) fn sanitize_custom_simc(input: &str) -> String {
    input
        .lines()
        .filter(|line| !RE_BLOCKED_DIRECTIVES.is_match(line))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Inject expert mode fields at the correct positions in the SimC profile.
///
/// For profileset sims (has `# Base Actor` and `### Combo` markers):
///   {header} → # Base Actor → {base lines} → {base_player} → ### Combo 1 →
///   {gear} → {raid_actors} → ### Combo 2..N → {post_combos} → {footer}
///
/// For quick sim (no markers):
///   {header} → {raw input} → {base_player} → {raid_actors} → {post_combos} → {footer}
pub(super) fn inject_expert_fields(simc_input: &str, options: &SimOptions) -> String {
    let header = sanitize_custom_simc(&options.simc_header);
    let base_player = sanitize_custom_simc(&options.simc_base_player);
    let custom_apl = sanitize_custom_simc(&options.custom_apl);
    let raid_actors = sanitize_custom_simc(&options.simc_raid_actors);
    let post_combos = sanitize_custom_simc(&options.simc_post_combos);
    let footer = sanitize_custom_simc(&options.simc_footer);

    let all_empty = header.trim().is_empty()
        && base_player.trim().is_empty()
        && custom_apl.trim().is_empty()
        && raid_actors.trim().is_empty()
        && post_combos.trim().is_empty()
        && footer.trim().is_empty();

    if all_empty {
        return simc_input.to_string();
    }

    let lines: Vec<&str> = simc_input.lines().collect();
    let has_base_actor = lines.iter().any(|l| l.trim() == "# Base Actor");

    if !has_base_actor {
        // Quick Sim: no markers, just concatenate in order
        let mut parts: Vec<&str> = Vec::new();
        if !header.trim().is_empty() {
            parts.push("# Header");
            parts.push(&header);
            parts.push("");
        }
        parts.push(simc_input);
        if !base_player.trim().is_empty() {
            parts.push("");
            parts.push("# Base Player Customization");
            parts.push(&base_player);
        }
        if !custom_apl.trim().is_empty() {
            parts.push("");
            parts.push("# Custom APL");
            parts.push(&custom_apl);
        }
        if !raid_actors.trim().is_empty() {
            parts.push("");
            parts.push("# Raid Actors");
            parts.push(&raid_actors);
        }
        if !post_combos.trim().is_empty() {
            parts.push("");
            parts.push("# Post Combination Actors");
            parts.push(&post_combos);
        }
        if !footer.trim().is_empty() {
            parts.push("");
            parts.push("# Footer");
            parts.push(&footer);
        }
        return parts.join("\n");
    }

    // Profileset sim: find markers and inject at the right positions
    let mut result: Vec<String> = Vec::new();
    let mut i = 0;
    let mut injected_base_player = false;
    let mut injected_raid_actors = false;
    let mut _last_combo_end = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim();

        // Inject header before "# Base Actor"
        if trimmed == "# Base Actor" && !header.trim().is_empty() {
            result.push("# Header".to_string());
            result.push(header.clone());
            result.push(String::new());
        }

        // Inject base_player and custom_apl before "### Combo 1"
        if trimmed == "### Combo 1" && !injected_base_player {
            if !base_player.trim().is_empty() {
                result.push("# Base Player Customization".to_string());
                result.push(base_player.clone());
                result.push(String::new());
            }
            if !custom_apl.trim().is_empty() {
                result.push("# Custom APL".to_string());
                result.push(custom_apl.clone());
                result.push(String::new());
            }
            injected_base_player = true;
        }

        // Inject raid_actors before "### Combo 2"
        if trimmed == "### Combo 2" && !raid_actors.trim().is_empty() && !injected_raid_actors {
            result.push("# Raid Actors".to_string());
            result.push(raid_actors.clone());
            result.push(String::new());
            injected_raid_actors = true;
        }

        result.push(lines[i].to_string());

        // Track end of combo blocks
        if trimmed.starts_with("### Combo") {
            _last_combo_end = result.len();
            // Scan ahead to find end of this combo block
            i += 1;
            while i < lines.len() {
                let next = lines[i].trim();
                if next.starts_with("### Combo") {
                    break; // start of next combo, don't consume
                }
                result.push(lines[i].to_string());
                _last_combo_end = result.len();
                i += 1;
            }
            continue;
        }

        i += 1;
    }

    // If raid_actors wasn't injected (only 1 combo / no Combo 2), inject after Combo 1 block
    if !injected_raid_actors && !raid_actors.trim().is_empty() {
        result.push(String::new());
        result.push("# Raid Actors".to_string());
        result.push(raid_actors);
    }

    // Post combos after all profilesets
    if !post_combos.trim().is_empty() {
        result.push(String::new());
        result.push("# Post Combination Actors".to_string());
        result.push(post_combos);
    }

    // Footer at the very end
    if !footer.trim().is_empty() {
        result.push(String::new());
        result.push("# Footer".to_string());
        result.push(footer);
    }

    result.join("\n")
}

/// Convert ResolveGearResponse slots into the items_by_slot Value format
/// used by profileset_generator and game_data functions.
pub(super) fn resolve_to_items_by_slot(
    resolved: &ResolveGearResponse,
) -> HashMap<String, Vec<Value>> {
    let mut items_by_slot: HashMap<String, Vec<Value>> = HashMap::new();
    for (slot, slot_res) in &resolved.slots {
        let mut items: Vec<Value> = Vec::new();
        if let Some(eq) = &slot_res.equipped {
            items.push(resolved_item_to_value(eq, true));
        }
        for alt in &slot_res.alternatives {
            items.push(resolved_item_to_value(alt, false));
        }
        if !items.is_empty() {
            items_by_slot.insert(slot.clone(), items);
        }
    }
    items_by_slot
}

fn resolved_item_to_value(item: &crate::types::ResolvedItem, is_equipped: bool) -> Value {
    let mut v = json!({
        "slot": item.slot,
        "simc_string": item.simc_string,
        "is_equipped": is_equipped,
        "origin": item.origin.as_str(),
        "item_id": item.item_id,
        "ilevel": item.ilevel,
        "name": item.name,
        "bonus_ids": item.bonus_ids,
        "enchant_id": item.enchant_id,
        "gem_id": item.gem_id,
        "sockets": item.sockets,
    });
    if item.is_catalyst {
        v["is_catalyst"] = json!(true);
    }
    v
}

/// Replace the talents= line in a simc input string with a new talent string.
pub(super) fn apply_talent_override(simc_input: &str, talents: &str) -> String {
    if talents.is_empty() {
        return simc_input.to_string();
    }
    if RE_TALENTS_LINE.is_match(simc_input) {
        RE_TALENTS_LINE
            .replace(simc_input, format!("talents={}", talents))
            .to_string()
    } else {
        format!("{}\ntalents={}", simc_input, talents)
    }
}

/// Replace the spec= line in a simc input string.
pub(super) fn apply_spec_override(simc_input: &str, spec: &str) -> String {
    if spec.is_empty() {
        return simc_input.to_string();
    }
    if RE_SPEC_LINE.is_match(simc_input) {
        RE_SPEC_LINE
            .replace(simc_input, format!("spec={}", spec))
            .to_string()
    } else {
        format!("{}\nspec={}", simc_input, spec)
    }
}

/// Inject end-to-end elapsed time (job creation → now) into the parsed result.
/// Covers the full process including Triage and all staged-pipeline stages, not
/// just the final-stage simc wall time that simc itself reports.
pub(super) fn inject_total_elapsed(parsed: &mut Value, created_at: &str) {
    if let Ok(created) = chrono::DateTime::parse_from_rfc3339(created_at) {
        let now = chrono::Utc::now();
        let total = (now - created.with_timezone(&chrono::Utc)).num_milliseconds() as f64 / 1000.0;
        parsed["total_elapsed_seconds"] = json!((total * 100.0).round() / 100.0);
    }
}

/// Extract server= (realm), region=, talents= from a simc input string and inject into result.
pub(super) fn inject_realm(parsed: &mut Value, simc_input: &str) {
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
    let _ = repo.set_result(job_id, &result_str, raw_str.as_deref()).await;
    log_buffer.remove(job_id);
}

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

/// Provider-agnostic profileset spawner. Used by Top Gear, Drop Finder,
/// Upgrade Compare, and Enchant/Gem handlers — they pass the resolved
/// `Arc<dyn SimcProvider>` directly and never branch on `provider.id()`.
///
/// Decomposed into three pieces:
///   - `make_run_ctx` builds the ordered-update channel + `RunCtx` callbacks
///   - `run_profileset_job_task` owns the spawn + execute path
///   - `finalize_gear_comparison_result` writes the parsed result + report files
///
/// Streaming Top Gear's post-triage handoff and resume's staged path also use
/// this spawner, routing through `LocalSimcProvider` (local-only by rule).
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

/// The actual spawned future. Sets Running status, builds the `RunCtx`,
/// calls the provider, drains the writer, then finalizes by gear-comparison
/// parser. Independently testable without touching `tokio::spawn`.
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

/// Translate the provider's `Result<SimcOutput, RunError>` into the right
/// terminal state: parse via gear-comparison, persist; Paused / Cancelled
/// are no-ops (status already set elsewhere); Other writes an error.
/// `sim_type` is the actual wire string ("top_gear", "droptimizer", etc.) —
/// it's stamped into the parsed result so mode identity isn't lost.
async fn finalize_gear_comparison_result(
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
            let meta: Option<HashMap<String, Vec<Value>>> =
                if raw_meta.is_empty() { None } else { Some(raw_meta) };

            let mut parsed = result_parser::parse_gear_comparison_result(&output.json, meta.as_ref(), sim_type);
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

/// Sim-type-agnostic payload describing a profileset workload that has been
/// generated and is ready to submit. Built by each handler from its own
/// gear/talent/enchant logic, then consumed by `submit_profileset_sim`.
pub(crate) struct ProfilesetSubmission {
    pub sim_type: &'static str,
    pub sim_mode: crate::models::SimMode,
    pub generated_input: String,
    pub combo_count: usize,
    /// Pre-serialized `(combo_name, json_string)` pairs for `combo_metadata`.
    /// Each handler serializes its own per-combo metadata shape (top_gear/
    /// enchant_gem use `Vec<Value>`; droptimizer uses `Value`) before passing
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
        .map_err(|e| {
            HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        })?;
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
/// When the resolved provider is LOCAL, the requested branch must resolve to a
/// local SimC binary BEFORE we insert a Job — otherwise an invalid branch leaves
/// an orphan Pending row that nothing can ever finish (and only surfaces as an
/// async Error). On a cloud provider this is skipped (no local binary involved).
/// Returns `Some(BadRequest)` to reject, `None` to proceed.
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

/// Shared post-resolution finalize for profileset workloads. Owns the entire
/// "build Job, insert, write metadata, spawn, return SimResponse" sequence
/// that previously sat duplicated at the bottom of four handlers.
///
/// Streaming Top Gear bypasses this helper because its long-tail flow lives
/// in `streaming_top_gear.rs` and is local-only by routing rule.
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

    let provider_id_str = provider.id().to_string();
    let mut options_json = options.to_json();
    // The handler-built `display_input` is the final ready-to-execute simc
    // text. It's what we store on the Job and what we hand to the provider.
    // `prebuilt: true` tells simc_runner to skip its internal rebuild;
    // SimmitProvider submits the text as-is.
    let display_input = crate::simc_runner::build_simc_input_from_options(
        &submission.generated_input,
        &options_json,
    );
    options_json["prebuilt"] = serde_json::json!(true);

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

    let envelope =
        crate::server::request_json::NormalizedRequest::new(submission.sim_type, submission.envelope_payload);
    job.request_json = Some(envelope.to_json_string().unwrap_or_default());
    job.batch_id = options.batch_id.clone();

    if let Err(e) = repo.insert(&job).await {
        return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
    }

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

    HttpResponse::Ok().json(crate::server::types::SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}

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

/// Write combo_metadata rows to the `combo_metadata` table.
/// This is a best-effort write — failures are logged but don't block the job.
///
/// `metadata_strs`: pre-serialized `(combo_name, metadata_json)` pairs ordered by combo_id.
pub(super) async fn write_combo_metadata_table_raw(
    repo: &JobRepo,
    job_id: &str,
    metadata_strs: &[(String, String)],
    profileset_simc_lines: &[String],
) {
    write_combo_metadata_table_raw_offset(repo, job_id, metadata_strs, profileset_simc_lines, 0).await;
}

/// As [`write_combo_metadata_table_raw`], but assigns `combo_id = base + i + 1`.
/// The cloud-streaming path writes one slice per chunk and must keep combo_ids
/// globally unique across chunks (the table PK is `(job_id, combo_id)`), so each
/// chunk passes the running count of combos already written as `combo_id_base`.
pub(super) async fn write_combo_metadata_table_raw_offset(
    repo: &JobRepo,
    job_id: &str,
    metadata_strs: &[(String, String)],
    // Per-combo simc override lines (parallel to `metadata_strs`), persisted so
    // `sim_row` can reconstruct the row's gear. Pass `&[]` when unavailable (the
    // row then stores `""` — fine for non-streamed jobs, which never sim-row).
    profileset_simc_lines: &[String],
    combo_id_base: i64,
) {
    if metadata_strs.is_empty() {
        return;
    }
    let pool = match repo.pool() {
        Some(p) => p.clone(),
        None => return, // in-memory backend, no table to write to
    };
    let metadata_repo = ComboMetadataRepo::new(pool.clone());

    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!(
                "[{}] combo_metadata table write: failed to begin tx: {}",
                job_id, e
            );
            return;
        }
    };
    let inserts: Vec<ComboMetadataInsert> = metadata_strs
        .iter()
        .enumerate()
        .map(|(i, (name, meta_json))| ComboMetadataInsert {
            combo_id: combo_id_base + (i as i64) + 1,
            combo_name: name.as_str(),
            combo_key: "",
            batch_idx: None,
            cursor_json: "[]",
            profileset_simc: profileset_simc_lines.get(i).map(String::as_str).unwrap_or(""),
            metadata_json: meta_json.as_str(),
        })
        .collect();
    if let Err(e) = metadata_repo.insert_batch(&mut tx, job_id, &inserts).await {
        eprintln!(
            "[{}] combo_metadata table write failed (non-fatal): {}",
            job_id, e
        );
        return;
    }
    if let Err(e) = tx.commit().await {
        eprintln!(
            "[{}] combo_metadata table write: commit failed (non-fatal): {}",
            job_id, e
        );
    }
}

/// Convenience wrapper for handlers that have `HashMap<String, Vec<Value>>` combo_metadata
/// (top_gear, enchant_gem, upgrade_compare).
// `write_combo_metadata_table` and `write_combo_metadata_table_value` were
// removed: each handler now pre-serializes its combo_metadata into the
// `ProfilesetSubmission::combo_metadata_serialized` field, and
// `submit_profileset_sim` writes via `write_combo_metadata_table_raw`.

/// Load combo_metadata for a job from the `combo_metadata` table.
/// Returns an empty map for in-memory repos or when no rows exist.
pub(super) async fn load_combo_metadata(
    repo: &JobRepo,
    job_id: &str,
) -> HashMap<String, Vec<Value>> {
    let Some(pool) = repo.pool() else {
        return HashMap::new();
    };
    let meta_repo = ComboMetadataRepo::new(pool.clone());
    match meta_repo.list_for_job(job_id, None).await {
        Ok(rows) => rows
            .into_iter()
            .filter_map(|r| {
                let deltas: Vec<Value> = serde_json::from_str(&r.metadata_json).ok()?;
                Some((r.combo_name, deltas))
            })
            .collect(),
        Err(_) => HashMap::new(),
    }
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
}
