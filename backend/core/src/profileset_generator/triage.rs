//! Streaming Triage stage. Pulls candidates from a ProfilesetIterator in
//! adaptive batches, runs cheap simc on each batch, and keeps survivors
//! via a statistical CI-window retention with a global survivor budget.
//! See spec §2 (transaction lifecycle) and §3 (Triage stage) for design.

use serde_json::Value;
use sqlx::AnyPool;
use std::collections::HashSet;

use super::iterator::{ProfilesetCandidate, ProfilesetIterator, ProfilesetIteratorConfig};
use crate::db::{ComboDedupRepo, ComboMetadataInsert, ComboMetadataRepo, TriageBatchesRepo};
use crate::profileset_generator::checkpoint::{
    Checkpoint, CheckpointPhase, StagedCheckpoint, TriageCheckpoint,
};

// Default batch sizing. Smaller batches tighten the worst-case pause latency
// (one batch's work is the longest a pause can be delayed) at a modest
// throughput cost. Do NOT lower MIN below MIN_KEEP_PER_BATCH — retention
// assumes the batch is large enough to drop ineligible profilesets.
pub const TARGET_BATCH_INPUT_BYTES: usize = 1024 * 1024;
pub const MIN_BATCH_PROFILESETS: usize = 100;
pub const MAX_BATCH_PROFILESETS: usize = 250;
/// Triage `target_error` (percent). Drives simc's per-profileset auto-tuner;
/// each profileset runs only as many iterations as needed to hit this CI
/// half-width. Looser than the user's final precision so triage stays a cheap
/// coarse pre-filter — anything within ~3× this margin of the top survives.
pub const TRIAGE_TARGET_ERROR: f64 = 2.0;
/// Iteration ceiling per profileset in Triage. With `TRIAGE_TARGET_ERROR=2.0`
/// most profilesets converge in 50-150 iterations; this cap exists only as a
/// safety net for unusually noisy specs that would otherwise run unbounded.
pub const TRIAGE_ITERATIONS: u32 = 10_000;
pub const TRIAGE_CUTOFF_MULTIPLIER: f64 = 3.0;
pub const MIN_TRIAGE_TARGET_ERROR_FALLBACK: f64 = 1.0;
pub const MIN_KEEP_PER_BATCH: usize = 100;
pub const GLOBAL_SURVIVOR_TARGET: usize = 150_000;
pub const GLOBAL_SURVIVOR_HARD_MAX: usize = 500_000;
pub const TRIAGE_THRESHOLD: u64 = 500;
pub const PROBE_SIZE: usize = 100;
const MAX_USER_BATCH_PROFILESETS: usize = 30_000;
const BATCH_BUDGET_BYTES_PER_PROFILESET: usize = 4 * 1024;

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

impl<'a> BatchDriver<'a> {
    /// Pull `target_count` candidates from the iterator. Snapshot existing keys
    /// in the SAME transaction as dedup inserts to detect duplicates. Assigns
    /// combo_ids to newly-accepted candidates. Inserts the 'committed' row in
    /// triage_batches. Commits BEFORE simc runs.
    ///
    /// Crash safety: the persisted checkpoint already advances next_cursor PAST
    /// this batch's range. On resume, an orphan committed-but-not-completed row
    /// is deleted, dedup rows stay (harmless since the iterator only moves
    /// forward), and any candidates that were accepted but not sim'd are
    /// silently dropped. Worst-case data loss: one batch's accepted candidates,
    /// bounded by ~MAX_BATCH_PROFILESETS. Acceptable for Phase 2 v1.
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
            .snapshot_existing(&mut tx, self.job_id, &candidate_keys)
            .await?;

        self.dedup_repo
            .insert_chunked(&mut tx, self.job_id, batch_idx, &candidate_keys)
            .await?;

