//! Streaming Triage stage. Pulls candidates from a ProfilesetIterator in
//! adaptive batches, runs cheap simc on each batch, and keeps survivors
//! via a statistical CI-window retention with a global survivor budget.
//! See spec Â§2 (transaction lifecycle) and Â§3 (Triage stage) for design.

use std::collections::HashSet;
use serde_json::Value;
use sqlx::AnyPool;

use crate::db::{
    ComboDedupRepo, ComboMetadataInsert, ComboMetadataRepo, TriageBatchesRepo,
};
use super::iterator::{ProfilesetCandidate, ProfilesetIterator, ProfilesetIteratorConfig};
use crate::profileset_generator::checkpoint::{Checkpoint, CheckpointPhase, TriageCheckpoint, StagedCheckpoint};

// Defaults locked from calibration (Task 28). Treat as initial values.
// Batch size targets keep individual batches small enough that a pause mid-Triage
// only loses a small unit of work on replay (spec Â§5 pause/resume). At ~1.4KB per
// profileset, 1.5 MiB â‰ˆ 1100 profilesets per batch.
pub const TARGET_BATCH_INPUT_BYTES: usize = 1_572_864; // 1.5 MiB
pub const MIN_BATCH_PROFILESETS: usize = 500;
pub const MAX_BATCH_PROFILESETS: usize = 5_000;
pub const TRIAGE_ITERATIONS: u32 = 50;
pub const TRIAGE_CUTOFF_MULTIPLIER: f64 = 3.0;
pub const MIN_TRIAGE_TARGET_ERROR_FALLBACK: f64 = 1.0;
pub const MIN_KEEP_PER_BATCH: usize = 100;
pub const GLOBAL_SURVIVOR_TARGET: usize = 150_000;
pub const GLOBAL_SURVIVOR_HARD_MAX: usize = 500_000;
pub const TRIAGE_THRESHOLD: u64 = 500;
pub const PROBE_SIZE: usize = 100;

/// State carried across batches in a single Triage run.
pub struct TriageState {
    pub next_combo_id: i64,
    pub next_batch_idx: i64,
    pub survivors_so_far: usize,
    pub avg_bytes_per_profileset: usize,
    pub estimated_total_batches: usize,
}

