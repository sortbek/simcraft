use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use super::types::SimOptions;
use crate::db::{self, JobRepo};
use crate::log_buffer::LogBuffer;
use crate::models::JobStatus;
use crate::result_parser;
use crate::simc_runner;
use crate::types::ResolveGearResponse;

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
    Progress { pct: u8, stage: String, detail: String },
    StageComplete { summary: String },
}

fn enqueue_job_update(
    tx: &tokio::sync::mpsc::UnboundedSender<JobUpdate>,
    update: JobUpdate,
    job_id: &str,
) {
    if tx.send(update).is_err() {
        eprintln!("[{}] Failed to enqueue job update: writer task is closed", job_id);
    }
}

/// Spawn a staged (top-gear / droptimizer) simulation in a background task.
/// Progress and stage writes are serialized through an mpsc channel to prevent
/// racing. An unbounded channel keeps these callbacks lossless because staged
/// sim runs emit a finite burst of updates and we always await the writer drain
/// before persisting terminal state.
pub(super) fn spawn_staged_sim(
    repo: JobRepo,
    simc: PathBuf,
    options: Value,
    job_id: String,
    simc_input: String,
    combo_count: usize,
    log_buffer: Arc<LogBuffer>,
) {
    tokio::spawn(async move {
        if let Err(e) = repo.update_status(&job_id, JobStatus::Running).await {
            eprintln!("[{}] Failed to set Running status: {}", job_id, e);
        }

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
                        if let Err(e) =
                            writer_repo.complete_stage(&writer_jid, &summary).await
                        {
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

        let result = simc_runner::run_simc_staged(
            &simc,
            &job_id,
            &simc_input,
            &options,
            combo_count,
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
        )
        .await;

        // Close channel and wait for all queued writes to finish
        drop(tx);
        if let Err(e) = writer_handle.await {
            eprintln!("[{}] Job update writer task failed: {}", job_id, e);
        }

        // Terminal writes — after all progress is flushed
        match result {
            Ok(output) => {
                let job_snap = repo.get(&job_id).await.ok().flatten();
                let meta: Option<HashMap<String, Vec<Value>>> = job_snap
                    .as_ref()
                    .and_then(|j| j.combo_metadata_json.as_ref())
                    .and_then(|s| serde_json::from_str::<Value>(s).ok())
                    .and_then(|v| v.get("_combo_metadata").cloned())
                    .and_then(|v| serde_json::from_value(v).ok());

                let mut parsed = result_parser::parse_top_gear_result(&output.json, meta.as_ref());
                inject_realm(&mut parsed, &simc_input);
                let result_str = serde_json::to_string(&parsed).unwrap_or_default();
                let raw_str = serde_json::to_string(&output.json).ok();
                if let Err(e) = repo.set_result(&job_id, &result_str, raw_str.as_deref()).await {
                    eprintln!("[{}] Failed to set result: {}", job_id, e);
                }
                if let Err(e) = repo.set_report_files(&job_id, output.html_report.as_deref(), output.text_output.as_deref()).await {
                    eprintln!("[{}] Failed to set report files: {}", job_id, e);
                }
            }
            Err(e) => {
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