        // Filter pending â†’ accepted (new keys only). Assign combo_ids.
        // state.next_combo_id is incremented here and persisted in the checkpoint.
        // If the process crashes before commit_survivors, resume rewinds to this
        // batch's start cursor and deletes the batch-scoped dedup keys.
        let mut accepted: Vec<AcceptedCandidate> = Vec::new();
        for (cand, key) in pending.into_iter().zip(candidate_keys.iter()) {
            if !existing.contains(key) {
                let combo_id = state.next_combo_id;
                state.next_combo_id += 1;
                let combo_name = format!("Combo {}", combo_id);
                let candidate = rename_profileset_candidate(cand, &combo_name);
                accepted.push(AcceptedCandidate {
                    candidate,
                    combo_id,
                    combo_name,
                });
            }
        }

        self.triage_repo
            .insert_committed(
                &mut tx,
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
        //   - if simc never finishes for this batch, resume deletes this batch's
        //     dedup keys and replays it from start_cursor.
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
        write_checkpoint_in_tx(&mut tx, self.job_id, &checkpoint).await?;

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
        checkpoint: &Checkpoint,
    ) -> Result<(), sqlx::Error> {
        let survivor_set: HashSet<i64> = survivors_combo_ids.iter().copied().collect();

        // Collect owned strings so the InsertRow borrow lifetimes work.
        let owned: Vec<(i64, String, String, String, String, String)> = accepted
            .iter()
            .filter(|ac| survivor_set.contains(&ac.combo_id))
            .map(|ac| {
                let metadata_json =
                    serde_json::to_string(&ac.candidate.metadata).unwrap_or_else(|_| "null".into());
                let cursor_json = serde_json::to_string(&ac.candidate.cursor_at_emission)
                    .unwrap_or_else(|_| "[]".into());
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

        let inserts: Vec<ComboMetadataInsert> = owned
            .iter()
            .map(|(id, name, key, cur, simc, meta)| ComboMetadataInsert {
                combo_id: *id,
                combo_name: name,
                combo_key: key,
                batch_idx: Some(batch_idx),
                cursor_json: cur,
                profileset_simc: simc,
                metadata_json: meta,
            })
            .collect();

        let mut tx = self.pool.begin().await?;
        self.metadata_repo
            .insert_batch(&mut tx, self.job_id, &inserts)
            .await?;
        self.triage_repo
            .mark_completed(&mut tx, self.job_id, batch_idx, inserts.len() as i64)
            .await?;
        write_checkpoint_in_tx(&mut tx, self.job_id, checkpoint).await?;
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
    /// CI half-width (percent) simc converges to per profileset. Drives the
    /// actual precision; replaces the old fixed-iteration approach.
    pub triage_target_error: f64,
    /// Iteration ceiling per profileset; safety net only — `triage_target_error`
    /// is the load-bearing knob.
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
            target_batch_input_bytes: env_usize(
                "TRIAGE_TARGET_BATCH_BYTES",
                TARGET_BATCH_INPUT_BYTES,
            ),
            min_batch_profilesets: env_usize("TRIAGE_MIN_BATCH", MIN_BATCH_PROFILESETS),
            max_batch_profilesets: env_usize("TRIAGE_MAX_BATCH", MAX_BATCH_PROFILESETS),
            triage_target_error: env_f64("TRIAGE_TARGET_ERROR", TRIAGE_TARGET_ERROR),
            triage_iterations: env_u32("TRIAGE_ITERATIONS", TRIAGE_ITERATIONS),
            triage_cutoff_multiplier: TRIAGE_CUTOFF_MULTIPLIER,
            min_triage_target_error_fallback: MIN_TRIAGE_TARGET_ERROR_FALLBACK,
            min_keep_per_batch: MIN_KEEP_PER_BATCH,
            global_survivor_target: GLOBAL_SURVIVOR_TARGET,
            global_survivor_hard_max: GLOBAL_SURVIVOR_HARD_MAX,
            probe_size: PROBE_SIZE,
        }
    }
}

impl TriageConstants {
    /// Apply a user-selected throughput/pausing tradeoff for streamed Top Gear.
    ///
    /// The selected value caps ordinary batches. The corresponding byte budget
    /// still allows batches to shrink if profileset input is unusually bulky.
    pub fn with_requested_max_batch_profilesets(mut self, requested: Option<usize>) -> Self {
        let Some(requested) = requested else {
            return self;
        };
        let max = requested.clamp(MIN_KEEP_PER_BATCH, MAX_USER_BATCH_PROFILESETS);
        self.min_batch_profilesets = MIN_KEEP_PER_BATCH;
        self.max_batch_profilesets = max;
        self.target_batch_input_bytes = max.saturating_mul(BATCH_BUDGET_BYTES_PER_PROFILESET);
        self
    }
}

fn env_usize(key: &str, fallback: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(fallback)
}

fn env_u32(key: &str, fallback: u32) -> u32 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(fallback)
}