impl Default for TriageState {
    fn default() -> Self {
        Self {
            next_combo_id: 1,
            next_batch_idx: 0,
            survivors_so_far: 0,
            avg_bytes_per_profileset: 0,
            estimated_total_batches: 1,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AcceptedCandidate {
    pub candidate: ProfilesetCandidate,
    pub combo_id: i64,
    pub combo_name: String,
}

pub struct PreSimcResult {
    pub accepted: Vec<AcceptedCandidate>,
    pub batch_idx: i64,
    pub start_cursor_json: String,
    pub end_cursor_json: String,
    pub candidate_count: usize,
    pub iterator_exhausted: bool,
}

pub struct BatchDriver<'a> {
    pub pool: &'a AnyPool,
    pub dedup_repo: &'a ComboDedupRepo,
    pub triage_repo: &'a TriageBatchesRepo,
    pub metadata_repo: &'a ComboMetadataRepo,
    pub job_id: &'a str,
}

/// Write the Checkpoint JSON blob to jobs.checkpoint inside the caller's
/// transaction. Used by pre_simc_phase so the batch_idx + cursor + survivor
/// counts land atomically with the dedup INSERTs and triage_batches row.
async fn write_checkpoint_in_tx(
    executor: &mut sqlx::AnyConnection,
    job_id: &str,
    checkpoint: &Checkpoint,
) -> Result<(), sqlx::Error> {
    let json = checkpoint.to_json_string().unwrap_or_default();
    sqlx::query("UPDATE jobs SET checkpoint = $1 WHERE id = $2")
        .bind(&json)
        .bind(job_id)
        .execute(&mut *executor)
        .await?;
    Ok(())
}

impl<'a> BatchDriver<'a> {
    /// Pull `target_count` candidates from the iterator. Snapshot existing keys
    /// in the SAME transaction as dedup inserts to detect duplicates. Assigns
    /// combo_ids to newly-accepted candidates. Inserts the 'committed' row in
    /// triage_batches. Commits BEFORE simc runs.
    pub async fn pre_simc_phase(
        &self,
        iter: &mut ProfilesetIterator,
        state: &mut TriageState,
        target_count: usize,
        constants: TriageConstants,
    ) -> Result<PreSimcResult, sqlx::Error> {
        // 1. Pull candidates.
        let start_cursor: Vec<usize> = iter.cursor().to_vec();
        let mut pending: Vec<ProfilesetCandidate> = Vec::with_capacity(target_count);
        for _ in 0..target_count {
            if let Some(c) = iter.next() {
                pending.push(c);
            } else {
                break;
            }
        }
        let end_cursor: Vec<usize> = iter.cursor().to_vec();
        let iterator_exhausted = pending.len() < target_count;

        let batch_idx = state.next_batch_idx;
        let start_cursor_json = serde_json::to_string(&start_cursor).unwrap_or_default();
        let end_cursor_json = serde_json::to_string(&end_cursor).unwrap_or_default();

        if pending.is_empty() {
            return Ok(PreSimcResult {
                accepted: vec![],
                batch_idx,
                start_cursor_json,
                end_cursor_json,
                candidate_count: 0,
                iterator_exhausted: true,
            });
        }

        let candidate_keys: Vec<String> = pending.iter().map(|c| c.identity_key.clone()).collect();

        // 2. Pre-simc DB transaction.
        let mut tx = self.pool.begin().await?;

        let existing: HashSet<String> = self
            .dedup_repo
            .snapshot_existing(&mut *tx, self.job_id, &candidate_keys)
            .await?;

        self.dedup_repo
            .insert_chunked(&mut *tx, self.job_id, &candidate_keys)
            .await?;

        // Filter pending â†’ accepted (new keys only). Assign combo_ids.
        // state.next_combo_id is incremented here but NOT persisted in the checkpoint.
        // If the process crashes between this commit and commit_survivors, the next
        // combo_id values are lost. Phase 2 resume must reconstruct next_combo_id from
        // MAX(combo_id) over committed-but-not-completed batches' accepted_count, or
        // from the dedup rows. See review Important #7 and spec Â§5 resume flow.
        let mut accepted: Vec<AcceptedCandidate> = Vec::new();
        for (cand, key) in pending.into_iter().zip(candidate_keys.iter()) {
            if !existing.contains(key) {
                let combo_id = state.next_combo_id;
                state.next_combo_id += 1;
                let combo_name = format!("Combo {}", combo_id);
                accepted.push(AcceptedCandidate { candidate: cand, combo_id, combo_name });
            }
        }

        self.triage_repo
            .insert_committed(
                &mut *tx,
                self.job_id,
                batch_idx,
                &start_cursor_json,
                &end_cursor_json,
                candidate_keys.len() as i64,
                accepted.len() as i64,
            )
            .await?;

        // Persist Checkpoint inside the same transaction so cursor + batch state
        // land atomically with the dedup rows. On resume:
        //   - triage_batches shows this batch as 'committed' (not yet 'completed')
        //   - jobs.checkpoint shows next_cursor = where we'll resume from after this batch
        //   - if simc never finishes for this batch, resume re-runs it (dedup is idempotent)
        let checkpoint = Checkpoint {
            phase: CheckpointPhase::Triage(TriageCheckpoint {
                // After the current batch completes, the iterator will be at the cursor
                // we just captured as end_cursor. That's where the NEXT batch starts.
                next_cursor: end_cursor.clone(),
                // state.next_batch_idx still holds the CURRENT batch's idx; it'll be
                // incremented after this commit. Persist the post-increment value so
                // resume picks up the next batch.
                next_batch_idx: state.next_batch_idx + 1,
                // state.next_combo_id was already advanced for this batch's accepted candidates.
                next_combo_id: state.next_combo_id,
                estimated_total_batches: state.estimated_total_batches,
                survivors_so_far: state.survivors_so_far,
                avg_bytes_per_profileset: state.avg_bytes_per_profileset,
            }),
            constants,
        };
        write_checkpoint_in_tx(&mut *tx, self.job_id, &checkpoint).await?;

        tx.commit().await?;
        state.next_batch_idx += 1;

        Ok(PreSimcResult {
            accepted,
            batch_idx,
            start_cursor_json,
            end_cursor_json,
            candidate_count: candidate_keys.len(),
            iterator_exhausted,
        })
    }

    /// Run after simc returns. Writes survivor metadata + marks batch complete.
    pub async fn commit_survivors(
        &self,
        accepted: &[AcceptedCandidate],
        survivors_combo_ids: &[i64],
        batch_idx: i64,
    ) -> Result<(), sqlx::Error> {
        let survivor_set: HashSet<i64> = survivors_combo_ids.iter().copied().collect();

        // Collect owned strings so the InsertRow borrow lifetimes work.
        let owned: Vec<(i64, String, String, String, String, String)> = accepted.iter()
            .filter(|ac| survivor_set.contains(&ac.combo_id))
            .map(|ac| {
                let metadata_json = serde_json::to_string(&ac.candidate.metadata).unwrap_or_else(|_| "null".into());
                let cursor_json = serde_json::to_string(&ac.candidate.cursor_at_emission).unwrap_or_else(|_| "[]".into());
                (
                    ac.combo_id,
                    ac.combo_name.clone(),
                    ac.candidate.identity_key.clone(),
                    cursor_json,
                    ac.candidate.profileset_simc.clone(),
                    metadata_json,
                )
            })
            .collect();

        let inserts: Vec<ComboMetadataInsert> = owned.iter().map(|(id, name, key, cur, simc, meta)| {
            ComboMetadataInsert {
                combo_id: *id,
                combo_name: name,
                combo_key: key,
                batch_idx: Some(batch_idx),
                cursor_json: cur,
                profileset_simc: simc,
                metadata_json: meta,
            }
        }).collect();

        let mut tx = self.pool.begin().await?;
        self.metadata_repo.insert_batch(&mut *tx, self.job_id, &inserts).await?;
        self.triage_repo.mark_completed(&mut *tx, self.job_id, batch_idx, inserts.len() as i64).await?;
        tx.commit().await?;
        Ok(())
    }
}

/// Tunable Triage parameters. Defaults come from the module-level constants;
/// the calibration harness varies these to grid-search optimal values.
/// Production callers use `TriageConstants::default()`.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct TriageConstants {
    pub target_batch_input_bytes: usize,
    pub min_batch_profilesets: usize,
    pub max_batch_profilesets: usize,
    pub triage_iterations: u32,
    pub triage_cutoff_multiplier: f64,
    pub min_triage_target_error_fallback: f64,
    pub min_keep_per_batch: usize,
    pub global_survivor_target: usize,
    pub global_survivor_hard_max: usize,
    pub probe_size: usize,
}

impl Default for TriageConstants {
    fn default() -> Self {
        Self {
            target_batch_input_bytes: TARGET_BATCH_INPUT_BYTES,
            min_batch_profilesets: MIN_BATCH_PROFILESETS,
            max_batch_profilesets: MAX_BATCH_PROFILESETS,
            triage_iterations: TRIAGE_ITERATIONS,
            triage_cutoff_multiplier: TRIAGE_CUTOFF_MULTIPLIER,
            min_triage_target_error_fallback: MIN_TRIAGE_TARGET_ERROR_FALLBACK,
            min_keep_per_batch: MIN_KEEP_PER_BATCH,
            global_survivor_target: GLOBAL_SURVIVOR_TARGET,
            global_survivor_hard_max: GLOBAL_SURVIVOR_HARD_MAX,
            probe_size: PROBE_SIZE,
        }
    }
}

// â”€â”€ Task 17: Adaptive batch sizing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Compute the next batch's target candidate count from observed avg bytes-per-profileset.
/// Uses module-level constants (production path).
pub fn next_batch_target_count(avg_bytes_per_profileset: usize) -> usize {
    next_batch_target_count_with(
        avg_bytes_per_profileset,
        TARGET_BATCH_INPUT_BYTES,
        MIN_BATCH_PROFILESETS,
        MAX_BATCH_PROFILESETS,
        PROBE_SIZE,
    )
}

/// Parameterized variant used by the calibration harness.
pub fn next_batch_target_count_with(
    avg_bytes_per_profileset: usize,
    target_batch_input_bytes: usize,
    min_batch_profilesets: usize,
    max_batch_profilesets: usize,
    probe_size: usize,
) -> usize {
    if avg_bytes_per_profileset == 0 {
        return probe_size;
    }
    let by_bytes = target_batch_input_bytes / avg_bytes_per_profileset;
    by_bytes.clamp(min_batch_profilesets, max_batch_profilesets)
}

/// EWMA update for avg bytes-per-profileset.
pub fn update_avg_bytes(current_avg: usize, batch_total_bytes: usize, batch_count: usize) -> usize {
    if batch_count == 0 {
        return current_avg;
    }
    let new_per = batch_total_bytes / batch_count;
    if current_avg == 0 {
        new_per
    } else {
        let blended = 0.3 * new_per as f64 + 0.7 * current_avg as f64;
        blended as usize
    }
}

#[cfg(test)]
mod sizing_tests {
    use super::*;

