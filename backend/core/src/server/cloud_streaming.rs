//! Cloud-streaming orchestrator for streaming-sized Top Gear on Simmit.
//!
//! Streams the existing `ProfilesetIterator` into bounded chunks, submits each
//! to Simmit (server-side multistage), accumulates per-chunk SimC-JSON results,
//! checkpoints chunk state for crash/pause recovery, and finalizes through the
//! existing gear-comparison parser. Parallel to `server/streaming_top_gear.rs`
//! (which owns the LOCAL triage path). See the B2 design spec.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde_json::{json, Value};

use crate::compute::RunError;
use crate::db::cloud_chunks_repo::ChunkResultEnvelope;
use crate::db::{CloudChunksRepo, JobRepo};
use crate::profileset_generator::iterator::{ProfilesetIterator, ProfilesetIteratorConfig};

/// Per-job profileset ceiling for one Simmit chunk. The effective limit is "the
/// job completes within `limits.maxRuntimeSeconds`", which is EMPIRICAL — there
/// is no documented Simmit max-profileset/payload cap. Start conservative and
/// tune against real runs (see spec Risk #1). Treat as tunable, not load-bearing
/// correctness.
pub const REMOTE_MAX_PROFILESETS_PER_JOB: usize = 2_000;

/// Max concurrent in-flight Simmit chunk submissions. The effective bound is
/// `min(CONFIG_MAX_INFLIGHT, usage.limits.maxActiveJobs)`. Conservative default.
pub const CONFIG_MAX_INFLIGHT: usize = 4;

/// Folds per-chunk Simmit results into one SimC-shaped JSON document compatible
/// with `result_parser::parse_gear_comparison_result`. Small: one base actor +
/// N profileset result rows + a summed credits block — never N full JSON docs.
#[derive(Debug, Default)]
pub struct ChunkAccumulator {
    base_player: Option<Value>,
    profilesets: Vec<Value>,
    credits_consumed: u64,
}

impl ChunkAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Fold one chunk's envelope. `base_player` is taken from the FIRST chunk
    /// that carries one (chunk 0). Profileset rows are concatenated in arrival
    /// order; the final `parse_gear_comparison_result` re-sorts by DPS, so order
    /// here is irrelevant to the ranking.
    pub fn add_envelope(&mut self, env: ChunkResultEnvelope, credits: u64) {
        if self.base_player.is_none() {
            if let Some(bp) = env.base_player {
                self.base_player = Some(bp);
            }
        }
        self.profilesets.extend(env.profilesets);
        self.credits_consumed = self.credits_consumed.saturating_add(credits);
    }

    /// Extract a chunk's envelope from a raw adapted Simmit `SimcOutput.json`
    /// (the `simmit_result_to_simc_output` / artifact shape). `include_base`
    /// should be true ONLY for chunk 0.
    pub fn envelope_from_simc_json(json: &Value, include_base: bool) -> ChunkResultEnvelope {
        let sim = json.get("sim");
        let profilesets = sim
            .and_then(|s| s.get("profilesets"))
            .and_then(|p| p.get("results"))
            .and_then(|r| r.as_array())
            .cloned()
            .unwrap_or_default();
        let base_player = if include_base {
            sim.and_then(|s| s.get("players"))
                .and_then(|p| p.as_array())
                .and_then(|arr| arr.first())
                .cloned()
        } else {
            None
        };
        ChunkResultEnvelope { profilesets, base_player }
    }

    /// Pull a chunk's credits from its adapted Simmit JSON
    /// (`simmit.credits_consumed`).
    pub fn credits_from_simc_json(json: &Value) -> u64 {
        json.get("simmit")
            .and_then(|m| m.get("credits_consumed"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0)
    }

    /// Produce the merged SimC-shaped JSON for `parse_gear_comparison_result`.
    pub fn into_merged_simc_json(self) -> Value {
        let base_player = self.base_player.unwrap_or_else(|| {
            json!({
                "name": "",
                "collected_data": { "dps": { "mean": 0.0, "mean_std_dev": 0.0, "std_dev": 0.0 } }
            })
        });
        json!({
            "sim": {
                "players": [base_player],
                "profilesets": { "results": self.profilesets },
            },
            "simmit": { "credits_consumed": self.credits_consumed }
        })
    }
}