fn env_f64(key: &str, fallback: f64) -> f64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(fallback)
}

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

/// Format the trailing " · ETA …" segment of the Triage progress message.
/// Returns an empty string before any batches have completed (no timing data
/// to extrapolate from).
fn format_eta_suffix(
    elapsed_seconds: f64,
    batches_completed: usize,
    estimated_total_batches: usize,
) -> String {
    if batches_completed == 0 || elapsed_seconds <= 0.0 {
        return String::new();
    }
    let remaining = estimated_total_batches.saturating_sub(batches_completed);
    if remaining == 0 {
        return String::new();
    }
    let avg = elapsed_seconds / batches_completed as f64;
    let eta_seconds = (avg * remaining as f64) as u64;
    let mins = eta_seconds / 60;
    let secs = eta_seconds % 60;
    if mins > 0 {
        format!(" \u{00b7} ETA {}m {}s", mins, secs)
    } else {
        format!(" \u{00b7} ETA {}s", secs)
    }
}

#[cfg(test)]
mod eta_tests {
    use super::*;

    #[test]
    fn eta_empty_when_no_batches_done() {
        assert_eq!(format_eta_suffix(0.0, 0, 10), "");
        assert_eq!(format_eta_suffix(5.0, 0, 10), "");
    }

    #[test]
    fn eta_empty_when_no_batches_remaining() {
        assert_eq!(format_eta_suffix(60.0, 10, 10), "");
        assert_eq!(format_eta_suffix(60.0, 11, 10), "");
    }

    #[test]
    fn eta_formats_minutes_and_seconds() {
        // 3 batches in 60s → avg 20s/batch. 7 remaining → ETA 140s = 2m 20s.
        assert_eq!(format_eta_suffix(60.0, 3, 10), " \u{00b7} ETA 2m 20s");
    }

    #[test]
    fn eta_formats_seconds_only_under_a_minute() {
        // 4 batches in 40s → avg 10s. 5 remaining → ETA 50s.
        assert_eq!(format_eta_suffix(40.0, 4, 9), " \u{00b7} ETA 50s");
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
        assert_eq!(
            next_batch_target_count(1024 * 1024 * 1024),
            MIN_BATCH_PROFILESETS
        );
    }

    #[test]
    fn target_count_respects_max_bound() {
        assert_eq!(next_batch_target_count(1), MAX_BATCH_PROFILESETS);
    }

    #[test]
    fn target_count_typical() {
        let n = next_batch_target_count(1024);
        assert_eq!(n, MAX_BATCH_PROFILESETS);
    }

    #[test]
    fn target_count_shrinks_large_profilesets_before_minimum() {
        let n = next_batch_target_count(8 * 1024);
        assert_eq!(n, 128);
    }