    #[test]
    fn probe_size_when_avg_unknown() {
        assert_eq!(next_batch_target_count(0), PROBE_SIZE);
    }

    #[test]
    fn target_count_respects_min_bound() {
        assert_eq!(next_batch_target_count(1024 * 1024 * 1024), MIN_BATCH_PROFILESETS);
    }

    #[test]
    fn target_count_respects_max_bound() {
        assert_eq!(next_batch_target_count(1), MAX_BATCH_PROFILESETS);
    }

    #[test]
    fn target_count_typical() {
        let n = next_batch_target_count(1024);
        assert!(n >= MIN_BATCH_PROFILESETS && n <= MAX_BATCH_PROFILESETS);
        // 1.5 MiB / 1 KiB approx 1536 profilesets - comfortably inside [MIN, MAX].
        assert!(n > MIN_BATCH_PROFILESETS && n < MAX_BATCH_PROFILESETS);
    }
}

// â”€â”€ Task 18: Statistical retention with CI-window + min-keep floor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Decide which combo_ids survive a Triage batch based on simc output.
/// Uses module-level constants (production path).
pub fn select_survivors(
    profilesets: &[Value],
    accepted: &[AcceptedCandidate],
    global_remaining: usize,
    batches_remaining: usize,
) -> Vec<i64> {
    select_survivors_with(
        profilesets,
        accepted,
        global_remaining,
        batches_remaining,
        TRIAGE_CUTOFF_MULTIPLIER,
        MIN_TRIAGE_TARGET_ERROR_FALLBACK,
        MIN_KEEP_PER_BATCH,
    )
}

/// Parameterized variant used by the calibration harness.
pub fn select_survivors_with(
    profilesets: &[Value],
    accepted: &[AcceptedCandidate],
    global_remaining: usize,
    batches_remaining: usize,
    triage_cutoff_multiplier: f64,
    min_triage_target_error_fallback: f64,
    min_keep_per_batch: usize,
) -> Vec<i64> {
    if profilesets.is_empty() || accepted.is_empty() {
        return vec![];
    }

    let name_to_id: std::collections::HashMap<&str, i64> =
        accepted.iter().map(|ac| (ac.combo_name.as_str(), ac.combo_id)).collect();

    let mut sorted: Vec<(&str, f64, f64)> = profilesets.iter().filter_map(|p| {
        let name = p.get("name").and_then(|v| v.as_str())?;
        let mean = p.get("mean").and_then(|v| v.as_f64())?;
        let stddev = p.get("stddev").and_then(|v| v.as_f64()).unwrap_or(0.0);
        Some((name, mean, stddev))
    }).collect();
    sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    if sorted.is_empty() {
        return vec![];
    }

    let batch_top_mean = sorted[0].1;
    if batch_top_mean <= 0.0 {
        return vec![];
    }

    // NOTE: This averages raw stddev/mean*100, not the simc CI half-width
    // (which would be 1.96 * stddev / sqrt(iterations) / mean * 100). The result is
    // roughly sqrt(iterations) times too generous at keeping survivors compared to
    // a true CI half-width â€” at triage_iterations=50 that's about 7x over-keep.
    // This is the SAFE direction (false positives, not false negatives). The
    // calibration harness (backend/calibration) tunes TRIAGE_CUTOFF_MULTIPLIER
    // against winner-loss rates on a real scenario; running calibration once will
    // pick a multiplier that compensates for the formula's looseness. See spec O2.
    let s: f64 = sorted.iter().map(|(_, m, sd)| if *m > 0.0 { sd / m * 100.0 } else { 0.0 }).sum();
    let avg_rel_stddev = (s / sorted.len() as f64).max(min_triage_target_error_fallback);
    let cutoff = batch_top_mean * (1.0 - triage_cutoff_multiplier * avg_rel_stddev / 100.0);

    let mut kept: Vec<(&str, f64)> = sorted.iter()
        .filter(|(_, m, _)| *m >= cutoff)
        .map(|(n, m, _)| (*n, *m))
        .collect();

    if kept.len() < min_keep_per_batch {
        let take_n = min_keep_per_batch.min(sorted.len());
        kept = sorted.iter().take(take_n).map(|(n, m, _)| (*n, *m)).collect();
    }

    let per_batch_max = if batches_remaining == 0 {
        global_remaining
    } else {
        (global_remaining / batches_remaining).max(min_keep_per_batch)
    };
    if kept.len() > per_batch_max {
        kept.truncate(per_batch_max);
    }

    kept.into_iter()
        .filter_map(|(name, _)| name_to_id.get(name).copied())
        .collect()
}

#[cfg(test)]
mod retention_tests {
    use super::*;
    use serde_json::json;