// ── Chunk-runner abstraction (the Simmit-mock boundary) ──────────────────────

/// One chunk's submission payload, handed to the [`ChunkRunner`]. The runner is
/// the ONLY place that talks to Simmit (or, in tests, a fake) — the rest of the
/// orchestrator is HTTP-free and unit-testable.
#[derive(Debug, Clone)]
pub struct ChunkRequest {
    pub chunk_idx: usize,
    pub job_id: String,
    /// `"# Base Actor\n<base>\n<profileset lines>"`.
    pub simc_input: String,
    pub profileset_count: usize,
}

/// Async boundary the orchestrator submits chunks through. Returns the adapted
/// **SimC-shaped JSON** for the chunk so the orchestrator stays Simmit-agnostic
/// and the [`ChunkAccumulator`] helpers consume it directly. In production this
/// wraps `SimmitProvider::submit_chunk_for_id` + `poll_and_fetch_chunk` (and
/// records `remote_job_id` to `cloud_chunks`); in tests it returns canned JSON.
///
/// `futures::future::BoxFuture` is NOT a workspace dependency, so this spells out
/// the boxed future directly with `Pin<Box<dyn Future + Send>>`.
pub type ChunkRunner = Arc<
    dyn Fn(ChunkRequest) -> Pin<Box<dyn Future<Output = Result<Value, RunError>> + Send>>
        + Send
        + Sync,
>;

// ── Chunk generation ─────────────────────────────────────────────────────────

/// One generated chunk: the combined simc input + the per-combo metadata rows
/// (to persist to `ComboMetadataRepo`, exactly as local triage does) + the
/// profileset count, plus the iterator cursor AFTER this chunk (for checkpoint).
pub struct GeneratedChunk {
    pub combined_input: String,
    /// `(combo_name, metadata_json)` pairs, ordered, for `combo_metadata`.
    pub metadata: Vec<(String, String)>,
    pub profileset_count: usize,
    pub cursor_after: Vec<usize>,
    /// `true` when the iterator yielded `None` before hitting `ceiling` — i.e.
    /// the whole product space fit in this chunk (the single-chunk fast path).
    pub exhausted: bool,
}

/// Pull up to `ceiling` candidates from the iterator into one chunk. Drops the
/// in-memory lines into the returned strings; peak memory = one chunk.
///
/// Profileset NAMES are GLOBAL across the iterator (`Combo 1, Combo 2, …` never
/// reset per chunk), so merged `sim.profilesets.results` never collides and the
/// metadata join stays stable. `next()` already skips the baseline + illegal
/// sets, so `profileset_count` counts REAL emitted profilesets and `cursor()`
/// after the loop is the resume point.
pub fn build_chunk(
    it: &mut ProfilesetIterator,
    base_profile: &str,
    ceiling: usize,
) -> GeneratedChunk {
    let mut lines: Vec<String> = Vec::new();
    let mut metadata: Vec<(String, String)> = Vec::new();
    let mut count = 0usize;
    // Assume exhaustion until the iterator proves otherwise by filling the chunk.
    let mut exhausted = true;
    while count < ceiling {
        match it.next() {
            Some(c) => {
                lines.push(c.profileset_simc);
                metadata.push((
                    c.profileset_name,
                    serde_json::to_string(&c.metadata).unwrap_or_else(|_| "[]".into()),
                ));
                count += 1;
                // If we just filled the chunk, the stream may still have more;
                // the caller's next build_chunk detects true end-of-stream.
                if count >= ceiling {
                    exhausted = false;
                }
            }
            None => {
                exhausted = true;
                break;
            }
        }
    }
    let combined_input = format!("# Base Actor\n{}\n{}", base_profile, lines.join("\n"));
    GeneratedChunk {
        combined_input,
        metadata,
        profileset_count: count,
        cursor_after: it.cursor().to_vec(),
        exhausted,
    }
}

