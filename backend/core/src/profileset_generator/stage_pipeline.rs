use serde_json::{json, Value};
use sqlx::{AnyPool, Row};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use super::checkpoint::{
    Checkpoint, CheckpointPhase, CheckpointSource, LocalStageCheckpoint,
};
use super::iterator::{ProfilesetCandidate, ProfilesetIterator, ProfilesetIteratorConfig};
use super::survivor_policy::{
    mean_error_from_result, prune_global, CandidateResult, PruneOutcome, PruneStats, SurvivorPolicy,
};
use crate::db::{
    ComboDedupRepo, ComboMetadataInsert, ComboMetadataRepo, ComboMetadataRow, StageBatchesRepo,
    StageResultInsert, StageResultRow, StageResultsRepo,
};
use crate::log_buffer::LogBuffer;
use crate::models::SimcInputMode;
use crate::simc_runner::{self, SimcOutput};

pub const FINAL_SINGLE_RUN_CEILING: usize = 500;

#[derive(Debug, Clone)]
pub struct StagePipelinePlan {
    pub stages: Vec<StagePlan>,
    pub final_single_run_ceiling: usize,
}

#[derive(Debug, Clone)]
pub struct StagePlan {
    pub index: usize,
    pub name: String,
    pub target_error: f64,
    pub kind: StageKind,
    pub source: CandidateSource,
    pub batch_policy: BatchPolicy,
    pub survivor_policy: SurvivorPolicy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StageKind {
    Pruning,
    Final,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CandidateSource {
    GeneratedCombinations,
    PreviousStageSurvivors,
}

#[derive(Debug, Clone)]
pub struct BatchPolicy {
    pub max_profilesets: usize,
    pub probe_size: usize,
}

pub struct StagePipelineInputs<'a> {
    pub pool: &'a AnyPool,
    pub job_id: &'a str,
    pub simc_bin: &'a Path,
    pub fight_style: &'a str,
    pub options: &'a Value,
    pub base_profile: &'a str,
    pub log_buffer: Arc<LogBuffer>,
    pub simc_input_mode: SimcInputMode,
    pub on_progress: Box<dyn Fn(u8, String) + Send + Sync + 'a>,
    pub on_stage_complete: Box<dyn Fn(String) + Send + Sync + 'a>,
}

pub enum StagePipelineOutcome {
    Completed(StagePipelineCompleted),
    Paused,
}

pub struct StagePipelineCompleted {
    pub output: SimcOutput,
    pub final_combo_ids: Vec<i64>,
    pub stage_summaries: Vec<StageSummary>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StageSummary {
    pub stage_name: String,
    pub target_error: f64,
    pub input_count: usize,
    pub batch_count: usize,
    pub local_survivor_count: usize,
    pub global_window_survivor_count: usize,
    pub baseline_forced_keep_count: usize,
    pub min_keep_added_count: usize,
    pub global_target_truncated_count: usize,
    pub hard_max_truncated_count: usize,
    pub output_count: usize,
    pub seconds: f64,
}

#[derive(Debug, Clone)]
struct NamedCandidate {
    candidate: ProfilesetCandidate,
    combo_id: i64,
    combo_name: String,
}

/// Result of building one batch's pre-SimC critical section.
enum PreSimcOutcome {
    /// Iterator/chunks exhausted — no ledger row was written (Invariant 8).
    Exhausted,
    /// A committed batch ready to run through SimC.
    Batch(PreparedBatch),
}

struct PreparedBatch {
    batch_idx: usize,
    candidates: Vec<NamedCandidate>,
}

/// Result of running one prepared batch through SimC + persistence.
enum BatchOutcome {
    Completed,
    Paused,
}

/// Build a stage's summary from DB-derived totals (Invariant 9) plus the
/// global-prune stats. `seconds` is filled by the caller.
fn stage_summary_from_db(
    stage: &StagePlan,
    totals: &crate::db::StageTotals,
    global: &super::survivor_policy::PruneOutcome,
) -> StageSummary {
    StageSummary {
        stage_name: stage.name.clone(),
        target_error: stage.target_error,
        input_count: totals.accepted_total as usize,
        batch_count: totals.batch_count as usize,
        local_survivor_count: totals.local_survivor_total as usize,
        global_window_survivor_count: global.stats.window_survivor_count,
        baseline_forced_keep_count: global.stats.baseline_forced_keep_count,
        min_keep_added_count: global.stats.min_keep_added_count,
        global_target_truncated_count: global.stats.global_target_truncated_count,
        hard_max_truncated_count: global.stats.hard_max_truncated_count,
        output_count: global.stats.output_count,
        seconds: 0.0,
    }
}

pub fn default_local_topgear_plan(options: &Value) -> StagePipelinePlan {
    let user_target_error = options
        .get("target_error")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.05);
    let schedule = stage_schedule_from_options(options, user_target_error);
    let mut stages = Vec::new();
    for (idx, (name, target_error)) in schedule.iter().enumerate() {
        let is_final = idx == schedule.len() - 1;
        let source = if idx == 0 {
            CandidateSource::GeneratedCombinations
        } else {
            CandidateSource::PreviousStageSurvivors
        };
        // Pruning stages keep a generous working window; the last pruning stage
        // is capped to the final single-run ceiling by `clamp_last_pruning_hard_max`
        // in `run_stage_pipeline`, so it needs no special case here.
        let survivor_cap = if is_final {
            FINAL_SINGLE_RUN_CEILING
        } else {
            150_000
        };
        stages.push(StagePlan {
            index: idx,
            name: name.clone(),
            target_error: *target_error,
            kind: if is_final {
                StageKind::Final
            } else {
                StageKind::Pruning
            },
            source,
            batch_policy: BatchPolicy {
                max_profilesets: if idx == 0 { 250 } else { 500 },
                probe_size: 100,
            },
            survivor_policy: SurvivorPolicy {
                confidence_z: if idx == 0 { 2.58 } else { 1.96 },
                min_keep: if idx == 0 { 100 } else { 20 },
                global_target: survivor_cap,
                hard_max: survivor_cap,
                always_keep_baseline: true,
                local_prefilter: true,
                global_prune_after_stage: true,
            },
        });
    }
    StagePipelinePlan {
        stages,
        final_single_run_ceiling: FINAL_SINGLE_RUN_CEILING,
    }
}

fn stage_schedule_from_options(options: &Value, user_target_error: f64) -> Vec<(String, f64)> {
    let raw = options.get("stage_schedule");
    let mut out = if let Some(arr) = raw.and_then(|v| v.as_array()) {
        simc_runner::parse_stage_schedule_array(arr, user_target_error)
    } else {
        match raw.and_then(|v| v.as_str()) {
            Some("confidence-1.0-0.2") => {
                vec![("Broad".to_string(), 1.0), ("Refine".to_string(), 0.2)]
            }
            Some("confidence-1.0-0.5") => {
                vec![("Broad".to_string(), 1.0), ("Refine".to_string(), 0.5)]
            }
            Some("confidence-2.0-0.2") => {
                vec![("Triage".to_string(), 2.0), ("Refine".to_string(), 0.2)]
            }
            // "confidence-2.0-0.5" and the default both use this bracket.
            _ => vec![("Triage".to_string(), 2.0), ("Refine".to_string(), 0.5)],
        }
    };
    out.push(("Final".to_string(), user_target_error));
    out
}

fn clamp_last_pruning_hard_max(stages: &mut [StagePlan], final_ceiling: usize) {
    if let Some(stage) = stages
        .iter_mut()
        .rev()
        .find(|stage| stage.kind == StageKind::Pruning)
    {
        stage.survivor_policy.hard_max = stage.survivor_policy.hard_max.min(final_ceiling);
        stage.survivor_policy.global_target =
            stage.survivor_policy.global_target.min(final_ceiling);
    }
}

fn generated_stage_count(stages: &[StagePlan]) -> usize {
    stages
        .iter()
        .filter(|s| s.source == CandidateSource::GeneratedCombinations)
        .count()
}

/// Mid-stage resume state seeded into `run_stage_pipeline`.
pub struct StagePipelineResume {
    pub start_stage_idx: usize,
    pub start_batch_idx: usize,
    pub input_survivor_ids: Vec<i64>,
    pub iterator_cursor: Option<Vec<usize>>,
    pub next_combo_id: i64,
}

pub async fn run_stage_pipeline(
    iter_cfg: ProfilesetIteratorConfig,
    inputs: StagePipelineInputs<'_>,
    mut plan: StagePipelinePlan,
    resume: Option<StagePipelineResume>,
) -> Result<StagePipelineOutcome, String> {
    clamp_last_pruning_hard_max(&mut plan.stages, plan.final_single_run_ceiling);
    let generated_stages = generated_stage_count(&plan.stages);
    if generated_stages > 1 {
        return Err(format!(
            "Stage plan has {generated_stages} generated stages; only one is supported \
             (combo_dedup is keyed by batch_idx within the single generated stage)"
        ));
    }
    let metadata_repo = ComboMetadataRepo::new(inputs.pool.clone());
    let stage_results_repo = StageResultsRepo::new(inputs.pool.clone());
    let mut summaries = Vec::new();
    let mut next_combo_id = 1i64;
    let mut current_survivor_ids: Vec<i64> = Vec::new();
    let mut generated_iter = Some(ProfilesetIterator::new(iter_cfg));
    let mut start_stage_idx = 0usize;
    let mut start_batch_idx = 0usize;
    if let Some(r) = resume {
        next_combo_id = r.next_combo_id;
        current_survivor_ids = r.input_survivor_ids;
        start_stage_idx = r.start_stage_idx;
        start_batch_idx = r.start_batch_idx;
        if let (Some(cursor), Some(iter)) = (r.iterator_cursor, generated_iter.as_mut()) {
            if !iter.seek(cursor) {
                return Err(
                    "Resume cursor seek failed — request_json may not match the checkpoint"
                        .to_string(),
                );
            }
        }
    }
    let total_stages = plan.stages.len().max(1);

    for stage in &plan.stages {
        if stage.index < start_stage_idx {
            continue;
        }
        let stage_start_batch = if stage.index == start_stage_idx {
            start_batch_idx
        } else {
            0
        };
        let stage_start = Instant::now();
        let stage_progress_start =
            ((stage.index as f64 / total_stages as f64) * 100.0).min(100.0) as u8;
        let stage_progress_end =
            (((stage.index + 1) as f64 / total_stages as f64) * 100.0).min(100.0) as u8;
        (inputs.on_progress)(
            stage_progress_start,
            format!(
                "Stage {} of {}: {}",
                stage.index + 1,
                total_stages,
                stage.name
            ),
        );
        match stage.kind {
            StageKind::Pruning => {
                let outcome = run_pruning_stage(
                    &inputs,
                    &metadata_repo,
                    &stage_results_repo,
                    stage,
                    generated_iter.as_mut(),
                    &current_survivor_ids,
                    &mut next_combo_id,
                    stage_start_batch,
                    stage_progress_start,
                    stage_progress_end,
                )
                .await?;
                if outcome.paused {
                    return Ok(StagePipelineOutcome::Paused);
                }
                current_survivor_ids = outcome.survivor_combo_ids;
                if let Some(mut summary) = outcome.summary {
                    summary.seconds = stage_start.elapsed().as_secs_f64();
                    summaries.push(summary);
                }
                (inputs.on_stage_complete)(format!(
                    "{} - {} survivors",
                    stage.name,
                    current_survivor_ids.len()
                ));
            }
            StageKind::Final => {
                if current_survivor_ids.len() > plan.final_single_run_ceiling {
                    return Err(format!(
                        "Final stage has {} survivors, above safe single-run ceiling {}",
                        current_survivor_ids.len(),
                        plan.final_single_run_ceiling
                    ));
                }
                match run_final_stage(
                    &inputs,
                    &metadata_repo,
                    &stage_results_repo,
                    stage,
                    &current_survivor_ids,
                    stage_progress_start,
                    stage_progress_end,
                )
                .await?
                {
                    None => return Ok(StagePipelineOutcome::Paused),
                    Some(output) => {
                        return Ok(StagePipelineOutcome::Completed(StagePipelineCompleted {
                            output,
                            final_combo_ids: current_survivor_ids,
                            stage_summaries: summaries,
                        }));
                    }
                }
            }
        }
    }

    Err("Stage pipeline did not include a Final stage".to_string())
}

struct PruningStageOutcome {
    survivor_combo_ids: Vec<i64>,
    summary: Option<StageSummary>,
    paused: bool,
}

#[allow(clippy::too_many_arguments)]
async fn pre_simc_generated(
    inputs: &StagePipelineInputs<'_>,
    stage: &StagePlan,
    iter: &mut ProfilesetIterator,
    batch_idx: usize,
    next_combo_id: &mut i64,
    input_survivor_ids: &[i64],
) -> Result<PreSimcOutcome, String> {
    let target = if batch_idx == 0 {
        stage.batch_policy.probe_size
    } else {
        stage.batch_policy.max_profilesets
    };
    let start_cursor = iter.cursor().to_vec();
    let mut pending = Vec::with_capacity(target);
    for _ in 0..target {
        match iter.next() {
            Some(c) => pending.push(c),
            None => break,
        }
    }
    if pending.is_empty() {
        return Ok(PreSimcOutcome::Exhausted); // Invariant 8: no ledger row
    }
    let end_cursor = iter.cursor().to_vec();
    let keys: Vec<String> = pending.iter().map(|c| c.identity_key.clone()).collect();

    let dedup_repo = ComboDedupRepo::new(inputs.pool.clone());
    let stage_batches_repo = StageBatchesRepo::new(inputs.pool.clone());
    let mut tx = inputs
        .pool
        .begin()
        .await
        .map_err(|e| format!("Pre-simc transaction failed: {e}"))?;

    let existing = dedup_repo
        .snapshot_existing(&mut tx, inputs.job_id, &keys)
        .await
        .map_err(|e| format!("Dedup snapshot failed: {e}"))?;
    dedup_repo
        .insert_chunked(&mut tx, inputs.job_id, batch_idx as i64, &keys)
        .await
        .map_err(|e| format!("Dedup insert failed: {e}"))?;

    let mut accepted = Vec::new();
    let mut local_next = *next_combo_id;
    for candidate in pending {
        if existing.contains(&candidate.identity_key) {
            continue;
        }
        let combo_id = local_next;
        local_next += 1;
        let combo_name = format!("Combo {combo_id}");
        accepted.push(NamedCandidate {
            candidate: rename_profileset_candidate(candidate, &combo_name),
            combo_id,
            combo_name,
        });
    }

    let start_cursor_json = serde_json::to_string(&start_cursor).unwrap_or_default();
    let end_cursor_json = serde_json::to_string(&end_cursor).unwrap_or_default();
    stage_batches_repo
        .insert_committed(
            &mut tx,
            inputs.job_id,
            stage.index as i64,
            batch_idx as i64,
            "generated",
            Some(&start_cursor_json),
            Some(&end_cursor_json),
            keys.len() as i64,
            accepted.len() as i64,
        )
        .await
        .map_err(|e| format!("Failed to insert stage batch: {e}"))?;

    // Advanced checkpoint (Invariant 3): points at the NEXT batch.
    write_stage_checkpoint_in_tx(
        &mut tx,
        inputs.job_id,
        stage,
        batch_idx + 1,
        Some(end_cursor.clone()),
        input_survivor_ids,
        local_next,
    )
    .await?;

    tx.commit()
        .await
        .map_err(|e| format!("Pre-simc commit failed: {e}"))?;
    *next_combo_id = local_next;

    inputs.log_buffer.push_line(
        inputs.job_id,
        format!(
            "{} generated batch {} cursor {:?}->{:?} ({} accepted)",
            stage.name,
            batch_idx,
            start_cursor,
            end_cursor,
            accepted.len()
        ),
    );
    Ok(PreSimcOutcome::Batch(PreparedBatch {
        batch_idx,
        candidates: accepted,
    }))
}

async fn pre_simc_survivor(
    inputs: &StagePipelineInputs<'_>,
    stage: &StagePlan,
    metadata_repo: &ComboMetadataRepo,
    input_survivor_ids: &[i64],
    batch_idx: usize,
    next_combo_id: i64,
) -> Result<PreSimcOutcome, String> {
    let chunk_size = stage.batch_policy.max_profilesets.max(1);
    let start = batch_idx * chunk_size;
    if start >= input_survivor_ids.len() {
        return Ok(PreSimcOutcome::Exhausted); // Invariant 8
    }
    let end = (start + chunk_size).min(input_survivor_ids.len());
    let chunk_ids = &input_survivor_ids[start..end];
    let rows = metadata_repo
        .list_for_combo_ids(inputs.job_id, chunk_ids)
        .await
        .map_err(|e| format!("Failed to load survivors: {e}"))?;
    if rows.is_empty() {
        return Ok(PreSimcOutcome::Exhausted);
    }
    let candidates: Vec<NamedCandidate> = rows.iter().map(named_from_metadata).collect();

    let stage_batches_repo = StageBatchesRepo::new(inputs.pool.clone());
    let mut tx = inputs
        .pool
        .begin()
        .await
        .map_err(|e| format!("Pre-simc transaction failed: {e}"))?;
    stage_batches_repo
        .insert_committed(
            &mut tx,
            inputs.job_id,
            stage.index as i64,
            batch_idx as i64,
            "previous_survivors",
            None,
            None,
            candidates.len() as i64,
            candidates.len() as i64,
        )
        .await
        .map_err(|e| format!("Failed to insert stage batch: {e}"))?;
    write_stage_checkpoint_in_tx(
        &mut tx,
        inputs.job_id,
        stage,
        batch_idx + 1,
        None,
        input_survivor_ids,
        next_combo_id,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|e| format!("Pre-simc commit failed: {e}"))?;

    Ok(PreSimcOutcome::Batch(PreparedBatch {
        batch_idx,
        candidates,
    }))
}

#[allow(clippy::too_many_arguments)]
async fn process_batch(
    inputs: &StagePipelineInputs<'_>,
    metadata_repo: &ComboMetadataRepo,
    stage_results_repo: &StageResultsRepo,
    stage: &StagePlan,
    batch: &PreparedBatch,
    total_batches_hint: usize,
    stage_progress_start: u8,
    stage_progress_end: u8,
) -> Result<BatchOutcome, String> {
    let batch_idx = batch.batch_idx;
    let profileset_simc = batch
        .candidates
        .iter()
        .map(|c| c.candidate.profileset_simc.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let total_hint = total_batches_hint.max(batch_idx + 1);
    (inputs.on_progress)(
        progress_between(
            stage_progress_start,
            stage_progress_end,
            batch_idx as f64 / total_hint as f64,
        ),
        format!(
            "{} batch {}: simc on {} profilesets",
            stage.name,
            batch_idx + 1,
            batch.candidates.len()
        ),
    );

    let progress_buckets = std::sync::atomic::AtomicUsize::new(0);
    let results = match simc_runner::run_simc_triage_batch(
        inputs.base_profile,
        &profileset_simc,
        inputs.options,
        stage_iterations(inputs.options),
        inputs.fight_style,
        stage.target_error,
        inputs.simc_bin,
        inputs.job_id,
        inputs.log_buffer.clone(),
        |current, total| {
            let bucket = (current.saturating_mul(20) / total.max(1)).min(20);
            let prev = progress_buckets.fetch_max(bucket, std::sync::atomic::Ordering::Relaxed);
            if bucket <= prev {
                return;
            }
            let stage_fraction =
                (batch_idx as f64 + current as f64 / total.max(1) as f64) / total_hint as f64;
            (inputs.on_progress)(
                progress_between(stage_progress_start, stage_progress_end, stage_fraction),
                format!(
                    "{} batch {}: {}/{} profilesets",
                    stage.name,
                    batch_idx + 1,
                    current,
                    total
                ),
            );
        },
    )
    .await
    {
        Ok(results) => results,
        Err(e) => {
            if check_pause(inputs.pool, inputs.job_id).await? {
                mark_paused(inputs.pool, inputs.job_id).await;
                return Ok(BatchOutcome::Paused);
            }
            return Err(e);
        }
    };

    let parsed = candidate_results_from_simc(&results, &batch.candidates);
    let local = if stage.survivor_policy.local_prefilter {
        prune_global(&parsed, &stage.survivor_policy).survivors
    } else {
        parsed
    };

    // Post-SimC tx (Invariant 2): results + combo_metadata + mark_completed atomic.
    persist_and_complete_batch(
        inputs.pool,
        metadata_repo,
        stage_results_repo,
        inputs.job_id,
        stage.index,
        batch_idx,
        &local,
        &batch.candidates,
        stage.index > 0,
    )
    .await?;

    if check_pause(inputs.pool, inputs.job_id).await? {
        mark_paused(inputs.pool, inputs.job_id).await;
        return Ok(BatchOutcome::Paused);
    }
    Ok(BatchOutcome::Completed)
}

async fn mark_paused(pool: &AnyPool, job_id: &str) {
    let repo = crate::db::JobRepo::new(pool.clone());
    let _ = repo.set_pause_requested(job_id, false).await;
    let _ = repo
        .update_status(job_id, crate::models::JobStatus::Paused)
        .await;
}

#[allow(clippy::too_many_arguments)]
async fn run_pruning_stage(
    inputs: &StagePipelineInputs<'_>,
    metadata_repo: &ComboMetadataRepo,
    stage_results_repo: &StageResultsRepo,
    stage: &StagePlan,
    mut generated_iter: Option<&mut ProfilesetIterator>,
    input_survivor_ids: &[i64],
    next_combo_id: &mut i64,
    start_batch_idx: usize,
    stage_progress_start: u8,
    stage_progress_end: u8,
) -> Result<PruningStageOutcome, String> {
    // Stage-entry checkpoint (clean-boundary resume target for this stage).
    if start_batch_idx == 0 {
        write_stage_entry_checkpoint(
            inputs.pool,
            inputs.job_id,
            stage,
            input_survivor_ids,
            *next_combo_id,
        )
        .await?;
    }

    let total_hint = match stage.source {
        CandidateSource::PreviousStageSurvivors => {
            (input_survivor_ids.len() / stage.batch_policy.max_profilesets.max(1)) + 1
        }
        CandidateSource::GeneratedCombinations => 1,
    };

    let mut batch_idx = start_batch_idx;
    loop {
        let pre = match stage.source {
            CandidateSource::GeneratedCombinations => {
                let iter = generated_iter
                    .as_deref_mut()
                    .ok_or_else(|| "Generated stage missing iterator".to_string())?;
                pre_simc_generated(
                    inputs,
                    stage,
                    iter,
                    batch_idx,
                    next_combo_id,
                    input_survivor_ids,
                )
                .await?
            }
            CandidateSource::PreviousStageSurvivors => {
                pre_simc_survivor(
                    inputs,
                    stage,
                    metadata_repo,
                    input_survivor_ids,
                    batch_idx,
                    *next_combo_id,
                )
                .await?
            }
        };
        let prepared = match pre {
            PreSimcOutcome::Exhausted => break,
            PreSimcOutcome::Batch(b) => b,
        };
        match process_batch(
            inputs,
            metadata_repo,
            stage_results_repo,
            stage,
            &prepared,
            total_hint,
            stage_progress_start,
            stage_progress_end,
        )
        .await?
        {
            BatchOutcome::Completed => {}
            BatchOutcome::Paused => {
                return Ok(PruningStageOutcome {
                    survivor_combo_ids: Vec::new(),
                    paused: true,
                    summary: None,
                });
            }
        }
        batch_idx += 1;
        tokio::task::yield_now().await;
    }

    // Global prune over ALL persisted results for this stage (DB-backed).
    let global_input = stage_results_repo
        .list_for_stage(inputs.job_id, stage.index as i64)
        .await
        .map_err(|e| format!("Failed to load stage results: {e}"))?
        .into_iter()
        .map(candidate_from_stage_row)
        .collect::<Vec<_>>();
    let global = if stage.survivor_policy.global_prune_after_stage {
        prune_global(&global_input, &stage.survivor_policy)
    } else {
        let stats = PruneStats {
            input_count: global_input.len(),
            window_survivor_count: global_input.len(),
            output_count: global_input.len(),
            ..PruneStats::default()
        };
        PruneOutcome {
            survivors: global_input,
            stats,
        }
    };
    let survivor_combo_ids = global
        .survivors
        .iter()
        .map(|r| r.combo_id)
        .collect::<Vec<_>>();
    let totals = StageBatchesRepo::new(inputs.pool.clone())
        .stage_totals(inputs.job_id, stage.index as i64)
        .await
        .map_err(|e| format!("Failed to load stage totals: {e}"))?;

    Ok(PruningStageOutcome {
        survivor_combo_ids,
        summary: Some(stage_summary_from_db(stage, &totals, &global)),
        paused: false,
    })
}

fn rename_profileset_candidate(
    mut candidate: ProfilesetCandidate,
    combo_name: &str,
) -> ProfilesetCandidate {
    if candidate.profileset_name == combo_name {
        return candidate;
    }
    let old = format!("profileset.\"{}\"", candidate.profileset_name);
    let new = format!("profileset.\"{}\"", combo_name);
    candidate.profileset_simc = candidate.profileset_simc.replace(&old, &new);
    candidate.profileset_name = combo_name.to_string();
    candidate
}

fn named_from_metadata(row: &ComboMetadataRow) -> NamedCandidate {
    NamedCandidate {
        candidate: ProfilesetCandidate {
            cursor_at_emission: serde_json::from_str(&row.cursor_json).unwrap_or_default(),
            profileset_name: row.combo_name.clone(),
            profileset_simc: row.profileset_simc.clone(),
            metadata: serde_json::from_str(&row.metadata_json).unwrap_or(Value::Null),
            identity_key: row.combo_key.clone(),
        },
        combo_id: row.combo_id,
        combo_name: row.combo_name.clone(),
    }
}

fn candidate_results_from_simc(results: &[Value], batch: &[NamedCandidate]) -> Vec<CandidateResult> {
    let by_name: HashMap<&str, &NamedCandidate> =
        batch.iter().map(|c| (c.combo_name.as_str(), c)).collect();
    results
        .iter()
        .filter_map(|row| {
            let name = row.get("name").and_then(|v| v.as_str())?;
            let named = by_name.get(name)?;
            let mean = row.get("mean").and_then(|v| v.as_f64())?;
            let mean_error = mean_error_from_result(row).unwrap_or(0.0);
            Some(CandidateResult {
                combo_id: named.combo_id,
                combo_name: named.combo_name.clone(),
                combo_key: named.candidate.identity_key.clone(),
                mean,
                mean_error,
                is_baseline: name.starts_with("Currently Equipped"),
                result_json: Some(row.clone()),
            })
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
async fn persist_and_complete_batch(
    pool: &AnyPool,
    metadata_repo: &ComboMetadataRepo,
    stage_results_repo: &StageResultsRepo,
    job_id: &str,
    stage_idx: usize,
    batch_idx: usize,
    results: &[CandidateResult],
    batch: &[NamedCandidate],
    persist_json: bool,
) -> Result<(), String> {
    let result_ids: HashSet<i64> = results.iter().map(|r| r.combo_id).collect();
    let owned_metadata: Vec<(i64, String, String, String, String, String)> = batch
        .iter()
        .filter(|candidate| result_ids.contains(&candidate.combo_id))
        .map(|candidate| {
            let metadata_json =
                serde_json::to_string(&candidate.candidate.metadata).unwrap_or_else(|_| "null".into());
            let cursor_json = serde_json::to_string(&candidate.candidate.cursor_at_emission)
                .unwrap_or_else(|_| "[]".into());
            (
                candidate.combo_id,
                candidate.combo_name.clone(),
                candidate.candidate.identity_key.clone(),
                cursor_json,
                candidate.candidate.profileset_simc.clone(),
                metadata_json,
            )
        })
        .collect();
    let metadata_inserts: Vec<ComboMetadataInsert> = owned_metadata
        .iter()
        .map(|(id, name, key, cursor, simc, meta)| ComboMetadataInsert {
            combo_id: *id,
            combo_name: name,
            combo_key: key,
            batch_idx: Some(stage_idx as i64),
            cursor_json: cursor,
            profileset_simc: simc,
            metadata_json: meta,
        })
        .collect();

    let owned_json: Vec<Option<String>> = results
        .iter()
        .map(|result| {
            if persist_json {
                result
                    .result_json
                    .as_ref()
                    .and_then(|v| serde_json::to_string(v).ok())
            } else {
                None
            }
        })
        .collect();
    let result_inserts: Vec<StageResultInsert> = results
        .iter()
        .zip(owned_json.iter())
        .map(|(result, json)| StageResultInsert {
            stage_idx: stage_idx as i64,
            combo_id: result.combo_id,
            combo_name: &result.combo_name,
            combo_key: &result.combo_key,
            mean: result.mean,
            mean_error: result.mean_error,
            result_json: json.as_deref(),
        })
        .collect();

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Persist+complete tx failed: {e}"))?;
    metadata_repo
        .insert_batch(&mut tx, job_id, &metadata_inserts)
        .await
        .map_err(|e| format!("Persist combo metadata failed: {e}"))?;
    stage_results_repo
        .insert_batch(&mut tx, job_id, &result_inserts)
        .await
        .map_err(|e| format!("Persist stage results failed: {e}"))?;
    StageBatchesRepo::new(pool.clone())
        .mark_completed(
            &mut tx,
            job_id,
            stage_idx as i64,
            batch_idx as i64,
            results.len() as i64,
        )
        .await
        .map_err(|e| format!("Mark completed failed: {e}"))?;
    tx.commit()
        .await
        .map_err(|e| format!("Persist+complete commit failed: {e}"))?;
    Ok(())
}

async fn run_final_stage(
    inputs: &StagePipelineInputs<'_>,
    metadata_repo: &ComboMetadataRepo,
    stage_results_repo: &StageResultsRepo,
    stage: &StagePlan,
    survivor_ids: &[i64],
    stage_progress_start: u8,
    stage_progress_end: u8,
) -> Result<Option<SimcOutput>, String> {
    write_stage_entry_checkpoint(inputs.pool, inputs.job_id, stage, survivor_ids, 0).await?;
    let rows = metadata_repo
        .list_for_combo_ids(inputs.job_id, survivor_ids)
        .await
        .map_err(|e| format!("Failed to load final survivors: {e}"))?;
    let lines = rows
        .iter()
        .map(|r| r.profileset_simc.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let combined = format!("# Base Actor\n{}\n{}", inputs.base_profile, lines);
    let mut options = inputs.options.clone();
    options["target_error"] = json!(stage.target_error);
    let final_input = simc_runner::build_simc_input_from_options(&combined, &options);
    (inputs.on_progress)(
        stage_progress_start,
        format!("{}: simc on {} profilesets", stage.name, survivor_ids.len()),
    );
    inputs.log_buffer.push_line(
        inputs.job_id,
        format!("{}: simc on {} profilesets", stage.name, survivor_ids.len()),
    );
    let progress_buckets = std::sync::atomic::AtomicUsize::new(0);
    let mut output = match simc_runner::run_simc(
        inputs.simc_bin,
        inputs.job_id,
        &final_input,
        &options,
        |line| {
            if let Some((current, total)) = parse_profileset_progress(line) {
                let bucket = (current.saturating_mul(20) / total.max(1)).min(20);
                let prev = progress_buckets
                    .fetch_max(bucket, std::sync::atomic::Ordering::Relaxed);
                if bucket <= prev {
                    return;
                }
                let pct = progress_between(
                    stage_progress_start,
                    stage_progress_end,
                    current as f64 / total.max(1) as f64,
                );
                (inputs.on_progress)(
                    pct,
                    format!("{}: {}/{} profilesets", stage.name, current, total),
                );
                inputs.log_buffer.push_line(
                    inputs.job_id,
                    format!(
                        "{} progress: {}/{} profilesets ({}%)",
                        stage.name,
                        current,
                        total,
                        bucket * 5
                    ),
                );
            }
        },
        None,
    )
    .await
    {
        Ok(o) => o,
        Err(e) => {
            if check_pause(inputs.pool, inputs.job_id).await? {
                mark_paused(inputs.pool, inputs.job_id).await;
                return Ok(None);
            }
            return Err(e);
        }
    };
    let final_names = profileset_names_from_json(&output.json);
    output.json["simhammer"]["final_profileset_names"] =
        Value::Array(final_names.iter().cloned().map(Value::String).collect());
    merge_eliminated_latest(&mut output.json, stage_results_repo, inputs.job_id, &final_names).await?;
    Ok(Some(output))
}

fn progress_between(start: u8, end: u8, fraction: f64) -> u8 {
    let fraction = fraction.clamp(0.0, 1.0);
    let span = end.saturating_sub(start) as f64;
    start.saturating_add((span * fraction) as u8).min(100)
}

fn parse_profileset_progress(line: &str) -> Option<(usize, usize)> {
    let marker = "profilesets";
    if !line.contains(marker) {
        return None;
    }
    let slash = line.find('/')?;
    // Trailing run of digits immediately before the '/' (e.g. "... 12/345").
    let current = line[..slash]
        .rsplit(|c: char| !c.is_ascii_digit())
        .next()
        .unwrap_or("")
        .parse()
        .ok()?;
    let total = line[slash + 1..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .ok()?;
    Some((current, total))
}

async fn merge_eliminated_latest(
    json: &mut Value,
    stage_results_repo: &StageResultsRepo,
    job_id: &str,
    final_names: &HashSet<String>,
) -> Result<(), String> {
    let latest = stage_results_repo
        .latest_for_job(job_id)
        .await
        .map_err(|e| format!("Failed to load eliminated stage results: {e}"))?;
    let Some(arr) = json
        .pointer_mut("/sim/profilesets/results")
        .and_then(|v| v.as_array_mut())
    else {
        return Ok(());
    };
    for row in latest {
        if final_names.contains(&row.combo_name) {
            continue;
        }
        if let Some(raw) = row
            .result_json
            .as_ref()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
        {
            arr.push(raw);
        } else {
            arr.push(json!({
                "name": row.combo_name,
                "mean": row.mean,
                "mean_error": row.mean_error,
            }));
        }
    }
    Ok(())
}

fn profileset_names_from_json(json: &Value) -> HashSet<String> {
    simc_runner::profileset_result_names(json).into_iter().collect()
}

fn candidate_from_stage_row(row: StageResultRow) -> CandidateResult {
    CandidateResult {
        combo_id: row.combo_id,
        combo_name: row.combo_name,
        combo_key: row.combo_key,
        mean: row.mean,
        mean_error: row.mean_error,
        is_baseline: false,
        result_json: row
            .result_json
            .and_then(|s| serde_json::from_str::<Value>(&s).ok()),
    }
}

#[allow(clippy::too_many_arguments)]
async fn write_stage_checkpoint_in_tx(
    tx: &mut sqlx::AnyConnection,
    job_id: &str,
    stage: &StagePlan,
    next_batch_idx: usize,
    generated_cursor: Option<Vec<usize>>,
    survivor_combo_ids: &[i64],
    next_combo_id: i64,
) -> Result<(), String> {
    let checkpoint = Checkpoint {
        phase: CheckpointPhase::LocalStage(LocalStageCheckpoint {
            stage_idx: stage.index,
            stage_name: stage.name.clone(),
            next_batch_idx,
            source: match stage.source {
                CandidateSource::GeneratedCombinations => CheckpointSource::GeneratedCombinations,
                CandidateSource::PreviousStageSurvivors => CheckpointSource::PreviousStageSurvivors,
            },
            survivor_combo_ids: survivor_combo_ids.to_vec(),
            generated_cursor,
            next_combo_id,
        }),
        constants: crate::profileset_generator::triage::TriageConstants::default(),
    };
    let json = checkpoint
        .to_json_string()
        .map_err(|e| format!("Failed to serialize stage checkpoint: {e}"))?;
    sqlx::query("UPDATE jobs SET checkpoint = $1 WHERE id = $2")
        .bind(json)
        .bind(job_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to write stage checkpoint: {e}"))?;
    Ok(())
}

/// Stand-alone checkpoint write (own tx) for stage-entry boundaries.
async fn write_stage_entry_checkpoint(
    pool: &AnyPool,
    job_id: &str,
    stage: &StagePlan,
    survivor_combo_ids: &[i64],
    next_combo_id: i64,
) -> Result<(), String> {
    let generated_cursor = match stage.source {
        CandidateSource::GeneratedCombinations => Some(Vec::new()),
        CandidateSource::PreviousStageSurvivors => None,
    };
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Stage-entry checkpoint tx failed: {e}"))?;
    write_stage_checkpoint_in_tx(
        &mut tx,
        job_id,
        stage,
        0,
        generated_cursor,
        survivor_combo_ids,
        next_combo_id,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|e| format!("Stage-entry checkpoint commit failed: {e}"))
}

async fn check_pause(pool: &AnyPool, job_id: &str) -> Result<bool, String> {
    let row = sqlx::query("SELECT pause_requested FROM jobs WHERE id = $1")
        .bind(job_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to check pause flag: {e}"))?;
    Ok(row
        .map(|r| {
            r.try_get::<i64, _>("pause_requested")
                .map(|v| v != 0)
                .unwrap_or(false)
        })
        .unwrap_or(false))
}

fn stage_iterations(options: &Value) -> u32 {
    options
        .get("iterations")
        .and_then(|v| v.as_u64())
        .unwrap_or(10_000) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_pruning_hard_max_is_clamped_to_final_ceiling() {
        let mut stages = vec![
            StagePlan {
                index: 0,
                name: "Broad".to_string(),
                target_error: 2.0,
                kind: StageKind::Pruning,
                source: CandidateSource::GeneratedCombinations,
                batch_policy: BatchPolicy {
                    max_profilesets: 1,
                    probe_size: 1,
                },
                survivor_policy: SurvivorPolicy {
                    hard_max: 10_000,
                    global_target: 10_000,
                    ..SurvivorPolicy::default()
                },
            },
            StagePlan {
                index: 1,
                name: "Final".to_string(),
                target_error: 0.05,
                kind: StageKind::Final,
                source: CandidateSource::PreviousStageSurvivors,
                batch_policy: BatchPolicy {
                    max_profilesets: 1,
                    probe_size: 1,
                },
                survivor_policy: SurvivorPolicy::default(),
            },
        ];
        clamp_last_pruning_hard_max(&mut stages, 500);
        assert_eq!(stages[0].survivor_policy.hard_max, 500);
        assert_eq!(stages[0].survivor_policy.global_target, 500);
    }

    fn mk_stage(index: usize, source: CandidateSource) -> StagePlan {
        StagePlan {
            index,
            name: format!("S{index}"),
            target_error: 1.0,
            kind: StageKind::Pruning,
            source,
            batch_policy: BatchPolicy {
                max_profilesets: 1,
                probe_size: 1,
            },
            survivor_policy: SurvivorPolicy::default(),
        }
    }

    #[test]
    fn generated_stage_count_counts_generated_sources() {
        let stages = vec![
            mk_stage(0, CandidateSource::GeneratedCombinations),
            mk_stage(1, CandidateSource::GeneratedCombinations),
            mk_stage(2, CandidateSource::PreviousStageSurvivors),
        ];
        assert_eq!(generated_stage_count(&stages), 2);
        let single = vec![
            mk_stage(0, CandidateSource::GeneratedCombinations),
            mk_stage(1, CandidateSource::PreviousStageSurvivors),
        ];
        assert_eq!(generated_stage_count(&single), 1);
    }
}