    fn ac(combo_id: i64, name: &str) -> AcceptedCandidate {
        AcceptedCandidate {
            candidate: ProfilesetCandidate {
                cursor_at_emission: vec![],
                profileset_name: name.to_string(),
                profileset_simc: String::new(),
                metadata: json!(null),
                identity_key: String::new(),
            },
            combo_id,
            combo_name: name.to_string(),
        }
    }

    #[test]
    fn keeps_top_when_tight_distribution() {
        let accepted: Vec<AcceptedCandidate> = (0..200).map(|i| ac(i, &format!("Combo {}", i))).collect();
        let profilesets: Vec<Value> = (0..200).map(|i| json!({
            "name": format!("Combo {}", i),
            "mean": 100_000.0 - i as f64 * 10.0,
            "stddev": 50.0,
        })).collect();
        let survivors = select_survivors(&profilesets, &accepted, 10_000, 100);
        assert!(survivors.len() >= MIN_KEEP_PER_BATCH);
    }

    #[test]
    fn drops_clear_losers() {
        let accepted: Vec<AcceptedCandidate> = (0..200).map(|i| ac(i, &format!("Combo {}", i))).collect();
        let profilesets: Vec<Value> = (0..200).map(|i| {
            let mean = if i < 50 { 100_000.0 } else { 90_000.0 };
            json!({ "name": format!("Combo {}", i), "mean": mean, "stddev": 100.0 })
        }).collect();
        let survivors = select_survivors(&profilesets, &accepted, 10_000, 100);
        assert!(survivors.len() >= MIN_KEEP_PER_BATCH);
        assert!(survivors.contains(&0));  // top combo always present
    }