// ── Orchestration core (single-chunk fast path) ──────────────────────────────

/// The testable orchestration core. Holds injected dependencies so the chunking,
/// submission, accumulation, and finalize logic is driven without HTTP or
/// `tokio::spawn`. Task 7 implements the SINGLE-CHUNK fast path; Task 8 extends
/// `execute` to multi-chunk bounded concurrency.
pub struct CloudStreamingRun {
    pub repo: JobRepo,
    /// Pool backing `cloud_chunks` + `combo_metadata` (the streaming path
    /// requires SQLite storage, like local triage).
    pub pool: sqlx::AnyPool,
    pub iter_cfg: ProfilesetIteratorConfig,
    pub base_profile: String,
    pub job_id: String,
    /// Wire sim-type string ("top_gear"), stamped into the parsed result.
    pub sim_type: String,
    /// Profilesets-per-chunk ceiling for this run.
    pub ceiling: usize,
}

impl CloudStreamingRun {
    /// Drive the run to a terminal state. For Task 7 this handles the common
    /// "whole set fits in one chunk" case: build one chunk, persist combo
    /// metadata + a `cloud_chunks` row, submit once via `runner`, accumulate,
    /// and finalize through the gear-comparison parser. Multi-chunk concurrency
    /// is Task 8.
    pub async fn execute(self, runner: ChunkRunner) {
        let cloud_repo = CloudChunksRepo::new(self.pool.clone());
        let mut it = ProfilesetIterator::new(self.iter_cfg);

        let chunk = build_chunk(&mut it, &self.base_profile, self.ceiling);

        if chunk.profileset_count == 0 {
            let _ = self
                .repo
                .set_error(
                    &self.job_id,
                    "No gear combinations to sim; nothing to submit.",
                )
                .await;
            return;
        }

        // Persist per-combo metadata (combo_id = running index, 1-based) so the
        // finalize parse can join names → metadata, exactly as local triage.
        super::helpers::write_combo_metadata_table_raw(&self.repo, &self.job_id, &chunk.metadata)
            .await;

        // Record the chunk row before submission (the crash-recovery oracle).
        if let Err(e) = cloud_repo
            .insert_pending(&self.job_id, 0, chunk.profileset_count as i64)
            .await
        {
            let _ = self
                .repo
                .set_error(&self.job_id, &format!("Failed to record chunk: {e}"))
                .await;
            return;
        }

        let req = ChunkRequest {
            chunk_idx: 0,
            job_id: self.job_id.clone(),
            simc_input: chunk.combined_input,
            profileset_count: chunk.profileset_count,
        };

        // The production runner records `remote_job_id` itself before returning;
        // the fake runner exposes none, so mark_submitted carries an empty id.
        let now = chrono::Utc::now().to_rfc3339();
        let _ = cloud_repo
            .mark_submitted(&self.job_id, 0, "", &now)
            .await;

        let result = runner(req).await;

        let chunk_json = match result {
            Ok(json) => json,
            Err(RunError::Paused) | Err(RunError::Cancelled) => {
                // Terminal state already set elsewhere; nothing to finalize.
                return;
            }
            Err(RunError::Other(e)) => {
                let _ = cloud_repo.mark_failed(&self.job_id, 0).await;
                let _ = self.repo.set_error(&self.job_id, &e).await;
                return;
            }
        };

        let envelope = ChunkAccumulator::envelope_from_simc_json(&chunk_json, /*include_base=*/ true);
        let credits = ChunkAccumulator::credits_from_simc_json(&chunk_json);

        let completed_at = chrono::Utc::now().to_rfc3339();
        let _ = cloud_repo
            .mark_completed(&self.job_id, 0, &envelope, &completed_at)
            .await;

        let mut acc = ChunkAccumulator::new();
        acc.add_envelope(envelope, credits);

        // Single chunk → reports stay normal (the runner returns no html/text in
        // this path anyway). `reports_merged` is only meaningful for >1 chunk.
        let reports_merged = false;
        let merged = acc.into_merged_simc_json();
        finalize_cloud_result(
            &self.repo,
            &self.job_id,
            &merged,
            &self.base_profile,
            &self.sim_type,
            reports_merged,
        )
        .await;
    }
}