    #[test]
    fn requested_max_batch_scales_byte_budget_and_clamps_range() {
        let throughput =
            TriageConstants::default().with_requested_max_batch_profilesets(Some(1000));
        assert_eq!(throughput.min_batch_profilesets, MIN_KEEP_PER_BATCH);
        assert_eq!(throughput.max_batch_profilesets, 1000);
        assert_eq!(
            throughput.target_batch_input_bytes,
            1000 * BATCH_BUDGET_BYTES_PER_PROFILESET
        );

        let bounded = TriageConstants::default()
            .with_requested_max_batch_profilesets(Some(MAX_USER_BATCH_PROFILESETS + 1));
        assert_eq!(bounded.max_batch_profilesets, MAX_USER_BATCH_PROFILESETS);
    }
}

// â”€â”€ Statistical retention with CI-window + min-keep floor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    let name_to_id: std::collections::HashMap<&str, i64> = accepted
        .iter()
        .map(|ac| (ac.combo_name.as_str(), ac.combo_id))
        .collect();

    let mut sorted: Vec<(&str, f64, f64)> = profilesets
        .iter()
        .filter_map(|p| {
            let name = p.get("name").and_then(|v| v.as_str())?;
            let mean = p.get("mean").and_then(|v| v.as_f64())?;
            let stddev = p.get("stddev").and_then(|v| v.as_f64()).unwrap_or(0.0);
            Some((name, mean, stddev))
        })
        .collect();
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
    let s: f64 = sorted
        .iter()
        .map(|(_, m, sd)| if *m > 0.0 { sd / m * 100.0 } else { 0.0 })
        .sum();
    let avg_rel_stddev = (s / sorted.len() as f64).max(min_triage_target_error_fallback);
    let cutoff = batch_top_mean * (1.0 - triage_cutoff_multiplier * avg_rel_stddev / 100.0);

    let mut kept: Vec<(&str, f64)> = sorted
        .iter()
        .filter(|(_, m, _)| *m >= cutoff)
        .map(|(n, m, _)| (*n, *m))
        .collect();

    if kept.len() < min_keep_per_batch {
        let take_n = min_keep_per_batch.min(sorted.len());
        kept = sorted
            .iter()
            .take(take_n)
            .map(|(n, m, _)| (*n, *m))
            .collect();
    }

    let per_batch_max = global_remaining
        .checked_div(batches_remaining)
        .map(|n| n.max(min_keep_per_batch))
        .unwrap_or(global_remaining);
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
    fn rename_profileset_candidate_keeps_simc_names_in_sync_with_combo_id() {
        let candidate = ProfilesetCandidate {
            cursor_at_emission: vec![1, 0, 0],
            profileset_name: "Combo 8".to_string(),
            profileset_simc:
                "profileset.\"Combo 8\"+=head=,id=1\nprofileset.\"Combo 8\"+=talents=abc"
                    .to_string(),
            metadata: json!(null),
            identity_key: "same-key-after-dedup".to_string(),
        };

        let renamed = rename_profileset_candidate(candidate, "Combo 3");

        assert_eq!(renamed.profileset_name, "Combo 3");
        assert!(renamed
            .profileset_simc
            .contains("profileset.\"Combo 3\"+=head"));
        assert!(renamed
            .profileset_simc
            .contains("profileset.\"Combo 3\"+=talents"));
        assert!(!renamed.profileset_simc.contains("Combo 8"));
    }

    #[test]
    fn keeps_top_when_tight_distribution() {
        let accepted: Vec<AcceptedCandidate> =
            (0..200).map(|i| ac(i, &format!("Combo {}", i))).collect();
        let profilesets: Vec<Value> = (0..200)
            .map(|i| {
                json!({
                    "name": format!("Combo {}", i),
                    "mean": 100_000.0 - i as f64 * 10.0,
                    "stddev": 50.0,
                })
            })
            .collect();
        let survivors = select_survivors(&profilesets, &accepted, 10_000, 100);
        assert!(survivors.len() >= MIN_KEEP_PER_BATCH);
    }

    #[test]
    fn drops_clear_losers() {
        let accepted: Vec<AcceptedCandidate> =
            (0..200).map(|i| ac(i, &format!("Combo {}", i))).collect();
        let profilesets: Vec<Value> = (0..200)
            .map(|i| {
                let mean = if i < 50 { 100_000.0 } else { 90_000.0 };
                json!({ "name": format!("Combo {}", i), "mean": mean, "stddev": 100.0 })
            })
            .collect();
        let survivors = select_survivors(&profilesets, &accepted, 10_000, 100);
        assert!(survivors.len() >= MIN_KEEP_PER_BATCH);
        assert!(survivors.contains(&0)); // top combo always present
    }

    #[test]
    fn global_budget_caps_survivors() {
        let accepted: Vec<AcceptedCandidate> =
            (0..1000).map(|i| ac(i, &format!("Combo {}", i))).collect();
        let profilesets: Vec<Value> = (0..1000)
            .map(|i| {
                json!({
                    "name": format!("Combo {}", i),
                    "mean": 100_000.0,
                    "stddev": 50.0,
                })
            })
            .collect();
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

// â”€â”€ Global survivor budget enforcement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Uses module-level constants (production path).
pub fn enforce_hard_max(current_survivors: usize, next_count: usize) -> Option<usize> {
    enforce_hard_max_with(current_survivors, next_count, GLOBAL_SURVIVOR_HARD_MAX)
}

/// Parameterized variant used by the calibration harness.
pub fn enforce_hard_max_with(
    current_survivors: usize,
    next_count: usize,
    global_survivor_hard_max: usize,
) -> Option<usize> {
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

// â”€â”€ run_triage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

pub struct TriageRunResult {
    pub survivor_combo_ids: Vec<i64>,
    pub total_batches: usize,
    pub total_candidates: usize,
    pub total_accepted: usize,
}

pub enum TriageRunOutcome {
    Completed(TriageRunResult),
    Paused,
}

pub struct TriageRunInputs<'a> {
    pub pool: &'a AnyPool,
    pub job_id: &'a str,
    pub simc_bin: &'a std::path::Path,
    pub fight_style: &'a str,
    pub options: &'a Value,
    pub base_profile: &'a str,
    pub log_buffer: std::sync::Arc<crate::log_buffer::LogBuffer>,
    pub on_progress: Box<dyn Fn(u8, String) + Send + Sync + 'a>,
}

/// State needed to resume a paused Triage run from its last checkpoint.
pub struct TriageResumeState {
    /// Restored TriageState (next_combo_id, next_batch_idx, etc.).
    pub state: TriageState,
    /// Cursor position to seek the iterator to before pulling the next batch.
    pub cursor: Vec<usize>,
    /// combo_ids of survivors already accepted in prior batches. Used to seed
    /// the all_survivors accumulator so the final Triage→Staged checkpoint
    /// includes everything, not just survivors from the resumed batches.
    pub already_collected_survivors: Vec<i64>,
}

/// Production entry point. Delegates to `run_triage_with_constants` using
/// `TriageConstants::default()`, so existing callers are unaffected.
pub async fn run_triage(
    iter_cfg: ProfilesetIteratorConfig,
    inputs: TriageRunInputs<'_>,
    estimated_total_combos: u64,
) -> Result<TriageRunOutcome, String> {
    run_triage_with_constants(
        iter_cfg,
        inputs,
        estimated_total_combos,
        TriageConstants::default(),
        None,
    )
    .await
}

/// Full Triage run with explicit constants. Called by `run_triage` (production)
/// and by the calibration harness (grid search).
pub async fn run_triage_with_constants(
    iter_cfg: ProfilesetIteratorConfig,
    inputs: TriageRunInputs<'_>,
    estimated_total_combos: u64,
    constants: TriageConstants,
    resume: Option<TriageResumeState>, // None = fresh run; Some = resumed from checkpoint
) -> Result<TriageRunOutcome, String> {
    // Shadow module-level consts with values from the constants struct so all
    // helper call-sites below read from the struct without needing extra parameters.
    let target_batch_input_bytes = constants.target_batch_input_bytes;
    let min_batch_profilesets = constants.min_batch_profilesets;
    let max_batch_profilesets = constants.max_batch_profilesets;
    let triage_target_error = constants.triage_target_error;
    let triage_iterations = constants.triage_iterations;
    let triage_cutoff_multiplier = constants.triage_cutoff_multiplier;
    let min_triage_target_error_fallback = constants.min_triage_target_error_fallback;
    let min_keep_per_batch = constants.min_keep_per_batch;
    let global_survivor_target = constants.global_survivor_target;
    let global_survivor_hard_max = constants.global_survivor_hard_max;
    let probe_size = constants.probe_size;

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

    let (mut state, mut all_survivors, resume_cursor) = match resume {
        Some(rs) => (rs.state, rs.already_collected_survivors, Some(rs.cursor)),
        None => (TriageState::default(), Vec::new(), None),
    };

    let mut iter = ProfilesetIterator::new(iter_cfg);
    if let Some(cursor) = resume_cursor {
        if !iter.seek(cursor) {
            return Err(
                "Resume cursor seek failed — request_json may not match the checkpoint".to_string(),
            );
        }
    }

    let mut total_candidates = 0usize;
    let mut total_accepted = 0usize;
    let triage_start = std::time::Instant::now();

    let start_message = format!(
        "Triage starting: target_batch_bytes={}, min_batch={}, max_batch={}, target_error={}, iterations={}",
        target_batch_input_bytes,
        min_batch_profilesets,
        max_batch_profilesets,
        triage_target_error,
        triage_iterations,
    );
    println!("[{}] {}", inputs.job_id, start_message);
    inputs.log_buffer.push_line(inputs.job_id, start_message);

    loop {
        let target = next_batch_target_count_with(
            state.avg_bytes_per_profileset,
            target_batch_input_bytes,
            min_batch_profilesets,
            max_batch_profilesets,
            probe_size,
        );
        (inputs.on_progress)(
            ((state.next_batch_idx as f64 / state.estimated_total_batches.max(1) as f64) * 100.0)
                .min(100.0) as u8,
            format!("Preparing batch {}", state.next_batch_idx + 1),
        );

        let pre = driver
            .pre_simc_phase(&mut iter, &mut state, target, constants)
            .await
            .map_err(|e| format!("Triage pre-simc DB phase failed: {}", e))?;

        if pre.accepted.is_empty() && pre.iterator_exhausted {
            break;
        }

        total_candidates += pre.candidate_count;
        total_accepted += pre.accepted.len();

        let eta_suffix = format_eta_suffix(
            triage_start.elapsed().as_secs_f64(),
            pre.batch_idx as usize,
            state.estimated_total_batches,
        );
        (inputs.on_progress)(
            ((pre.batch_idx as f64 / state.estimated_total_batches.max(1) as f64) * 100.0)
                .min(100.0) as u8,
            format!(
                "Triage batch {} \u{00b7} simc on {} profilesets{}",
                pre.batch_idx + 1,
                pre.accepted.len(),
                eta_suffix
            ),
        );

        // Concatenate profileset_simc lines for this batch.
        let profileset_simc_block: String = pre
            .accepted
            .iter()
            .map(|ac| ac.candidate.profileset_simc.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        let batch_number = pre.batch_idx + 1;
        let estimated_batches = state.estimated_total_batches.max(1);
        // 5%-bucket gate: `on_progress` ultimately spawns a DB `UPDATE jobs`,
        // so firing it on every simc profileset tick would be ~thousands of
        // writes per batch. Throttle both the DB update and the log line to
        // ~20 events per batch. AtomicUsize (not Cell) because the closure
        // is captured into a Send future via `tokio::spawn` upstream — the
        // sync overhead is negligible per tick.
        let last_logged_progress_bucket = std::sync::atomic::AtomicUsize::new(0);
        let batch_start = std::time::Instant::now();
        let pause_check_repo = crate::db::JobRepo::new(inputs.pool.clone());
        let parsed = match crate::simc_runner::run_simc_triage_batch(
            inputs.base_profile,
            &profileset_simc_block,
            inputs.options,
            triage_iterations,
            inputs.fight_style,
            // Triage-specific target_error: loose enough that simc converges
            // in O(100) iterations per profileset. The user's tight final
            // target_error is reserved for the Staged Final stage.
            triage_target_error,
            inputs.simc_bin,
            inputs.job_id,
            inputs.log_buffer.clone(),
            |current, total| {
                let bucket = (current.saturating_mul(20) / total.max(1)).min(20);
                let prev = last_logged_progress_bucket
                    .fetch_max(bucket, std::sync::atomic::Ordering::Relaxed);
                if bucket <= prev {
                    return;
                }

                let batch_fraction = current as f64 / total.max(1) as f64;
                let pct = (((pre.batch_idx as f64 + batch_fraction) / estimated_batches as f64)
                    * 100.0)
                    .min(100.0) as u8;
                (inputs.on_progress)(
                    pct,
                    format!(
                        "Triage batch {}: {}/{} profilesets",
                        batch_number, current, total
                    ),
                );
                inputs.log_buffer.push_line(
                    inputs.job_id,
                    format!(
                        "Triage batch {} progress: {}/{} profilesets ({}%)",
                        batch_number,
                        current,
                        total,
                        bucket * 5
                    ),
                );
            },
        )
        .await
        {
            Ok(parsed) => parsed,
            Err(e) => {
                match pause_check_repo.get_pause_requested(inputs.job_id).await {
                    Ok(true) => {
                        let _ = pause_check_repo
                            .set_pause_requested(inputs.job_id, false)
                            .await;
                        let _ = pause_check_repo
                            .update_status(inputs.job_id, crate::models::JobStatus::Paused)
                            .await;
                        return Ok(TriageRunOutcome::Paused);
                    }
                    Ok(false) | Err(_) => return Err(e),
                }
            }
        };
        let batch_secs = batch_start.elapsed().as_secs_f64();
        let batch_per_ps_ms = if pre.accepted.is_empty() {
            0.0
        } else {
            batch_secs * 1000.0 / pre.accepted.len() as f64
        };
        let global_remaining = global_remaining_for_with(&state, global_survivor_target);
        let batches_remaining = state
            .estimated_total_batches
            .saturating_sub(state.next_batch_idx as usize)
            .max(1);
        let survivors = select_survivors_with(
            &parsed,
            &pre.accepted,
            global_remaining,
            batches_remaining,
            triage_cutoff_multiplier,
            min_triage_target_error_fallback,
            min_keep_per_batch,
        );

        let hard_max_hit =
            enforce_hard_max_with(state.survivors_so_far, 1, global_survivor_hard_max).is_none();
        let survivors = match enforce_hard_max_with(
            state.survivors_so_far,
            survivors.len(),
            global_survivor_hard_max,
        ) {
            None => Vec::new(), // hard max hit; treat as zero survivors but still commit the batch
            Some(n) => survivors.into_iter().take(n).collect::<Vec<_>>(),
        };

        state.survivors_so_far += survivors.len();

        let batch_total_bytes: usize = pre
            .accepted
            .iter()
            .map(|ac| ac.candidate.profileset_simc.len())
            .sum();
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
            state.estimated_total_batches =
                ((estimated_total_combos as usize) / per_batch.max(1)).max(1);
        }

        let completed_checkpoint = Checkpoint {
            phase: CheckpointPhase::Triage(TriageCheckpoint {
                next_cursor: serde_json::from_str(&pre.end_cursor_json).unwrap_or_default(),
                next_batch_idx: state.next_batch_idx,
                next_combo_id: state.next_combo_id,
                estimated_total_batches: state.estimated_total_batches,
                survivors_so_far: state.survivors_so_far,
                avg_bytes_per_profileset: state.avg_bytes_per_profileset,
            }),
            constants,
        };

        (inputs.on_progress)(
            ((pre.batch_idx as f64 / state.estimated_total_batches.max(1) as f64) * 100.0)
                .min(100.0) as u8,
            format!("Recording survivors for batch {}", pre.batch_idx + 1),
        );

        driver
            .commit_survivors(
                &pre.accepted,
                &survivors,
                pre.batch_idx,
                &completed_checkpoint,
            )
            .await
            .map_err(|e| format!("Triage post-simc DB phase failed: {}", e))?;

        let batch_message = format!(
            "Triage batch {} complete: {:.1}s on {} profilesets, {} survivors kept ({} total) ({:.1} ms/profileset)",
            pre.batch_idx + 1,
            batch_secs,
            pre.accepted.len(),
            survivors.len(),
            state.survivors_so_far,
            batch_per_ps_ms,
        );
        println!("[{}] {}", inputs.job_id, batch_message);
        inputs.log_buffer.push_line(inputs.job_id, batch_message);

        all_survivors.extend(survivors);

        // Pause boundary: honor a pending pause request at the cleanest possible point —
        // after survivors are persisted and state is fully consistent. The checkpoint
        // is already on disk from pre_simc_phase, so resume picks up at exactly the
        // next batch's cursor. Clear the flag and transition to Paused.
        let pause_check_repo = crate::db::JobRepo::new(inputs.pool.clone());
        match pause_check_repo.get_pause_requested(inputs.job_id).await {
            Ok(true) => {
                // Clear the flag and flip status. Order matters: clear flag first so a
                // concurrent reader doesn't see Paused + pending pause.
                let _ = pause_check_repo
                    .set_pause_requested(inputs.job_id, false)
                    .await;
                let _ = pause_check_repo
                    .update_status(inputs.job_id, crate::models::JobStatus::Paused)
                    .await;
                let pause_message = format!("Triage paused after batch {}", pre.batch_idx + 1);
                println!("[{}] {}", inputs.job_id, pause_message);
                inputs.log_buffer.push_line(inputs.job_id, pause_message);
                return Ok(TriageRunOutcome::Paused);
            }
            Ok(false) => {}
            Err(e) => {
                eprintln!(
                    "[{}] Failed to read pause_requested (continuing): {}",
                    inputs.job_id, e
                );
            }
        }

        if hard_max_hit || pre.iterator_exhausted {
            break;
        }
    }

    // Final Triageâ†’Staged transition checkpoint. The staged pipeline
    // will write its own Checkpoints from here on. If a crash happens between
    // Triage completion and the first staged stage starting, this checkpoint
    // is what resume uses to skip Triage entirely.
    let final_checkpoint = Checkpoint {
        phase: CheckpointPhase::Staged(StagedCheckpoint {
            next_stage_idx: 0,
            next_stage_name: "Probe".to_string(),
            survivor_combo_ids: all_survivors.clone(),
            next_batch_idx: 0,
            batch_results: Vec::new(),
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

    let elapsed = triage_start.elapsed().as_secs_f64();
    let batches = state.next_batch_idx as usize;
    let per_ps_ms = if total_accepted > 0 {
        elapsed * 1000.0 / total_accepted as f64
    } else {
        0.0
    };
    let complete_message = format!(
        "Triage complete: {:.1}s wall, {} batches, {} candidates, {} accepted, {:.1} ms/profileset",
        elapsed, batches, total_candidates, total_accepted, per_ps_ms,
    );
    println!("[{}] {}", inputs.job_id, complete_message);
    inputs.log_buffer.push_line(inputs.job_id, complete_message);

    Ok(TriageRunOutcome::Completed(TriageRunResult {
        survivor_combo_ids: all_survivors,
        total_batches: state.next_batch_idx as usize,
        total_candidates,
        total_accepted,
    }))
}