    #[test]
    fn global_budget_caps_survivors() {
        let accepted: Vec<AcceptedCandidate> = (0..1000).map(|i| ac(i, &format!("Combo {}", i))).collect();
        let profilesets: Vec<Value> = (0..1000).map(|i| json!({
            "name": format!("Combo {}", i),
            "mean": 100_000.0,
            "stddev": 50.0,
        })).collect();
        let survivors = select_survivors(&profilesets, &accepted, 500, 10);
        // per_batch_max = max(500/10, MIN_KEEP) = max(50, 100) = 100
        assert_eq!(survivors.len(), MIN_KEEP_PER_BATCH);
    }

    #[test]
    fn empty_profilesets_returns_empty() {
        let accepted: Vec<AcceptedCandidate> = vec![ac(1, "Combo 1")];
        let survivors = select_survivors(&[], &accepted, 1000, 10);
        assert_eq!(survivors, Vec::<i64>::new());
    }
}

// â”€â”€ Task 19: Global survivor budget enforcement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Uses module-level constants (production path).
pub fn enforce_hard_max(current_survivors: usize, next_count: usize) -> Option<usize> {
    enforce_hard_max_with(current_survivors, next_count, GLOBAL_SURVIVOR_HARD_MAX)
}

/// Parameterized variant used by the calibration harness.
pub fn enforce_hard_max_with(current_survivors: usize, next_count: usize, global_survivor_hard_max: usize) -> Option<usize> {
    if current_survivors >= global_survivor_hard_max {
        return None;
    }
    let remaining = global_survivor_hard_max - current_survivors;
    Some(next_count.min(remaining))
}

/// Uses module-level constants (production path).
pub fn global_remaining_for(state: &TriageState) -> usize {
    global_remaining_for_with(state, GLOBAL_SURVIVOR_TARGET)
}

/// Parameterized variant used by the calibration harness.
pub fn global_remaining_for_with(state: &TriageState, global_survivor_target: usize) -> usize {
    global_survivor_target.saturating_sub(state.survivors_so_far)
}

#[cfg(test)]
mod budget_tests {
    use super::*;