/// Finalize the MERGED cloud result through the gear-comparison parser. Mirrors
/// `helpers::finalize_gear_comparison_result` but consumes the pre-merged JSON
/// (not a single `SimcOutput`). There is no single `simc_input` for the cloud
/// path, so realm extraction reads the `base_profile` (it carries the actor
/// line). When `reports_merged` is true (multi-chunk), per-chunk HTML/text
/// reports are dropped (`set_report_files(None, None)`) and the flag is stamped
/// into the parsed result.
pub async fn finalize_cloud_result(
    repo: &JobRepo,
    job_id: &str,
    merged_json: &Value,
    base_profile: &str,
    sim_type: &str,
    reports_merged: bool,
) {
    let job_snap = repo.get(job_id).await.ok().flatten();
    let raw_meta = super::helpers::load_combo_metadata(repo, job_id).await;
    let meta = if raw_meta.is_empty() {
        None
    } else {
        Some(raw_meta)
    };

    let mut parsed =
        crate::result_parser::parse_gear_comparison_result(merged_json, meta.as_ref(), sim_type);
    super::helpers::inject_realm(&mut parsed, base_profile);
    if let Some(ref snap) = job_snap {
        super::helpers::inject_total_elapsed(&mut parsed, &snap.created_at);
    }
    if reports_merged {
        parsed["reports_merged"] = json!(true);
    }

    let result_str = serde_json::to_string(&parsed).unwrap_or_default();
    let raw_str = serde_json::to_string(merged_json).ok();
    if let Err(e) = repo.set_result(job_id, &result_str, raw_str.as_deref()).await {
        eprintln!("[{job_id}] Failed to set result: {e}");
    }
    if reports_merged {
        if let Err(e) = repo.set_report_files(job_id, None, None).await {
            eprintln!("[{job_id}] Failed to clear merged report files: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn chunk_json(base_name: &str, base_dps: f64, rows: &[(&str, f64)]) -> Value {
        let results: Vec<Value> = rows
            .iter()
            .map(|(n, d)| json!({ "name": n, "mean": d }))
            .collect();
        json!({
            "sim": {
                "players": [{
                    "name": base_name,
                    "collected_data": { "dps": { "mean": base_dps, "mean_std_dev": 0.0 } }
                }],
                "profilesets": { "results": results }
            },
            "simmit": { "credits_consumed": 100 }
        })
    }

    #[test]
    fn merges_two_chunks_into_parseable_doc() {
        let c0 = chunk_json("Hero", 1000.0, &[("Combo 1", 1100.0), ("Combo 2", 1050.0)]);
        let c1 = chunk_json("Hero", 1000.0, &[("Combo 3", 1200.0), ("Combo 4", 900.0)]);

        let mut acc = ChunkAccumulator::new();
        acc.add_envelope(
            ChunkAccumulator::envelope_from_simc_json(&c0, true),
            ChunkAccumulator::credits_from_simc_json(&c0),
        );
        acc.add_envelope(
            ChunkAccumulator::envelope_from_simc_json(&c1, false),
            ChunkAccumulator::credits_from_simc_json(&c1),
        );
        let merged = acc.into_merged_simc_json();

        // base_player from chunk 0; 4 profilesets total; credits summed.
        assert_eq!(merged["sim"]["players"][0]["name"], "Hero");
        assert_eq!(merged["sim"]["profilesets"]["results"].as_array().unwrap().len(), 4);
        assert_eq!(merged["simmit"]["credits_consumed"], 200);

        // The merged doc parses, and the top row is the global best (Combo 3).
        let meta: HashMap<String, Vec<Value>> = HashMap::new();
        let parsed = crate::result_parser::parse_gear_comparison_result(&merged, Some(&meta), "top_gear");
        assert_eq!(parsed["base_dps"], 1000.0);
        let results = parsed["results"].as_array().unwrap();
        // results includes the baseline ("Currently Equipped") row + 4 combos,
        // sorted DESC by dps. The first non-baseline top entry is Combo 3 @1200.
        let top = results.iter().find(|r| r["name"] == "Combo 3").unwrap();
        assert_eq!(top["dps"], 1200.0);
        assert_eq!(top["delta"], 200.0);
    }

    #[test]
    fn merged_topn_equals_single_job_equivalent() {
        // A single job that simmed all 4 combos would produce this doc:
        let single = chunk_json(
            "Hero", 1000.0,
            &[("Combo 1", 1100.0), ("Combo 2", 1050.0), ("Combo 3", 1200.0), ("Combo 4", 900.0)],
        );
        let meta: HashMap<String, Vec<Value>> = HashMap::new();
        let single_parsed =
            crate::result_parser::parse_gear_comparison_result(&single, Some(&meta), "top_gear");

        // The two-chunk merge from the previous test, recomputed:
        let c0 = chunk_json("Hero", 1000.0, &[("Combo 1", 1100.0), ("Combo 2", 1050.0)]);
        let c1 = chunk_json("Hero", 1000.0, &[("Combo 3", 1200.0), ("Combo 4", 900.0)]);
        let mut acc = ChunkAccumulator::new();
        acc.add_envelope(ChunkAccumulator::envelope_from_simc_json(&c0, true), 0);
        acc.add_envelope(ChunkAccumulator::envelope_from_simc_json(&c1, false), 0);
        let merged_parsed = crate::result_parser::parse_gear_comparison_result(
            &acc.into_merged_simc_json(), Some(&meta), "top_gear",
        );

        // Top-N (name + dps order) must be identical.
        let names = |v: &Value| -> Vec<String> {
            v["results"].as_array().unwrap().iter()
                .map(|r| r["name"].as_str().unwrap().to_string()).collect()
        };
        assert_eq!(names(&single_parsed), names(&merged_parsed));
        assert_eq!(single_parsed["base_dps"], merged_parsed["base_dps"]);
    }

    #[test]
    fn base_player_taken_from_chunk_0_only() {
        // chunk 0 has base "Hero A", chunk 1 has base "Hero B"
        // The accumulated result should use "Hero A" (chunk 0's base).
        let c0 = chunk_json("Hero A", 1000.0, &[("Combo 1", 1100.0)]);
        let c1 = chunk_json("Hero B", 1000.0, &[("Combo 2", 1050.0)]);

        let mut acc = ChunkAccumulator::new();
        acc.add_envelope(ChunkAccumulator::envelope_from_simc_json(&c0, true), 0);
        acc.add_envelope(ChunkAccumulator::envelope_from_simc_json(&c1, false), 0);
        let merged = acc.into_merged_simc_json();

        assert_eq!(merged["sim"]["players"][0]["name"], "Hero A");
    }

    #[test]
    fn credits_summed_across_chunks() {
        let c0 = chunk_json("Hero", 1000.0, &[("Combo 1", 1100.0)]);
        let c1 = chunk_json("Hero", 1000.0, &[("Combo 2", 1050.0)]);
        let c2 = chunk_json("Hero", 1000.0, &[("Combo 3", 900.0)]);

        let mut acc = ChunkAccumulator::new();
        acc.add_envelope(
            ChunkAccumulator::envelope_from_simc_json(&c0, true),
            ChunkAccumulator::credits_from_simc_json(&c0),
        );
        acc.add_envelope(
            ChunkAccumulator::envelope_from_simc_json(&c1, false),
            ChunkAccumulator::credits_from_simc_json(&c1),
        );
        acc.add_envelope(
            ChunkAccumulator::envelope_from_simc_json(&c2, false),
            ChunkAccumulator::credits_from_simc_json(&c2),
        );
        let merged = acc.into_merged_simc_json();

        // Each chunk_json has credits_consumed=100, so total should be 300.
        assert_eq!(merged["simmit"]["credits_consumed"], 300);
    }
}

#[cfg(test)]
mod orchestrator_tests {
    use super::*;
    use crate::profileset_generator::iterator::{
        GemCombosResolver, ProfilesetIteratorConfig,
    };
    use std::collections::{HashMap, HashSet};
    use std::sync::Mutex;

    async fn pool() -> sqlx::AnyPool {
        sqlx::any::install_default_drivers();
        crate::db::Database::connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite")
            .pool
    }

    fn arc_item(id: u64, slot: &str, equipped: bool) -> std::sync::Arc<Value> {
        std::sync::Arc::new(json!({
            "item_id": id,
            "slot": slot,
            "simc_string": format!(",id={}", id),
            "is_equipped": equipped,
            "sockets": 0,
            "bonus_ids": [],
            "enchant_id": 0,
            "gem_id": 0,
            "ilevel": 0,
            "name": format!("Item {}", id),
            "origin": "bags",
        }))
    }

    /// A single varying gear slot (equipped + one alternative). The iterator
    /// skips the all-equipped baseline, so this yields exactly ONE real
    /// profileset ("Combo 1") — well under the ceiling, exercising the
    /// single-chunk fast path.
    fn one_combo_cfg() -> ProfilesetIteratorConfig {
        let mut slot_item_lists = HashMap::new();
        slot_item_lists.insert(
            "head".to_string(),
            vec![arc_item(100, "head", true), arc_item(200, "head", false)],
        );
        ProfilesetIteratorConfig {
            spec: "mistweaver".to_string(),
            base_profile: std::sync::Arc::from(""),
            slot_item_lists,
            varying_slots: vec!["head".to_string()],
            enchant_axes: vec![],
            gem_combo_count: 0,
            gem_combos_resolver: GemCombosResolver::new(vec![]),
            socketed_item_ids: HashSet::new(),
            talent_builds: vec![],
            max_catalyst_charges: None,
        }
    }

    /// A fake chunk-runner that records the requests it received and returns
    /// canned SimC-shaped JSON for two combos — NO network.
    fn fake_runner(calls: std::sync::Arc<Mutex<Vec<ChunkRequest>>>) -> ChunkRunner {
        std::sync::Arc::new(move |req: ChunkRequest| {
            calls.lock().unwrap().push(req.clone());
            let idx = req.chunk_idx;
            Box::pin(async move {
                Ok(json!({
                    "sim": {
                        "players": [{
                            "name": "Hero",
                            "collected_data": { "dps": { "mean": 1000.0, "mean_std_dev": 0.0 } }
                        }],
                        "profilesets": { "results": [
                            { "name": format!("Combo {}", idx * 2 + 1), "mean": 1100.0 + idx as f64 },
                            { "name": format!("Combo {}", idx * 2 + 2), "mean": 1050.0 + idx as f64 },
                        ]}
                    },
                    "simmit": { "credits_consumed": 100 }
                }))
            }) as Pin<Box<dyn Future<Output = Result<Value, RunError>> + Send>>
        })
    }

    #[tokio::test]
    async fn single_chunk_run_accumulates_and_finalizes() {
        let pool = pool().await;
        let repo = JobRepo::new(pool.clone());

        // Insert a streamed top_gear job so finalize can read created_at and
        // set_result has a row to update.
        let mut job = crate::models::Job::new_with_provider(
            String::new(),
            "top_gear".to_string(),
            100,
            "patchwerk".to_string(),
            0.1,
            "simmit".to_string(),
        );
        job.simc_input_mode = crate::models::SimcInputMode::Streamed;
        let job_id = job.id.clone();
        repo.insert(&job).await.unwrap();

        let calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let runner = fake_runner(calls.clone());

        let run = CloudStreamingRun {
            repo: repo.clone(),
            pool: pool.clone(),
            iter_cfg: one_combo_cfg(),
            base_profile: "server=tichondrius\nregion=us".to_string(),
            job_id: job_id.clone(),
            sim_type: "top_gear".to_string(),
            ceiling: REMOTE_MAX_PROFILESETS_PER_JOB,
        };
        run.execute(runner).await;

        // (a) Exactly ONE chunk submitted (single-chunk fast path).
        let recorded = calls.lock().unwrap();
        assert_eq!(recorded.len(), 1, "expected exactly one chunk submission");
        assert_eq!(recorded[0].chunk_idx, 0);
        assert_eq!(recorded[0].job_id, job_id);
        assert_eq!(recorded[0].profileset_count, 1);
        assert!(
            recorded[0].simc_input.contains("# Base Actor"),
            "chunk input must carry the base-actor header: {}",
            recorded[0].simc_input
        );
        drop(recorded);

        // The cloud_chunks row is recorded + completed (never re-billed).
        let cloud_repo = CloudChunksRepo::new(pool.clone());
        let rows = cloud_repo.list_for_job(&job_id).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, "completed");
        assert_eq!(rows[0].profileset_count, 1);

        // (b) The finalized job result_json is the merged-parsed doc with the
        // expected combos from the fake runner.
        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(finished.status, crate::models::JobStatus::Done);
        let result: Value =
            serde_json::from_str(finished.result_json.as_deref().unwrap()).unwrap();
        assert_eq!(result["base_dps"], 1000.0);
        // Realm came from the base_profile (no single simc_input on cloud path).
        assert_eq!(result["realm"], "tichondrius");
        let names: Vec<String> = result["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["name"].as_str().unwrap().to_string())
            .collect();
        assert!(names.iter().any(|n| n == "Combo 1"), "names: {names:?}");
        assert!(names.iter().any(|n| n == "Combo 2"), "names: {names:?}");
    }

    #[tokio::test]
    async fn empty_workload_finalizes_with_error_and_submits_nothing() {
        let pool = pool().await;
        let repo = JobRepo::new(pool.clone());
        let job = crate::models::Job::new_with_provider(
            String::new(),
            "top_gear".to_string(),
            100,
            "patchwerk".to_string(),
            0.1,
            "simmit".to_string(),
        );
        let job_id = job.id.clone();
        repo.insert(&job).await.unwrap();

        let calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let runner = fake_runner(calls.clone());

        // An iterator config with NO varying axes yields zero candidates.
        let empty_cfg = ProfilesetIteratorConfig {
            spec: "mistweaver".to_string(),
            base_profile: std::sync::Arc::from(""),
            slot_item_lists: HashMap::new(),
            varying_slots: vec![],
            enchant_axes: vec![],
            gem_combo_count: 0,
            gem_combos_resolver: GemCombosResolver::new(vec![]),
            socketed_item_ids: HashSet::new(),
            talent_builds: vec![],
            max_catalyst_charges: None,
        };

        let run = CloudStreamingRun {
            repo: repo.clone(),
            pool: pool.clone(),
            iter_cfg: empty_cfg,
            base_profile: String::new(),
            job_id: job_id.clone(),
            sim_type: "top_gear".to_string(),
            ceiling: REMOTE_MAX_PROFILESETS_PER_JOB,
        };
        run.execute(runner).await;

        assert_eq!(calls.lock().unwrap().len(), 0, "no chunk should be submitted");
        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(finished.status, crate::models::JobStatus::Failed);
    }
}
