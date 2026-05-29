use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use super::types::SimOptions;
use crate::db::{self, ComboMetadataInsert, ComboMetadataRepo, JobRepo};
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
/// (single-actor `parse_simc_result` vs gear-comparison `parse_top_gear_result`
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
    let blocked = regex::Regex::new(r"(?mi)^\s*(output|html|json2?|xml)\s*=").unwrap();
    input
        .lines()
        .filter(|line| !blocked.is_match(line))
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
    let re = regex::Regex::new(r"(?m)^talents=.+$").unwrap();
    if re.is_match(simc_input) {
        re.replace(simc_input, format!("talents={}", talents))
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
    let re = regex::Regex::new(r"(?m)^spec=.+$").unwrap();
    if re.is_match(simc_input) {
        re.replace(simc_input, format!("spec={}", spec)).to_string()
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

fn enqueue_job_update(
    tx: &tokio::sync::mpsc::UnboundedSender<JobUpdate>,
    update: JobUpdate,
    job_id: &str,
) {
    if tx.send(update).is_err() {
        eprintln!(
            "[{}] Failed to enqueue job update: writer task is closed",
            job_id
        );
    }
}

/// Spawn a staged (top-gear / droptimizer) simulation in a background task.
/// Progress and stage writes are serialized through an mpsc channel to prevent
/// racing. An unbounded channel keeps these callbacks lossless because staged
/// sim runs emit a finite burst of updates and we always await the writer drain
/// before persisting terminal state.
///
/// `base_start` is the lower bound of the progress-bar range for the staged
/// pipeline: 10 for inline/eager jobs (progress spans 10-95%), 50 for streamed
/// jobs that ran Triage first (Triage consumed 5-50%, staged pipeline uses 50-95%).
///
/// `simc_input_mode` controls whether checkpoint writes and pause polling are
/// active. Inline-mode jobs skip those paths; only Streamed-mode jobs support pause/resume.
///
/// `constants` are the TriageConstants used for this job. Passed through to
/// checkpoint writes so resume can reconstruct the exact same calibration.
/// Eager (Inline) callers pass `TriageConstants::default()`; Streamed callers
/// pass the constants from the Triage checkpoint.
#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_staged_sim(
    repo: JobRepo,
    simc: PathBuf,
    options: Value,
    job_id: String,
    simc_input: String,
    combo_count: usize,
    log_buffer: Arc<LogBuffer>,
    base_start: u8,
    simc_input_mode: SimcInputMode,
    resume_state: crate::simc_runner::StagedResumeState,
    constants: crate::profileset_generator::triage::TriageConstants,
) {
    tokio::spawn(async move {
        // update_status now honors the terminal-state invariant: if the job
        // was cancelled between create and spawn, this is a no-op and the
        // staged loop will hit its first cancellation gate and abort cleanly.
        if let Err(e) = repo.update_status(&job_id, JobStatus::Running).await {
            eprintln!("[{}] Failed to set Running status: {}", job_id, e);
        }
        let cancel_token = crate::cancel::CancelToken::new(repo.clone(), job_id.clone());

        // Channel for ordered progress/stage writes
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<JobUpdate>();
        let writer_repo = repo.clone();
        let writer_jid = job_id.clone();
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

        let tx_progress = tx.clone();
        let tx_stages = tx.clone();
        let progress_log_jid = job_id.clone();
        let stages_log_jid = job_id.clone();
        let logs = log_buffer.clone();
        let jid_logs = job_id.clone();
        let pool_opt = repo.pool().cloned();

        let result = simc_runner::run_simc_staged(
            &simc,
            &job_id,
            &simc_input,
            &options,
            combo_count,
            base_start,
            simc_input_mode,
            pool_opt,
            resume_state,
            constants,
            move |pct, stage, detail| {
                enqueue_job_update(
                    &tx_progress,
                    JobUpdate::Progress {
                        pct,
                        stage: stage.to_string(),
                        detail: detail.to_string(),
                    },
                    &progress_log_jid,
                );
            },
            move |summary| {
                enqueue_job_update(
                    &tx_stages,
                    JobUpdate::StageComplete {
                        summary: summary.to_string(),
                    },
                    &stages_log_jid,
                );
            },
            move |line| {
                logs.push_line(&jid_logs, line.to_string());
            },
            Some(cancel_token),
        )
        .await;

        // Close channel and wait for all queued writes to finish
        drop(tx);
        if let Err(e) = writer_handle.await {
            eprintln!("[{}] Job update writer task failed: {}", job_id, e);
        }

        // Terminal writes — after all progress is flushed. The branch's
        // staged runner returns StagedRunError::Paused for mid-pipeline
        // pauses, which finalize_job_outcome (single-error) can't model,
        // so the per-variant match stays inline here.
        match result {
            Ok(output) => {
                let job_snap = repo.get(&job_id).await.ok().flatten();
                let raw_meta = load_combo_metadata(&repo, &job_id).await;
                let meta: Option<HashMap<String, Vec<Value>>> = if raw_meta.is_empty() {
                    None
                } else {
                    Some(raw_meta)
                };

                let mut parsed = result_parser::parse_top_gear_result(&output.json, meta.as_ref());
                inject_realm(&mut parsed, &simc_input);
                if let Some(ref snap) = job_snap {
                    inject_total_elapsed(&mut parsed, &snap.created_at);
                }
                let result_str = serde_json::to_string(&parsed).unwrap_or_default();
                let raw_str = serde_json::to_string(&output.json).ok();
                // set_result/set_report_files both honor the terminal-state
                // invariant: writes are skipped when the job is already
                // cancelled, so a late-arriving result can't resurrect it.
                if let Err(e) = repo
                    .set_result(&job_id, &result_str, raw_str.as_deref())
                    .await
                {
                    eprintln!("[{}] Failed to set result: {}", job_id, e);
                }
                if let Err(e) = repo
                    .set_report_files(
                        &job_id,
                        output.html_report.as_deref(),
                        output.text_output.as_deref(),
                    )
                    .await
                {
                    eprintln!("[{}] Failed to set report files: {}", job_id, e);
                }
            }
            Err(simc_runner::StagedRunError::Paused) => {
                // Job was paused mid-pipeline. Status is already set to Paused
                // inside run_simc_staged — nothing more to do here.
            }
            Err(simc_runner::StagedRunError::Other(e)) => {
                let is_cancelled = repo
                    .get(&job_id)
                    .await
                    .ok()
                    .flatten()
                    .map(|j| j.status == JobStatus::Cancelled)
                    .unwrap_or(false);
                if !is_cancelled {
                    if let Err(db_err) = repo.set_error(&job_id, &e).await {
                        eprintln!("[{}] Failed to set error: {}", job_id, db_err);
                    }
                }
            }
        }
        log_buffer.remove(&job_id);
    });
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn handoff_streamed_top_gear_to_staged(
    pool: &sqlx::AnyPool,
    repo: &JobRepo,
    simc_bin: &std::path::Path,
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
    spawn_staged_sim(
        repo.clone(),
        simc_bin.to_path_buf(),
        options.clone(),
        job_id.to_string(),
        combined_input,
        survivor_simc_lines.len(),
        log_buffer.clone(),
        50,
        SimcInputMode::Streamed,
        crate::simc_runner::StagedResumeState::default(),
        constants,
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
            combo_id: (i as i64) + 1,
            combo_name: name.as_str(),
            combo_key: "",
            batch_idx: None,
            cursor_json: "[]",
            profileset_simc: "",
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
pub(super) async fn write_combo_metadata_table(
    repo: &JobRepo,
    job_id: &str,
    combo_metadata: &HashMap<String, Vec<Value>>,
) {
    let metadata_strs: Vec<(String, String)> = combo_metadata
        .iter()
        .map(|(name, deltas)| {
            (
                name.clone(),
                serde_json::to_string(deltas).unwrap_or_else(|_| "[]".to_string()),
            )
        })
        .collect();
    write_combo_metadata_table_raw(repo, job_id, &metadata_strs).await;
}

/// Convenience wrapper for handlers that have `HashMap<String, Value>` combo_metadata
/// (droptimizer).
pub(super) async fn write_combo_metadata_table_value(
    repo: &JobRepo,
    job_id: &str,
    combo_metadata: &HashMap<String, Value>,
) {
    let metadata_strs: Vec<(String, String)> = combo_metadata
        .iter()
        .map(|(name, val)| {
            (
                name.clone(),
                serde_json::to_string(val).unwrap_or_else(|_| "null".to_string()),
            )
        })
        .collect();
    write_combo_metadata_table_raw(repo, job_id, &metadata_strs).await;
}

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