    #[test]
    fn hard_max_allows_under_budget() {
        assert_eq!(enforce_hard_max(100_000, 1_000), Some(1_000));
    }

    #[test]
    fn hard_max_truncates_at_ceiling() {
        let avail = enforce_hard_max(499_500, 1_000).unwrap();
        assert_eq!(avail, GLOBAL_SURVIVOR_HARD_MAX - 499_500);
    }

    #[test]
    fn hard_max_returns_none_at_ceiling() {
        assert_eq!(enforce_hard_max(GLOBAL_SURVIVOR_HARD_MAX, 1), None);
    }
}

// â”€â”€ Task 20 Part B: run_triage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

pub struct TriageRunResult {
    pub survivor_combo_ids: Vec<i64>,
    pub total_batches: usize,
    pub total_candidates: usize,
    pub total_accepted: usize,
}

pub struct TriageRunInputs<'a> {
    pub pool: &'a AnyPool,
    pub job_id: &'a str,
    pub simc_bin: &'a std::path::Path,
    pub fight_style: &'a str,
    pub target_error: f64,
    pub base_profile: &'a str,
    pub on_progress: Box<dyn Fn(u8, String) + Send + Sync + 'a>,
}

/// Production entry point. Delegates to `run_triage_with_constants` using
/// `TriageConstants::default()`, so existing callers are unaffected.
pub async fn run_triage(
    iter_cfg: ProfilesetIteratorConfig,
    inputs: TriageRunInputs<'_>,
    estimated_total_combos: u64,
) -> Result<TriageRunResult, String> {
    run_triage_with_constants(iter_cfg, inputs, estimated_total_combos, TriageConstants::default()).await
}

/// Full Triage run with explicit constants. Called by `run_triage` (production)
/// and by the calibration harness (grid search).
pub async fn run_triage_with_constants(
    iter_cfg: ProfilesetIteratorConfig,
    inputs: TriageRunInputs<'_>,
    estimated_total_combos: u64,
    constants: TriageConstants,
) -> Result<TriageRunResult, String> {
    // Shadow module-level consts with values from the constants struct so all
    // helper call-sites below read from the struct without needing extra parameters.
    let target_batch_input_bytes     = constants.target_batch_input_bytes;
    let min_batch_profilesets        = constants.min_batch_profilesets;
    let max_batch_profilesets        = constants.max_batch_profilesets;
    let triage_iterations            = constants.triage_iterations;
    let triage_cutoff_multiplier     = constants.triage_cutoff_multiplier;
    let min_triage_target_error_fallback = constants.min_triage_target_error_fallback;
    let min_keep_per_batch           = constants.min_keep_per_batch;
    let global_survivor_target       = constants.global_survivor_target;
    let global_survivor_hard_max     = constants.global_survivor_hard_max;
    let probe_size                   = constants.probe_size;

    let dedup_repo = ComboDedupRepo::new(inputs.pool.clone());
    let triage_repo = TriageBatchesRepo::new(inputs.pool.clone());
    let metadata_repo = ComboMetadataRepo::new(inputs.pool.clone());
    let driver = BatchDriver {
        pool: inputs.pool,
        dedup_repo: &dedup_repo,
        triage_repo: &triage_repo,
        metadata_repo: &metadata_repo,
        job_id: inputs.job_id,
    };

    let mut iter = ProfilesetIterator::new(iter_cfg);
    let mut state = TriageState::default();
    let mut all_survivors: Vec<i64> = Vec::new();
    let mut total_candidates = 0usize;
    let mut total_accepted = 0usize;

    loop {
        let target = next_batch_target_count_with(
            state.avg_bytes_per_profileset,
            target_batch_input_bytes,
            min_batch_profilesets,
            max_batch_profilesets,
            probe_size,
        );
        (inputs.on_progress)(
            ((state.next_batch_idx as f64 / state.estimated_total_batches.max(1) as f64) * 100.0).min(100.0) as u8,
            format!("Preparing batch {}", state.next_batch_idx + 1),
        );

        let pre = driver.pre_simc_phase(&mut iter, &mut state, target, constants).await
            .map_err(|e| format!("Triage pre-simc DB phase failed: {}", e))?;

        if pre.accepted.is_empty() && pre.iterator_exhausted {
            break;
        }

        total_candidates += pre.candidate_count;
        total_accepted += pre.accepted.len();

        (inputs.on_progress)(
            ((pre.batch_idx as f64 / state.estimated_total_batches.max(1) as f64) * 100.0).min(100.0) as u8,
            format!("Triage batch {} \u{00b7} simc on {} profilesets",
                    pre.batch_idx + 1, pre.accepted.len()),
        );

        // Concatenate profileset_simc lines for this batch.
        let profileset_simc_block: String = pre.accepted.iter()
            .map(|ac| ac.candidate.profileset_simc.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        let parsed = crate::simc_runner::run_simc_triage_batch(
            inputs.base_profile,
            &profileset_simc_block,
            triage_iterations,
            inputs.fight_style,
            inputs.target_error,
            inputs.simc_bin,
            inputs.job_id,
        ).await?;

        let global_remaining = global_remaining_for_with(&state, global_survivor_target);
        let batches_remaining = state.estimated_total_batches.saturating_sub(state.next_batch_idx as usize).max(1);
        let survivors = select_survivors_with(
            &parsed,
            &pre.accepted,
            global_remaining,
            batches_remaining,
            triage_cutoff_multiplier,
            min_triage_target_error_fallback,
            min_keep_per_batch,
        );

        let hard_max_hit = enforce_hard_max_with(state.survivors_so_far, 1, global_survivor_hard_max).is_none();
        let survivors = match enforce_hard_max_with(state.survivors_so_far, survivors.len(), global_survivor_hard_max) {
            None => Vec::new(),  // hard max hit; treat as zero survivors but still commit the batch
            Some(n) => survivors.into_iter().take(n).collect::<Vec<_>>(),
        };

        (inputs.on_progress)(
            ((pre.batch_idx as f64 / state.estimated_total_batches.max(1) as f64) * 100.0).min(100.0) as u8,
            format!("Recording survivors for batch {}", pre.batch_idx + 1),
        );

        driver.commit_survivors(&pre.accepted, &survivors, pre.batch_idx).await
            .map_err(|e| format!("Triage post-simc DB phase failed: {}", e))?;

        state.survivors_so_far += survivors.len();

        let batch_total_bytes: usize = pre.accepted.iter().map(|ac| ac.candidate.profileset_simc.len()).sum();
        state.avg_bytes_per_profileset = update_avg_bytes(
            state.avg_bytes_per_profileset,
            batch_total_bytes,
            pre.accepted.len(),
        );

        if state.avg_bytes_per_profileset > 0 {
            let per_batch = next_batch_target_count_with(
                state.avg_bytes_per_profileset,
                target_batch_input_bytes,
                min_batch_profilesets,
                max_batch_profilesets,
                probe_size,
            );
            state.estimated_total_batches = ((estimated_total_combos as usize) / per_batch.max(1)).max(1);
        }

        all_survivors.extend(survivors);

        if hard_max_hit || pre.iterator_exhausted {
            break;
        }
    }

    // Final Triageâ†’Staged transition checkpoint. The staged pipeline (Task 4)
    // will write its own Checkpoints from here on. If a crash happens between
    // Triage completion and the first staged stage starting, this checkpoint
    // is what resume uses to skip Triage entirely.
    let final_checkpoint = Checkpoint {
        phase: CheckpointPhase::Staged(StagedCheckpoint {
            next_stage_idx: 0,
            next_stage_name: "Probe".to_string(),
            survivor_combo_ids: all_survivors.clone(),
        }),
        constants,
    };
    let json = final_checkpoint.to_json_string().unwrap_or_default();
    let _ = sqlx::query("UPDATE jobs SET checkpoint = $1 WHERE id = $2")
        .bind(&json)
        .bind(inputs.job_id)
        .execute(inputs.pool)
        .await
        .map_err(|e| format!("Failed to write final Triage checkpoint: {}", e))?;

    Ok(TriageRunResult {
        survivor_combo_ids: all_survivors,
        total_batches: state.next_batch_idx as usize,
        total_candidates,
        total_accepted,
    })
}
