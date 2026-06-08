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

use crate::cancel::CancelToken;
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
        ChunkResultEnvelope { profilesets, base_player, credits: 0 }
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
    /// Read by the fake test runners (assertions); the production Simmit runner
    /// submits by `simc_input` text, so this is informational on that path.
    #[allow(dead_code)]
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

/// Submit-time affordability re-check. The FE `cloud-estimate` is advisory; the
/// orchestrator re-validates authoritatively BEFORE the first chunk submits.
/// Injected (like [`ChunkRunner`]) so the orchestrator core stays HTTP-free and
/// unit-testable with a fake — production wraps `provider.test_credential` +
/// `get_usage`. Returns the account's currently-available credits:
/// `Ok(Some(n))` to gate against `est_credits_needed`, `Ok(None)` when the
/// provider reports no credit concept / unknown limit (treated as affordable),
/// `Err` on a fetch failure (treated as fatal — we cannot confirm affordability).
pub type AffordabilityCheck =
    Arc<dyn Fn() -> Pin<Box<dyn Future<Output = Result<Option<u64>, String>> + Send>> + Send + Sync>;

// ── Chunk generation ─────────────────────────────────────────────────────────

/// One generated chunk: the combined simc input + the per-combo metadata rows
/// (to persist to `ComboMetadataRepo`, exactly as local triage does) + the
/// profileset count. The checkpoint reads the iterator cursor directly via
/// `it.cursor()` at the generation boundary, so this struct carries no cursor.
pub struct GeneratedChunk {
    /// The individual `profileset."Combo N"+=...` lines for this chunk, in
    /// generation order. Kept so a `timed_out`/errored chunk can be SPLIT into
    /// smaller sub-chunks (same lines, same names, same `target_error`) on retry
    /// without re-running the iterator or rewriting any combo-metadata rows.
    pub profileset_lines: Vec<String>,
    /// `(combo_name, metadata_json)` pairs, ordered, for `combo_metadata`.
    pub metadata: Vec<(String, String)>,
    pub profileset_count: usize,
    /// The global `Combo N` index of this chunk's FIRST emitted profileset
    /// (`it.next_name_idx()` captured before the iterator advanced). The chunk
    /// covers the contiguous range `[first_name_idx, first_name_idx + profileset_count)`,
    /// persisted as `cloud_chunks.first_combo_name_idx` so resume can prove
    /// coverage.
    pub first_name_idx: usize,
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
    // The base actor is recombined per (sub-)chunk at submit time via
    // `combine_chunk_input`, so generation only needs the profileset lines.
    _base_profile: &str,
    ceiling: usize,
) -> GeneratedChunk {
    // Capture the global name index BEFORE pulling any candidate: this chunk's
    // first emitted profileset is `Combo {first_name_idx}`. Names are contiguous
    // (next_name_idx increments once per emitted candidate), so the chunk covers
    // `[first_name_idx, first_name_idx + count)`.
    let first_name_idx = it.next_name_idx();
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
    GeneratedChunk {
        profileset_lines: lines,
        metadata,
        profileset_count: count,
        first_name_idx,
        exhausted,
    }
}

/// Move the iterator onto a blocking thread, build one chunk, and move it back.
/// The CPU-bound iterator walk must not block the async executor.
async fn run_build_chunk_blocking(
    it: ProfilesetIterator,
    base_profile: String,
    ceiling: usize,
) -> (ProfilesetIterator, GeneratedChunk) {
    tokio::task::spawn_blocking(move || {
        let mut it = it;
        let chunk = build_chunk(&mut it, &base_profile, ceiling);
        (it, chunk)
    })
    .await
    .expect("build_chunk task panicked")
}

/// Assemble a chunk's COMPLETE submitted simc input: the base actor + its
/// profileset lines, run through `build_simc_input_from_options` so the
/// `# Simulation Options` section (target_error, iterations, fight_style,
/// desired_targets, max_time, consumables, …) is present — exactly like every
/// other Simmit submission (quick sim / eager profilesets / local staged
/// handoff). Submitting WITHOUT this section fails on Simmit: chunks go up with
/// `multiStage:true`, which needs a `target_error` to tune toward, so a bare
/// `# Base Actor` + profilesets is rejected regardless of chunk size.
///
/// Single source of truth for the chunk wire format, shared by `build_chunk` and
/// the retry sub-chunk splitter so a split sub-chunk is byte-for-byte the same
/// shape as a freshly generated chunk.
pub fn combine_chunk_input(base_profile: &str, lines: &[String], options: &Value) -> String {
    let combined = format!("# Base Actor\n{}\n{}", base_profile, lines.join("\n"));
    crate::simc_runner::build_simc_input_from_options(&combined, options)
}

/// In-flight concurrency bound K from the account's `max_active_jobs` and the
/// config ceiling. A `0` account limit (quota exhausted/suspended) has NO
/// capacity and must reject the run up front — returning `Err(())` so the
/// caller can fail cleanly rather than silently clamping to 1 and submitting a
/// chunk Simmit will reject per-chunk.
fn inflight_bound(account_max_active: usize, config_max: usize) -> Result<usize, ()> {
    if account_max_active == 0 {
        return Err(());
    }
    Ok(account_max_active.min(config_max).max(1))
}

// ── Retry-by-subchunk ────────────────────────────────────────────────────────

/// Outcome of running ONE logical chunk through the runner with a single round
/// of split-retry on failure.
enum ChunkOutcome {
    /// One or more `(execution_chunk_idx, adapted_json)` results to fold. A
    /// retried chunk yields its sub-chunks' results; an un-retried chunk yields
    /// one. The accumulator merges by profileset NAME, so which `cloud_chunks`
    /// row produced a row is irrelevant to the ranking.
    Done(Vec<(usize, Value)>),
    /// A clean terminal abort (Paused / Cancelled) — status already set
    /// elsewhere; the orchestrator must stop without writing an error.
    Terminal,
    /// The chunk (and its retry, if any) failed; the message names the chunk.
    Failed(String),
}

/// Run ONE logical chunk through `runner`, retrying ONCE on an errored/timed_out
/// chunk by SPLITTING it into two smaller sub-chunks at the SAME `target_error`
/// (the lines carry no target_error; nothing is loosened) — NEVER by degrading
/// precision. Sub-chunks keep the original `Combo N` names (the lines are moved
/// verbatim), so the merge join and the existing `combo_metadata` rows stay
/// stable; each sub-chunk only gets its OWN `cloud_chunks` execution row,
/// allocated at the tail via `next_chunk_idx`. A sub-chunk that still fails
/// (including the minimal 1-profileset floor that cannot split) fails the whole
/// sim cleanly, naming the original chunk.
#[allow(clippy::too_many_arguments)]
async fn run_chunk_with_retry(
    runner: &ChunkRunner,
    cloud_repo: &CloudChunksRepo,
    job_id: &str,
    base_profile: &str,
    options: &Value,
    chunk_idx: usize,
    profileset_lines: &[String],
    profileset_count: usize,
    parent_first_name_idx: usize,
    next_chunk_idx: &std::sync::atomic::AtomicUsize,
) -> ChunkOutcome {
    let req = ChunkRequest {
        chunk_idx,
        job_id: job_id.to_string(),
        simc_input: combine_chunk_input(base_profile, profileset_lines, options),
        profileset_count,
    };
    match runner(req).await {
        Ok(json) => ChunkOutcome::Done(vec![(chunk_idx, json)]),
        Err(RunError::Paused) | Err(RunError::Cancelled) => ChunkOutcome::Terminal,
        Err(RunError::Other(e)) => {
            // First failure: flip the original chunk's row to failed and try a
            // single split-retry round.
            let _ = cloud_repo.mark_failed(job_id, chunk_idx as i64).await;

            // A minimal chunk cannot be split smaller → fail naming the chunk AND
            // surfacing the underlying Simmit error (never swallow the cause).
            if profileset_lines.len() <= 1 {
                return ChunkOutcome::Failed(format!(
                    "Cloud chunk {chunk_idx} failed at minimal size (cannot split \
                     further without loosening target_error). Simmit error: {e}"
                ));
            }

            // Split the lines in half — SAME target_error, SAME combo names.
            let mid = profileset_lines.len() / 2;
            let halves = [&profileset_lines[..mid], &profileset_lines[mid..]];

            use std::sync::atomic::Ordering;
            let mut results: Vec<(usize, Value)> = Vec::new();
            // Cumulative name offset within the parent's contiguous range: the
            // first half starts at the parent's first name idx; the second starts
            // `mid` names later (each half is a contiguous sub-range).
            let mut name_offset = 0usize;
            for half in halves {
                if half.is_empty() {
                    continue;
                }
                let sub_first_name_idx = parent_first_name_idx + name_offset;
                name_offset += half.len();
                // Allocate this sub-chunk's OWN execution row at the tail, linked
                // to the parent and carrying its sub-range start.
                let sub_idx = next_chunk_idx.fetch_add(1, Ordering::SeqCst);
                if cloud_repo
                    .insert_pending_with_lineage(
                        job_id,
                        sub_idx as i64,
                        half.len() as i64,
                        Some(chunk_idx as i64),
                        Some(sub_first_name_idx as i64),
                    )
                    .await
                    .is_err()
                {
                    return ChunkOutcome::Failed(format!(
                        "Cloud chunk {chunk_idx}: failed to record retry sub-chunk."
                    ));
                }
                let now = chrono::Utc::now().to_rfc3339();
                let _ = cloud_repo.mark_submitted(job_id, sub_idx as i64, "", &now).await;

                let sub_req = ChunkRequest {
                    chunk_idx: sub_idx,
                    job_id: job_id.to_string(),
                    simc_input: combine_chunk_input(base_profile, half, options),
                    profileset_count: half.len(),
                };
                match runner(sub_req).await {
                    Ok(json) => results.push((sub_idx, json)),
                    Err(RunError::Paused) | Err(RunError::Cancelled) => {
                        return ChunkOutcome::Terminal
                    }
                    Err(RunError::Other(e)) => {
                        let _ = cloud_repo.mark_failed(job_id, sub_idx as i64).await;
                        // One retry round only — a sub-chunk failure is terminal.
                        // Surface the underlying Simmit error so a size-independent
                        // failure (bad input, rate limit, auth) is diagnosable.
                        return ChunkOutcome::Failed(format!(
                            "Cloud chunk {chunk_idx} still failed after splitting into \
                             smaller sub-chunks at the same target_error. Simmit error: {e}"
                        ));
                    }
                }
            }
            ChunkOutcome::Done(results)
        }
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
    /// The request's sim options (`SimOptions::to_json()`). Injected into every
    /// chunk's input via `build_simc_input_from_options` so each chunk carries
    /// `target_error`/`iterations`/`fight_style`/… like every working Simmit path.
    pub options: Value,
    pub job_id: String,
    /// Wire sim-type string ("top_gear"), stamped into the parsed result.
    pub sim_type: String,
    /// Profilesets-per-chunk ceiling for this run.
    pub ceiling: usize,
    /// Per-account `usage.max_active_jobs` (from `get_usage`), if known. The
    /// in-flight concurrency bound is `min(CONFIG_MAX_INFLIGHT, this)`. `None`
    /// (unknown limit) falls back to `CONFIG_MAX_INFLIGHT`.
    pub max_active_jobs: Option<usize>,
    /// Cooperative cancellation token (DB-backed status is the source of truth).
    /// Checked at every chunk boundary; also propagated into each runner via the
    /// production chunk-runner so an in-flight Simmit job is aborted. `None`
    /// disables cancellation (tests that don't exercise it).
    pub cancel: Option<CancelToken>,
    /// Submit-time affordability gate. Run BEFORE the first chunk is submitted.
    /// `None` skips the gate (the estimate path already approved, or tests).
    pub affordability: Option<AffordabilityCheck>,
    /// The reservation estimate (credits) this run needs, computed by the caller
    /// via `cloud_estimate::est_credits` on the known combo count. Compared
    /// against the value [`AffordabilityCheck`] returns. `0` ⇒ no gate.
    pub est_credits_needed: u64,
}

impl CloudStreamingRun {
    /// Drive the run to a terminal state.
    ///
    /// Chunk GENERATION is sequential (one `&mut` iterator cursor); chunk
    /// SUBMISSION/COMPLETION is concurrent, bounded to
    /// `K = min(CONFIG_MAX_INFLIGHT, max_active_jobs)` in-flight runners via a
    /// [`tokio::task::JoinSet`]. The pattern is: generate chunk N → persist its
    /// metadata + `cloud_chunks` row → checkpoint the GENERATION cursor → spawn
    /// its runner (blocking generation while ≥ K are in flight) → as runners
    /// complete (in any order) fold into the [`ChunkAccumulator`]. When the
    /// whole product space fits in one chunk this collapses to the single-chunk
    /// fast path (no spawning).
    pub async fn execute(self, runner: ChunkRunner) {
        let cloud_repo = CloudChunksRepo::new(self.pool.clone());

        // ── Submit-time guards (BEFORE any chunk is generated/submitted). ────
        // Cancel that landed between job creation and execution: never submit.
        if self.is_cancelled().await {
            return;
        }
        // Authoritative affordability re-validation. The FE estimate is advisory;
        // if the account can no longer cover the reservation, FAIL cleanly with
        // ZERO chunks submitted (no metadata, no cloud_chunks rows).
        if let Err(msg) = self.check_affordable().await {
            let _ = self.repo.set_error(&self.job_id, &msg).await;
            return;
        }
        // A known `max_active_jobs == 0` (quota exhausted / account suspended)
        // has no concurrent-job capacity: reject up front rather than clamp to 1
        // and submit a chunk Simmit would reject per-chunk. An unknown limit
        // (`None`) is best-effort and falls back to the config ceiling.
        if self.max_active_jobs == Some(0) {
            let _ = self
                .repo
                .set_error(
                    &self.job_id,
                    "Account has no concurrent-job capacity (max active jobs is 0); \
                     cannot submit. Check the account's quota or status and retry.",
                )
                .await;
            return;
        }

        let it = ProfilesetIterator::new(self.iter_cfg.clone());

        // ── Generate the FIRST chunk (blocking CPU work off the async thread). ─
        let ceiling = self.ceiling;
        let (it, first) =
            run_build_chunk_blocking(it, self.base_profile.clone(), ceiling).await;

        if first.profileset_count == 0 {
            let _ = self
                .repo
                .set_error(
                    &self.job_id,
                    "No gear combinations to sim; nothing to submit.",
                )
                .await;
            return;
        }

        // ── Single-chunk fast path: the whole set fit in chunk 0. ────────────
        if first.exhausted {
            self.run_single_chunk(&cloud_repo, first, runner).await;
            return;
        }

        // ── Multi-chunk path: bounded-concurrency generate/submit loop. ──────
        self.run_multi_chunk(&cloud_repo, it, first, runner)
            .await;
    }

    /// The "whole set fits in one chunk" path: one submission, accumulate,
    /// finalize. `reports_merged` stays false UNLESS a retry split the chunk into
    /// sub-chunks (then there's no single authoritative report).
    async fn run_single_chunk(
        &self,
        cloud_repo: &CloudChunksRepo,
        chunk: GeneratedChunk,
        runner: ChunkRunner,
    ) {
        // Cancel that landed before submission: stop, write nothing.
        if self.is_cancelled().await {
            return;
        }

        super::helpers::write_combo_metadata_table_raw(
            &self.repo,
            &self.job_id,
            &chunk.metadata,
            &chunk.profileset_lines,
        )
        .await;

        // Record the chunk row before submission (the crash-recovery oracle).
        if let Err(e) = cloud_repo
            .insert_pending_with_lineage(
                &self.job_id,
                0,
                chunk.profileset_count as i64,
                None,
                Some(chunk.first_name_idx as i64),
            )
            .await
        {
            let _ = self
                .repo
                .set_error(&self.job_id, &format!("Failed to record chunk: {e}"))
                .await;
            return;
        }

        // The production runner records `remote_job_id` itself before returning;
        // the fake runner exposes none, so mark_submitted carries an empty id.
        let now = chrono::Utc::now().to_rfc3339();
        let _ = cloud_repo.mark_submitted(&self.job_id, 0, "", &now).await;

        // Retry-by-subchunk: a `next_chunk_idx` allocator that starts past this
        // chunk so any split sub-chunks get fresh tail execution rows.
        let next_idx = std::sync::atomic::AtomicUsize::new(1);
        let outcome = run_chunk_with_retry(
            &runner,
            cloud_repo,
            &self.job_id,
            &self.base_profile,
            &self.options,
            0,
            &chunk.profileset_lines,
            chunk.profileset_count,
            chunk.first_name_idx,
            &next_idx,
        )
        .await;

        let results = match outcome {
            ChunkOutcome::Done(r) => r,
            ChunkOutcome::Terminal => return,
            ChunkOutcome::Failed(msg) => {
                let _ = self.repo.set_error(&self.job_id, &msg).await;
                return;
            }
        };

        let mut acc = ChunkAccumulator::new();
        for (i, (idx, chunk_json)) in results.iter().enumerate() {
            // Take the base actor from the FIRST result only (chunk 0 or, if it
            // split, its first sub-chunk — both carry the same base actor).
            let include_base = i == 0;
            let mut envelope =
                ChunkAccumulator::envelope_from_simc_json(chunk_json, include_base);
            let credits = ChunkAccumulator::credits_from_simc_json(chunk_json);
            envelope.credits = credits;
            let completed_at = chrono::Utc::now().to_rfc3339();
            let _ = cloud_repo
                .mark_completed(&self.job_id, *idx as i64, &envelope, &completed_at)
                .await;
            acc.add_envelope(envelope, credits);
        }

        // A retry that split the chunk yields >1 result ⇒ no single report.
        let multi_chunk = results.len() > 1;
        let mut merged = acc.into_merged_simc_json();
        // Carry the run options so the parser reads real target_error /
        // desired_targets / max_time instead of its zero defaults — the bare
        // merge omits `sim.options`, which left target_error showing 0.0%.
        merged["sim"]["options"] = self.options.clone();
        finalize_cloud_result(
            &self.repo,
            &self.job_id,
            &merged,
            &self.base_profile,
            &self.sim_type,
            multi_chunk,
        )
        .await;
    }

    /// The multi-chunk path: sequential generation interleaved with bounded
    /// concurrent submission. `first` is the already-generated chunk 0 (which the
    /// caller confirmed is NOT the last chunk).
    async fn run_multi_chunk(
        &self,
        cloud_repo: &CloudChunksRepo,
        it: ProfilesetIterator,
        first: GeneratedChunk,
        runner: ChunkRunner,
    ) {
        // Fresh run: empty accumulator, allocator + combo ids start at 0, and the
        // already-generated chunk 0 is the first pending chunk.
        self.run_chunk_loop(
            cloud_repo,
            it,
            runner,
            ChunkAccumulator::new(),
            /*start_chunk_idx=*/ 0,
            /*combo_id_base=*/ 0,
            Some(first),
            /*resume_guard=*/ false,
        )
        .await;
    }

    /// The shared chunked submit/merge loop, used by BOTH the fresh multi-chunk
    /// path and `resume_cloud_streaming`. The caller pre-seeds:
    /// - `acc`: an accumulator already folded with any completed/re-polled chunks
    ///   (empty for a fresh run),
    /// - `start_chunk_idx`: the next `cloud_chunks.chunk_idx` to allocate (0 fresh;
    ///   the checkpoint's `next_chunk_idx` on resume),
    /// - `combo_id_base`: the running `combo_metadata.combo_id` offset so ids stay
    ///   globally unique across already-persisted chunks,
    /// - `pending`: an optional already-generated first chunk (fresh run only; on
    ///   resume this is `None` and generation pulls straight from the sought
    ///   iterator).
    ///
    /// The iterator MUST already be positioned (fresh: `new`; resume: `new` +
    /// `seek` + `set_next_name_idx`) so generation continues with non-colliding
    /// `Combo N` names. Concurrency, retry, cancel, pause, checkpoint and finalize
    /// are identical on both paths — there is no parallel orchestration copy.
    #[allow(clippy::too_many_arguments)]
    async fn run_chunk_loop(
        &self,
        cloud_repo: &CloudChunksRepo,
        mut it: ProfilesetIterator,
        runner: ChunkRunner,
        seed_acc: ChunkAccumulator,
        start_chunk_idx: usize,
        start_combo_id_base: i64,
        first: Option<GeneratedChunk>,
        // `true` on the RESUME path: before finalizing Done, recompute provable
        // coverage over the reconciled `cloud_chunks` rows and REFUSE to finalize
        // (leave the job Paused + resumable) if any emitted combo range is still
        // uncovered. The fresh path passes `false` — its generation covers the
        // whole space by construction and a hard failure already errors.
        resume_guard: bool,
    ) {
        // K = min(CONFIG_MAX_INFLIGHT, max_active_jobs). Unknown limit → config.
        // A `0` limit is rejected up front in `execute` before this loop runs, so
        // `inflight_bound`'s `Err` is treated defensively as the config fallback.
        let k = self
            .max_active_jobs
            .map(|m| inflight_bound(m, CONFIG_MAX_INFLIGHT).unwrap_or(CONFIG_MAX_INFLIGHT))
            .unwrap_or(CONFIG_MAX_INFLIGHT);

        let mut acc = seed_acc;
        // Each task returns its ORIGINAL chunk_idx + the retry outcome (which may
        // carry several sub-chunk results). Out-of-order completion is fine — the
        // accumulator merges by profileset name.
        let mut join: tokio::task::JoinSet<(usize, ChunkOutcome)> = tokio::task::JoinSet::new();

        // ONE shared chunk-idx allocator for BOTH generation AND retry sub-chunks,
        // so a retry's tail rows never collide with a freshly generated chunk. On
        // resume this starts past the already-persisted chunks.
        let next_chunk_idx = Arc::new(std::sync::atomic::AtomicUsize::new(start_chunk_idx));
        use std::sync::atomic::Ordering;
        // Running count of combos written across chunks, so combo_metadata.combo_id
        // stays globally unique (the table PK is `(job_id, combo_id)`).
        let mut combo_id_base: i64 = start_combo_id_base;
        let mut pending: Option<GeneratedChunk> = first;
        // True once the iterator has yielded its final chunk (the partial tail).
        let mut generation_done = false;
        // Set when a pause was honored at a chunk boundary — finalize is skipped.
        let mut paused = false;

        loop {
            // ── 0. Cancel / pause at the chunk boundary (only meaningful with
            // chunk_count > 1, which this path always is). ───────────────────
            if self.is_cancelled().await {
                // Stop submitting; abort in-flight runners (they also observe
                // ctx.cancel via the production runner). Terminal Cancelled status
                // is already set — set_error/update_status no-op on it.
                join.shutdown().await;
                return;
            }
            if !generation_done {
                let next_idx = next_chunk_idx.load(Ordering::SeqCst);
                if self.check_and_honor_pause(&it, next_idx).await {
                    // Stop generating new chunks but DRAIN the in-flight ones so
                    // their completed results are checkpointed (not re-billed on
                    // resume).
                    generation_done = true;
                    paused = true;
                }
            }

            // ── 1. Generate + spawn while there's work and capacity. ──────────
            while !generation_done && join.len() < k {
                let chunk = match pending.take() {
                    Some(c) => c,
                    None => {
                        let ceiling = self.ceiling;
                        let (it_back, chunk) =
                            run_build_chunk_blocking(it, self.base_profile.clone(), ceiling).await;
                        it = it_back;
                        chunk
                    }
                };

                // A generated chunk with zero profilesets means the iterator was
                // exhausted exactly on the previous boundary: stop generating.
                if chunk.profileset_count == 0 {
                    generation_done = true;
                    break;
                }

                let chunk_idx = next_chunk_idx.fetch_add(1, Ordering::SeqCst);

                // Persist this chunk's combo metadata + cloud_chunks row BEFORE
                // submission (crash-recovery oracle). combo_id_base keeps ids
                // unique across chunks.
                super::helpers::write_combo_metadata_table_raw_offset(
                    &self.repo,
                    &self.job_id,
                    &chunk.metadata,
                    &chunk.profileset_lines,
                    combo_id_base,
                )
                .await;
                combo_id_base += chunk.metadata.len() as i64;
                if let Err(e) = cloud_repo
                    .insert_pending_with_lineage(
                        &self.job_id,
                        chunk_idx as i64,
                        chunk.profileset_count as i64,
                        None,
                        Some(chunk.first_name_idx as i64),
                    )
                    .await
                {
                    let _ = self
                        .repo
                        .set_error(&self.job_id, &format!("Failed to record chunk: {e}"))
                        .await;
                    join.shutdown().await;
                    return;
                }

                // Checkpoint the GENERATION cursor at this boundary: the cursor
                // AFTER this chunk so resume regenerates only un-generated chunks.
                // Store the shared allocator's CURRENT value (not a `chunk_idx + 1`
                // literal) so the checkpoint reflects any tail indices a concurrent
                // retry-split already claimed — keeping it consistent with the
                // pause-path checkpoint, which also loads the atomic.
                let next_idx_cp = next_chunk_idx.load(Ordering::SeqCst);
                self.write_checkpoint(&it, next_idx_cp, chunk.exhausted).await;

                let now = chrono::Utc::now().to_rfc3339();
                let _ = cloud_repo
                    .mark_submitted(&self.job_id, chunk_idx as i64, "", &now)
                    .await;

                let runner = runner.clone();
                let cloud_repo = cloud_repo.clone();
                let job_id = self.job_id.clone();
                let base_profile = self.base_profile.clone();
                let options = self.options.clone();
                let chunk_first_name_idx = chunk.first_name_idx;
                let lines = chunk.profileset_lines;
                let count = chunk.profileset_count;
                let alloc = next_chunk_idx.clone();
                join.spawn(async move {
                    let outcome = run_chunk_with_retry(
                        &runner,
                        &cloud_repo,
                        &job_id,
                        &base_profile,
                        &options,
                        chunk_idx,
                        &lines,
                        count,
                        chunk_first_name_idx,
                        &alloc,
                    )
                    .await;
                    (chunk_idx, outcome)
                });

                // The chunk that just reported `exhausted` is the final one.
                if chunk.exhausted {
                    generation_done = true;
                }
            }

            // ── 2. Nothing left to generate AND nothing in flight → finish. ──
            if join.is_empty() {
                break;
            }

            // ── 3. Await one completion (order-independent accumulation). ────
            if let Some(joined) = join.join_next().await {
                let (orig_idx, outcome) = match joined {
                    Ok(pair) => pair,
                    Err(join_err) => {
                        // A spawned task panicked/aborted: fail the job cleanly.
                        let _ = self
                            .repo
                            .set_error(&self.job_id, &format!("Chunk task failed: {join_err}"))
                            .await;
                        join.shutdown().await;
                        return;
                    }
                };
                match outcome {
                    ChunkOutcome::Done(results) => {
                        for (i, (exec_idx, json)) in results.iter().enumerate() {
                            // Base actor comes from chunk 0's FIRST result only.
                            let include_base = orig_idx == 0 && i == 0;
                            let mut envelope =
                                ChunkAccumulator::envelope_from_simc_json(json, include_base);
                            let credits = ChunkAccumulator::credits_from_simc_json(json);
                            envelope.credits = credits;
                            let completed_at = chrono::Utc::now().to_rfc3339();
                            let _ = cloud_repo
                                .mark_completed(
                                    &self.job_id,
                                    *exec_idx as i64,
                                    &envelope,
                                    &completed_at,
                                )
                                .await;
                            acc.add_envelope(envelope, credits);
                        }
                    }
                    ChunkOutcome::Terminal => {
                        // Paused/Cancelled: terminal state already set elsewhere.
                        join.shutdown().await;
                        return;
                    }
                    ChunkOutcome::Failed(msg) => {
                        let _ = self.repo.set_error(&self.job_id, &msg).await;
                        join.shutdown().await;
                        return;
                    }
                }
            }
        }

        // A pause was honored at a boundary: leave the job Paused, do NOT finalize
        // (resume continues from the checkpointed next_chunk_idx).
        if paused {
            return;
        }

        // ── 3b. Completeness guard (RESUME only). ────────────────────────────
        // With every chunk regenerated/re-polled/re-submitted, re-derive provable
        // coverage over the persisted rows. The full emitted space is `[1, total+1)`
        // where `total = next_name_idx - 1` (names are 1-based and the iterator has
        // now emitted every candidate). If a range is STILL uncovered (e.g. a
        // pre-cursor chunk whose re-submit silently dropped, or a remote that never
        // recovered), DO NOT finalize Done — leave the job Paused + resumable with a
        // diagnostic so the user can resume again, never silently dropping combos.
        if resume_guard {
            let total = it.next_name_idx().saturating_sub(1) as i64;
            match cloud_repo.list_for_job(&self.job_id).await {
                Ok(rows) => {
                    let rep = coverage_report(&rows, total);
                    if !rep.is_complete() {
                        let detail = format!(
                            "Resume could not cover all combinations ({} range(s) still \
                             missing, e.g. {:?}); job left paused for another resume.",
                            rep.uncovered.len(),
                            rep.uncovered.first().copied().unwrap_or((0, 0)),
                        );
                        let _ = self
                            .repo
                            .update_status(&self.job_id, crate::models::JobStatus::Paused)
                            .await;
                        // Write only the stage/detail diagnostic — preserve the
                        // existing `progress_pct` (most chunks completed) so the
                        // resumable job doesn't rewind its bar to 0%.
                        let pct = self
                            .repo
                            .get(&self.job_id)
                            .await
                            .ok()
                            .flatten()
                            .map(|j| j.progress_pct)
                            .unwrap_or(0);
                        let _ = self
                            .repo
                            .update_progress(&self.job_id, pct, "Cloud", &detail)
                            .await;
                        return;
                    }
                }
                Err(e) => {
                    // Could not verify coverage → fail clean rather than finalize a
                    // possibly-incomplete result as Done.
                    let _ = self
                        .repo
                        .set_error(
                            &self.job_id,
                            &format!("Resume could not verify chunk coverage: {e}"),
                        )
                        .await;
                    return;
                }
            }
        }

        // ── 4. Finalize the merged multi-chunk result. ──────────────────────
        let mut merged = acc.into_merged_simc_json();
        // Carry the run options (target_error / desired_targets / max_time) into
        // the merged doc so the parser reads real values, not its zero defaults.
        merged["sim"]["options"] = self.options.clone();
        finalize_cloud_result(
            &self.repo,
            &self.job_id,
            &merged,
            &self.base_profile,
            &self.sim_type,
            /*multi_chunk=*/ true,
        )
        .await;
    }

    /// Honor a pending pause request at a chunk boundary: if `pause_requested`,
    /// clear the flag, write the cloud-streaming checkpoint at the current cursor,
    /// flip status to `Paused`, and return `true` (caller stops generating). The
    /// checkpoint mirrors `run_simc_staged::write_staged_checkpoint_and_check_pause`.
    async fn check_and_honor_pause(&self, it: &ProfilesetIterator, next_chunk_idx: usize) -> bool {
        match self.repo.get_pause_requested(&self.job_id).await {
            Ok(true) => {
                let _ = self.repo.set_pause_requested(&self.job_id, false).await;
                // Checkpoint at the CURRENT generation cursor; `next_chunk_idx` is
                // the index of the next chunk resume should generate.
                self.write_checkpoint(it, next_chunk_idx, false).await;
                let _ = self
                    .repo
                    .update_status(&self.job_id, crate::models::JobStatus::Paused)
                    .await;
                true
            }
            _ => false,
        }
    }

    /// True if the job has been cancelled (DB-backed status is the source of
    /// truth). `None` token ⇒ never cancelled. Mirrors `run_simc_staged`.
    async fn is_cancelled(&self) -> bool {
        match self.cancel.as_ref() {
            Some(tok) => tok.is_cancelled().await,
            None => false,
        }
    }

    /// Submit-time affordability gate. `Ok(())` means proceed; `Err(msg)` means
    /// fail the job cleanly with no chunks submitted. No gate (`None` check or
    /// `est_credits_needed == 0`) always proceeds. A fetch error is fatal — we
    /// must not start billing a job we cannot confirm the user can afford.
    async fn check_affordable(&self) -> Result<(), String> {
        let Some(check) = self.affordability.as_ref() else {
            return Ok(());
        };
        if self.est_credits_needed == 0 {
            return Ok(());
        }
        match check().await {
            // Provider reports a credit balance: hard-gate the reservation.
            Ok(Some(available)) if available < self.est_credits_needed => Err(format!(
                "Insufficient credits at submit: need ~{} but only {} available \
                 (the estimate was affordable a moment ago).",
                self.est_credits_needed, available
            )),
            // Affordable, or no credit concept / unknown limit → proceed.
            Ok(_) => Ok(()),
            // Could not confirm affordability → fail clean rather than risk a bill.
            Err(e) => Err(format!("Could not verify credits at submit: {e}")),
        }
    }

    /// Persist the cloud-streaming checkpoint at a chunk boundary. `next_chunk_idx`
    /// is the index of the next chunk to generate; the cursor is the iterator's
    /// position AFTER the just-generated chunk. `final_chunk` marks that the
    /// iterator is exhausted (resume has nothing left to generate).
    async fn write_checkpoint(
        &self,
        it: &ProfilesetIterator,
        next_chunk_idx: usize,
        _final_chunk: bool,
    ) {
        use crate::profileset_generator::checkpoint::{
            Checkpoint, CheckpointPhase, CloudStreamingCheckpoint,
        };
        use crate::profileset_generator::triage::TriageConstants;

        let cp = Checkpoint {
            phase: CheckpointPhase::CloudStreaming(CloudStreamingCheckpoint {
                next_chunk_idx,
                iterator_cursor: it.cursor().to_vec(),
                chunk_size: self.ceiling,
                total_chunks_estimate: next_chunk_idx,
                next_name_idx: it.next_name_idx(),
            }),
            constants: TriageConstants::default(),
        };
        if let Ok(json) = cp.to_json_string() {
            let _ = self.repo.update_checkpoint(&self.job_id, Some(&json)).await;
        }
    }
}

/// Finalize the MERGED cloud result through the gear-comparison parser. Mirrors
/// `helpers::finalize_gear_comparison_result` but consumes the pre-merged JSON
/// (not a single `SimcOutput`). There is no single `simc_input` for the cloud
/// path, so realm extraction reads the `base_profile` (it carries the actor
/// line).
///
/// For a MULTI-CHUNK run (`multi_chunk == true`) there is no single authoritative
/// HTML/text report, so we stamp `reports_merged: false` into the parsed result
/// (the UI hides/disables the report view) and clear the report files
/// (`set_report_files(None, None)`); `raw_json` is the merged SimC doc. A
/// single-chunk run leaves reports normal.
pub async fn finalize_cloud_result(
    repo: &JobRepo,
    job_id: &str,
    merged_json: &Value,
    base_profile: &str,
    sim_type: &str,
    multi_chunk: bool,
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
    if multi_chunk {
        parsed["reports_merged"] = json!(false);
    }

    let result_str = serde_json::to_string(&parsed).unwrap_or_default();
    let raw_str = serde_json::to_string(merged_json).ok();
    if let Err(e) = repo.set_result(job_id, &result_str, raw_str.as_deref()).await {
        eprintln!("[{job_id}] Failed to set result: {e}");
    }
    if multi_chunk {
        if let Err(e) = repo.set_report_files(job_id, None, None).await {
            eprintln!("[{job_id}] Failed to clear merged report files: {e}");
        }
    }
}

// ── Fresh-run HTTP wrapper (the live cloud streaming entry point) ─────────────

/// HTTP-facing entry point for a streaming-sized Top Gear that resolved to a
/// cloud-streaming-capable remote (e.g. Simmit). Mirrors the LOCAL path in
/// `streaming_top_gear::start_streaming_top_gear_job` (build iterator config,
/// validate the batch, create + insert the streamed Job with the same
/// request_json envelope) but spawns [`CloudStreamingRun::execute`] with the
/// PRODUCTION chunk runner instead of local triage. Returns the same
/// `{ id, status: "pending", created_at, estimate }` shape.
pub(super) async fn start_cloud_streaming(
    start: super::streaming_top_gear::StreamingTopGearStart,
) -> actix_web::HttpResponse {
    use crate::models::{Job, SimcInputMode};
    use crate::profileset_generator;
    use crate::server::request_json::NormalizedRequest;

    let super::streaming_top_gear::StreamingTopGearStart {
        req,
        repo,
        simc_bins: _simc_bins,
        log_buffer: _log_buffer,
        base_profile,
        items_by_slot,
        talent_builds,
        socketed_ids,
        catalyst_charges,
        max_combinations,
        estimate,
        exact_combos,
        provider_id,
        provider,
        provider_auth,
        local_queue: _local_queue,
        local_provider: _local_provider,
    } = start;

    // The chunk submit/fetch methods are on the `SimcProvider` trait now (with
    // default "unsupported" impls), so the orchestrator drives the provider
    // through `Arc<dyn SimcProvider>` directly — no downcast. A provider that
    // doesn't override them fails at the first chunk submission, not here.

    // ── Build the iterator config exactly as the local triage path does. ──────
    let gem_opts = profileset_generator::GemEnchantOptions {
        enchant_selections: Some(&req.enchant_selections),
        gem_options: &req.gem_options,
        socketed_item_ids: Some(&socketed_ids),
        replace_gems: req.replace_gems,
        diamond_always_use: req.diamond_always_use,
        max_colors: req.max_colors,
    };
    let iter_cfg = profileset_generator::build_iterator_config(
        &base_profile,
        &items_by_slot,
        &req.selected_items,
        &talent_builds,
        &gem_opts,
        catalyst_charges,
    );

    if let Some(resp) = super::helpers::validate_batch(&req.options.batch_id, repo.get_ref()).await {
        return resp;
    }

    // ── Create + insert the streamed Job (identical envelope to local). ───────
    let options_json = req.options.to_json();
    let display_input =
        crate::simc_runner::build_simc_input_from_options(&base_profile, &options_json);
    let target_error = req.options.target_error;

    let mut job = Job::new_with_provider(
        display_input,
        "top_gear".to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        target_error,
        provider_id,
    );
    job.simc_input_mode = SimcInputMode::Streamed;
    job.batch_id = req.options.batch_id.clone();

    let envelope = NormalizedRequest::new(
        "top_gear",
        json!({
            "items_by_slot": items_by_slot,
            "selected_items": req.selected_items,
            "enchant_selections": req.enchant_selections,
            "gem_options": req.gem_options,
            "socketed_item_ids": socketed_ids.iter().collect::<Vec<_>>(),
            "replace_gems": req.replace_gems,
            "diamond_always_use": req.diamond_always_use,
            "max_colors": req.max_colors,
            "talent_builds": talent_builds,
            "catalyst_charges": catalyst_charges,
            "spec": req.options.spec_override,
            "base_profile": base_profile,
            "max_combinations": max_combinations,
            "void_forge": req.void_forge,
            "options": req.options.to_json(),
            "streaming": true,
            "estimate": estimate,
        }),
    );
    job.request_json = Some(envelope.to_json_string().unwrap_or_default());

    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    // ── Streaming requires SQLite storage (cloud_chunks + combo_metadata). ────
    let Some(pool) = repo.pool().cloned() else {
        return actix_web::HttpResponse::InternalServerError().json(json!({
            "detail": "Cloud streaming requires SQLite storage"
        }));
    };

    if let Err(e) = repo.insert(&job).await {
        return actix_web::HttpResponse::InternalServerError()
            .json(json!({"detail": e.to_string()}));
    }

    // ── Affordability gate: re-validate the estimate authoritatively at submit. ─
    // `est_credits` from the exact combo count (passed from `create_top_gear_sim`,
    // already computed once) + ceiling + target_error. The check closure fetches
    // the account's available credits via the provider's credential endpoint
    // (reusing the Task 6 `cloud_estimate` math). `None` auth / no-credits-concept
    // → `Ok(None)` (treated as affordable inside the gate).
    let ceiling = REMOTE_MAX_PROFILESETS_PER_JOB;
    // `exact_combos` was computed once in `create_top_gear_sim` via
    // `count_top_gear_combos_with_talents`. Using it directly avoids a second
    // O(total) count here and ensures the credit gate and progress denominator
    // match the figure `cloud_estimate` showed the user.
    let est_credits_needed =
        super::cloud_estimate::est_credits(exact_combos, ceiling, target_error);
    let affordability: Option<AffordabilityCheck> = {
        let provider = provider.clone();
        let auth = provider_auth.clone();
        Some(Arc::new(move || {
            let provider = provider.clone();
            let auth = auth.clone();
            Box::pin(async move {
                use secrecy::ExposeSecret;
                let bearer = match &auth {
                    crate::compute::ProviderAuth::BearerToken(s) => s.expose_secret().to_string(),
                    crate::compute::ProviderAuth::None => return Ok(None),
                };
                provider
                    .test_credential(&bearer)
                    .await
                    .map(|c| c.credits_available)
            }) as Pin<Box<dyn Future<Output = Result<Option<u64>, String>> + Send>>
        }))
    };

    // ── In-flight concurrency bound from the account's usage limits (best
    // effort; an error / unknown limit falls back to CONFIG_MAX_INFLIGHT). ─────
    let max_active_jobs = provider
        .get_usage(&provider_auth)
        .await
        .ok()
        .and_then(|u| u.max_active_jobs)
        .map(|n| n as usize);

    // ── Production chunk runner + cancel token; spawn the orchestrator. ───────
    let cloud_repo = CloudChunksRepo::new(pool.clone());
    let cancel = Some(CancelToken::new(repo.get_ref().clone(), job_id.clone()));
    // Run-scoped job-level progress bar: weights each chunk's live percent
    // against `exact_combos` (the exact deduped count, same figure used for
    // credits). For gem-heavy jobs the O(axes) upper-bound `estimate` is huge
    // relative to what the iterator emits, which would peg the bar near 0% for
    // the whole run. The exact count equals the iterator's emitted total, so the
    // bar reaches 100%. No extra Simmit calls.
    let progress =
        CloudProgress::new(repo.get_ref().clone(), job_id.clone(), exact_combos as usize);
    let runner = build_production_chunk_runner(
        provider.clone(),
        cloud_repo,
        provider_auth,
        cancel.clone(),
        Some(progress),
    );

    let run = CloudStreamingRun {
        repo: repo.get_ref().clone(),
        pool,
        iter_cfg,
        base_profile,
        options: options_json.clone(),
        job_id: job_id.clone(),
        sim_type: "top_gear".to_string(),
        ceiling,
        max_active_jobs,
        cancel,
        affordability,
        est_credits_needed,
    };

    // Flip to Running so the UI shows the cancel affordance while chunks submit.
    let _ = repo
        .update_status(&job_id, crate::models::JobStatus::Running)
        .await;

    tokio::spawn(async move {
        run.execute(runner).await;
    });

    actix_web::HttpResponse::Ok().json(json!({
        "id": job_id,
        "status": "pending",
        "created_at": created_at,
        "estimate": estimate,
    }))
}

// ── Job-level progress aggregation ───────────────────────────────────────────

/// Run-scoped, job-level progress aggregator for the cloud-streaming path.
///
/// The loading page renders ONE percent per job, but a streamed run is many
/// concurrent Simmit chunk jobs. Each chunk already reports its own `0..=100`
/// fraction on every status poll the runner makes (`poll_to_terminal` →
/// `on_progress`); we weight those by chunk size against the known total combo
/// count to produce a single job percent. A finished chunk banks its full
/// weight; a failed chunk drops its live weight (a retry re-adds it under a
/// fresh `chunk_idx`), so a split never double-counts. NO extra Simmit calls —
/// this piggybacks on the polls the runner already does.
pub struct CloudProgress {
    repo: JobRepo,
    job_id: String,
    total_combos: usize,
    inner: std::sync::Mutex<ProgressInner>,
}

#[derive(Default)]
struct ProgressInner {
    /// Combos in chunks that finished successfully (full weight, monotonic).
    completed_combos: usize,
    /// `chunk_idx` → (live fraction `0..=1`, chunk size in combos) for in-flight
    /// chunks.
    inflight: std::collections::HashMap<usize, (f32, usize)>,
    /// Last job percent pushed to the DB. Throttles writes (≤ 100 total) and
    /// keeps the bar monotonic — a cloud fraction can momentarily dip (e.g. the
    /// queued-floor of 5% giving way to a real 0% once a worker starts).
    last_pct: u8,
}

impl CloudProgress {
    pub fn new(repo: JobRepo, job_id: String, total_combos: usize) -> Arc<Self> {
        Arc::new(Self {
            repo,
            job_id,
            total_combos,
            inner: std::sync::Mutex::new(ProgressInner::default()),
        })
    }

    /// A chunk reported live progress (`0..=100`). Stash its fraction + push.
    fn report(&self, chunk_idx: usize, count: usize, pct: u8) {
        let mut g = self.inner.lock().unwrap();
        g.inflight.insert(chunk_idx, (pct.min(100) as f32 / 100.0, count));
        self.maybe_push(&mut g);
    }

    /// A chunk finished successfully: bank its full weight permanently.
    fn complete(&self, chunk_idx: usize, count: usize) {
        let mut g = self.inner.lock().unwrap();
        g.inflight.remove(&chunk_idx);
        g.completed_combos += count;
        self.maybe_push(&mut g);
    }

    /// A chunk failed/aborted: drop its live weight. A retry re-adds the work
    /// under a fresh `chunk_idx`; no push (a hard failure ends the job next).
    fn drop_inflight(&self, chunk_idx: usize) {
        let mut g = self.inner.lock().unwrap();
        g.inflight.remove(&chunk_idx);
    }

    /// Recompute the job percent; if it advanced, spawn a throttled DB write.
    fn maybe_push(&self, g: &mut ProgressInner) {
        if self.total_combos == 0 {
            return;
        }
        let live: f32 = g.inflight.values().map(|(f, c)| f * *c as f32).sum();
        let done = g.completed_combos as f32 + live;
        let pct = ((done / self.total_combos as f32) * 100.0).clamp(0.0, 100.0) as u8;
        // Monotonic forward only — never rewind the bar on a transient dip.
        if pct <= g.last_pct {
            return;
        }
        g.last_pct = pct;
        let detail = format!("{} / {} combinations", done as usize, self.total_combos);
        let repo = self.repo.clone();
        let job_id = self.job_id.clone();
        tokio::spawn(async move {
            let _ = repo.update_progress(&job_id, pct, "Cloud", &detail).await;
        });
    }
}

/// A `RunCtx::on_progress` callback, boxed for assignment from `match` arms.
type ProgressCb = Arc<dyn Fn(u8, &str, &str) + Send + Sync>;

// ── Production chunk-runner (the live Simmit path) ────────────────────────────

/// Build the PRODUCTION [`ChunkRunner`] that talks to live Simmit. Each invocation:
/// `submit_chunk_for_id` (records `cloud_chunks.remote_job_id` immediately so a
/// crash mid-poll leaves a re-pollable `submitted` row) → `poll_and_fetch_chunk`
/// → returns the adapted SimC-shaped `.json`. Cancel/log/progress are wired into a
/// per-chunk [`RunCtx`]. Used by BOTH the fresh run (Task 12) and resume.
///
/// `provider` is any `SimcProvider` whose `submit_chunk_for_id`/
/// `poll_and_fetch_chunk` trait methods are implemented (the default impls
/// return an "unsupported" error). Driven through the trait object — no
/// downcast.
pub fn build_production_chunk_runner(
    provider: Arc<dyn crate::compute::SimcProvider>,
    cloud_repo: CloudChunksRepo,
    auth: crate::compute::ProviderAuth,
    cancel: Option<CancelToken>,
    progress: Option<Arc<CloudProgress>>,
) -> ChunkRunner {
    Arc::new(move |req: ChunkRequest| {
        let provider = provider.clone();
        let cloud_repo = cloud_repo.clone();
        let auth = auth.clone();
        let cancel = cancel.clone();
        let progress = progress.clone();
        Box::pin(async move {
            let chunk_idx = req.chunk_idx;
            let count = req.profileset_count;

            // 1. Submit and capture the remote job id BEFORE it runs, so a crash
            // mid-poll leaves a `submitted` cloud_chunks row that resume re-polls.
            // Unique idempotency key per chunk — Simmit rejects key reuse (409),
            // and every chunk (incl. retry sub-chunks, which get fresh chunk_idx)
            // is a distinct submission. `chunk_idx` is unique per job by the
            // `cloud_chunks` PK, so this never collides within a run or on resume.
            let idem_key = format!("{}-c{}", req.job_id, req.chunk_idx);
            let remote_id = provider
                .submit_chunk_for_id(&auth, &req.job_id, &idem_key, &req.simc_input)
                .await?;
            let now = chrono::Utc::now().to_rfc3339();
            let _ = cloud_repo
                .mark_submitted(&req.job_id, req.chunk_idx as i64, &remote_id, &now)
                .await;

            // 2. Poll to terminal + fetch. A per-chunk RunCtx carries cancel and,
            // when a run-scoped aggregator is present, fans this chunk's live
            // percent (delivered on every poll) into the job-level bar keyed by
            // THIS chunk's idx — so concurrent chunks weight independently.
            let on_progress: ProgressCb = match &progress {
                Some(p) => {
                    let p = p.clone();
                    Arc::new(move |pct, _label: &str, _sub: &str| p.report(chunk_idx, count, pct))
                }
                None => Arc::new(|_, _, _| {}),
            };
            let ctx = crate::compute::RunCtx {
                job_id: &req.job_id,
                on_progress,
                on_stage_complete: Arc::new(|_| {}),
                on_log: Arc::new(|_| {}),
                cancel,
                auth: auth.clone(),
            };
            let result = provider.poll_and_fetch_chunk(ctx, &remote_id).await;
            // Bank this chunk's full weight on success; drop its live weight on
            // failure so a retry-split re-adds the work under fresh idxs without
            // double-counting.
            if let Some(p) = &progress {
                match &result {
                    Ok(_) => p.complete(chunk_idx, count),
                    Err(_) => p.drop_inflight(chunk_idx),
                }
            }
            Ok(result?.json)
        }) as Pin<Box<dyn Future<Output = Result<Value, RunError>> + Send>>
    })
}

// ── Provable coverage (resume reconciliation + completeness guard) ───────────

use crate::db::cloud_chunks_repo::CloudChunkRow;

/// The provable coverage analysis over a job's `cloud_chunks` rows, built from
/// `first_combo_name_idx` + `profileset_count` + `status` + `parent_chunk_idx`.
///
/// Names are 1-BASED (`Combo 1` is the first emitted candidate), so the full
/// emitted space is `[1, total + 1)` where `total` is the number of emitted
/// combos. Each row covers `[first, first + count)`. Coverage is decided by the
/// UNION of *completed* rows' ranges — never by count-matching (two equal-count
/// chunks can cover different combos).
#[derive(Debug, Clone)]
struct CoverageReport {
    /// Completed-row ranges do NOT exactly tile `[1, total + 1)`.
    uncovered: Vec<(i64, i64)>,
    /// `chunk_idx` of each `failed` row whose `[first, first + count)` range is
    /// FULLY covered by completed rows (its completed children tiled it). Such a
    /// parent is terminal: it must NOT be re-run (no PK collision, combos once).
    superseded_failed: std::collections::HashSet<i64>,
}

impl CoverageReport {
    /// `true` when every emitted combo is covered by some completed chunk.
    fn is_complete(&self) -> bool {
        self.uncovered.is_empty()
    }
}

/// Merge half-open `[start, end)` intervals into a sorted, disjoint list.
fn merge_intervals(mut ivs: Vec<(i64, i64)>) -> Vec<(i64, i64)> {
    ivs.retain(|(s, e)| e > s);
    ivs.sort_by_key(|(s, _)| *s);
    let mut out: Vec<(i64, i64)> = Vec::with_capacity(ivs.len());
    for (s, e) in ivs {
        if let Some(last) = out.last_mut() {
            if s <= last.1 {
                last.1 = last.1.max(e);
                continue;
            }
        }
        out.push((s, e));
    }
    out
}

/// Subtract the merged `covered` intervals from `[lo, hi)`, returning the
/// uncovered gaps. `covered` MUST be sorted+disjoint (use [`merge_intervals`]).
fn subtract_covered(lo: i64, hi: i64, covered: &[(i64, i64)]) -> Vec<(i64, i64)> {
    let mut gaps = Vec::new();
    let mut at = lo;
    for &(s, e) in covered {
        if e <= at || s >= hi {
            continue;
        }
        if s > at {
            gaps.push((at, s.min(hi)));
        }
        at = at.max(e);
        if at >= hi {
            break;
        }
    }
    if at < hi {
        gaps.push((at, hi));
    }
    gaps
}

/// The completed range of a row, when it carries a provable combo-name range.
/// A completed row with no `first_combo_name_idx` (legacy, pre-0014) returns
/// `None` and contributes NOTHING to coverage — the guard then conservatively
/// keeps the job resumable rather than finalizing Done on unproven coverage.
fn completed_range(row: &CloudChunkRow) -> Option<(i64, i64)> {
    if row.status != "completed" {
        return None;
    }
    let first = row.first_combo_name_idx?;
    Some((first, first + row.profileset_count))
}

/// Build the provable [`CoverageReport`] for `total_combos` emitted candidates.
///
/// Decides, from durable per-chunk metadata only:
/// - which name ranges are NOT covered by any completed chunk (→ re-submit),
/// - which `failed` rows are fully superseded by completed rows (→ skip, terminal).
fn coverage_report(rows: &[CloudChunkRow], total_combos: i64) -> CoverageReport {
    // Union of all completed rows' ranges (children + standalone alike).
    let covered = merge_intervals(rows.iter().filter_map(completed_range).collect());

    // Emitted names are 1-based: `[1, total_combos + 1)`. Saturating add keeps the
    // supersession-only call (which passes `i64::MAX` for an unbounded total)
    // overflow-safe.
    let uncovered = if total_combos <= 0 {
        Vec::new()
    } else {
        subtract_covered(1, total_combos.saturating_add(1), &covered)
    };

    // A failed row is superseded iff its own range is fully inside the completed
    // union (i.e. completed rows — typically its retry children — tiled it).
    let mut superseded_failed = std::collections::HashSet::new();
    for row in rows {
        if row.status != "failed" {
            continue;
        }
        let Some(first) = row.first_combo_name_idx else {
            continue;
        };
        let span = (first, first + row.profileset_count);
        if span.1 > span.0 && subtract_covered(span.0, span.1, &covered).is_empty() {
            superseded_failed.insert(row.chunk_idx);
        }
    }

    CoverageReport {
        uncovered,
        superseded_failed,
    }
}

// ── Resume ───────────────────────────────────────────────────────────────────

/// Resume a paused/crashed cloud-streaming run via a from-start deterministic
/// walk (NOT a seek — do not re-introduce one). Mirrors `resume_triage`/
/// `resume_staged` in that it reads the `CloudStreaming` checkpoint + the
/// `cloud_chunks` rows, but rebuilds the iterator from `new()` and re-walks the
/// whole emitted space from the origin. Cloud chunk generation is dedup-free and
/// a pure function of the cursor, so the walk reproduces byte-identical chunk
/// boundaries and `Combo N` names. For every regenerated chunk it: folds
/// `completed` rows into the accumulator (NEVER re-billed); re-polls BOTH
/// `submitted`-with-live-remote AND `failed`-with-live-remote chunks via their
/// `remote_job_id`; and RE-SUBMITS any uncovered chunk (`failed`-not-superseded /
/// `pending` / lost) on its own row — it never resets a chunk to `pending`. A
/// DB-provable supersession check skips a `failed` retry parent whose range its
/// completed children already tiled. It then continues the SAME chunked
/// submit/merge loop for the never-generated tail. Before finalizing Done a
/// completeness guard re-derives provable coverage over `[1, total+1)`; if any
/// range is still uncovered the job is left Paused + resumable (never silently
/// dropping combos), otherwise the merged result is finalized.
///
/// Auth: on resume there are no request headers, so the Simmit key must come from
/// server-side settings (`provider.simmit.api_key`). Desktop stores it; web works
/// only if the key is in Settings. Without it, resume FAILS CLEAN — it never fakes
/// a run it cannot bill.
/// Resolve the bearer used to bill a cloud-streaming resume, mirroring submit's
/// header→auth precedence: a per-request `BearerToken` (web BYO key) WINS;
/// otherwise the server-side Settings key; `None` when neither is present (caller
/// fails clean). Pure so the precedence is unit-tested without touching HTTP/DB.
fn resolve_resume_auth(
    request_auth: &crate::compute::ProviderAuth,
    settings_key: Option<&str>,
) -> Option<crate::compute::ProviderAuth> {
    if let crate::compute::ProviderAuth::BearerToken(_) = request_auth {
        return Some(request_auth.clone());
    }
    settings_key.map(|k| {
        crate::compute::ProviderAuth::BearerToken(secrecy::SecretString::new(k.to_string().into()))
    })
}

pub async fn resume_cloud_streaming(
    job_id: &str,
    job: &crate::models::Job,
    request_json: &str,
    checkpoint: &crate::profileset_generator::checkpoint::Checkpoint,
    inputs: crate::profileset_generator::ResumeInputs,
) -> Result<(), String> {
    // ── 1. Resolve the provider + server-side auth. ──────────────────────────
    let provider_id = if job.provider_id.is_empty() {
        "simmit"
    } else {
        job.provider_id.as_str()
    };
    // The chunk submit/fetch methods are on the `SimcProvider` trait, so the
    // resume runner/re-poll closures drive the provider through the trait object
    // directly — no downcast. A provider that doesn't override them surfaces an
    // "unsupported" error at the first chunk re-poll/submit.
    let provider = inputs
        .registry
        .get(provider_id)
        .ok_or_else(|| format!("cloud resume: provider '{provider_id}' is not registered"))?;

    // Auth precedence: a per-request bearer (web BYO key, threaded from the
    // resume request's `X-Provider-<id>-Key` headers exactly as submit builds it)
    // WINS; otherwise fall back to the server-side Settings key (desktop, or web
    // with the key saved in Settings). FAIL CLEAN only when NEITHER is available —
    // never fake a run we cannot bill.
    let settings = crate::compute::ProviderSettings::load(
        &inputs.settings_repo,
        &inputs.registry.remote_ids(),
    )
    .await
    .map_err(|e| format!("cloud resume: failed to load provider settings: {e}"))?;
    let auth = resolve_resume_auth(&inputs.request_auth, settings.get_api_key(provider_id))
        .ok_or_else(|| {
            "Cloud resume needs the Simmit API key — supply it via the request \
             (BYO key) or configure it in Settings."
                .to_string()
        })?;

    let cloud_repo = CloudChunksRepo::new(inputs.pool.clone());

    // Production chunk-runner (live Simmit) for the remaining chunks. Resume does
    // not drive the job-level progress bar yet (it would need to seed completed
    // weight from the reloaded chunks) — pass `None` to keep current behavior.
    let cancel = Some(CancelToken::new(inputs.repo.clone(), job_id.to_string()));
    let runner = build_production_chunk_runner(
        provider.clone(),
        cloud_repo.clone(),
        auth.clone(),
        cancel.clone(),
        None,
    );

    // Production re-poll: poll an in-flight chunk's `remote_job_id` to terminal +
    // fetch via the provider's trait methods.
    let repoll: RepollFn = {
        let provider = provider.clone();
        let auth = auth.clone();
        let job_id = job_id.to_string();
        Arc::new(move |remote_id: String| {
            let provider = provider.clone();
            let auth = auth.clone();
            let job_id = job_id.clone();
            Box::pin(async move {
                let ctx = crate::compute::RunCtx {
                    job_id: &job_id,
                    on_progress: Arc::new(|_, _, _| {}),
                    on_stage_complete: Arc::new(|_| {}),
                    on_log: Arc::new(|_| {}),
                    cancel: None,
                    auth,
                };
                provider
                    .poll_and_fetch_chunk(ctx, &remote_id)
                    .await
                    .map(|out| out.json)
            }) as Pin<Box<dyn Future<Output = Result<Value, RunError>> + Send>>
        })
    };

    // Spawn the continuation so the HTTP resume handler returns promptly, mirroring
    // resume_triage/resume_staged. Any clean failure inside (e.g. an invalid stored
    // cursor) is written to the job's error.
    let repo = inputs.repo.clone();
    let pool = inputs.pool.clone();
    let request_json = request_json.to_string();
    let checkpoint = checkpoint.clone();
    let job_id_owned = job_id.to_string();
    tokio::spawn(async move {
        if let Err(e) = resume_cloud_streaming_inner(
            &job_id_owned,
            &request_json,
            &checkpoint,
            repo.clone(),
            pool,
            cloud_repo,
            runner,
            repoll,
            cancel,
        )
        .await
        {
            let _ = repo
                .set_error(&job_id_owned, &format!("Cloud-streaming resume failed: {e}"))
                .await;
        }
    });

    Ok(())
}

/// In-flight chunk re-poll boundary (the Simmit-mock seam for resume). Given a
/// chunk's `remote_job_id`, polls to terminal + returns the adapted SimC JSON.
/// Production wraps `SimmitProvider::poll_and_fetch_chunk`; tests inject a fake.
pub type RepollFn = Arc<
    dyn Fn(String) -> Pin<Box<dyn Future<Output = Result<Value, RunError>> + Send>> + Send + Sync,
>;

/// The HTTP-free resume core, reused by the production path and TDD'd against
/// fakes. Rebuilds the iterator from `new()` (NOT a seek) and walks the emitted
/// space from the origin: regenerates every generated (parent=None) chunk in
/// emission order, folding `completed` rows into the accumulator (never
/// re-billed), re-polling BOTH `submitted`- and `failed`-with-live-remote chunks
/// through `repoll`, and re-submitting uncovered chunks via `runner` on their own
/// row (a DB-provable supersession check skips `failed` retry parents already
/// tiled by their completed children). It then continues the SAME `run_chunk_loop`
/// for the never-generated tail, whose completeness guard keeps the job Paused +
/// resumable if any range stays uncovered. The `runner`/`repoll` are injected so
/// no live Simmit HTTP happens in tests.
#[allow(clippy::too_many_arguments)]
async fn resume_cloud_streaming_inner(
    job_id: &str,
    request_json: &str,
    checkpoint: &crate::profileset_generator::checkpoint::Checkpoint,
    repo: JobRepo,
    pool: sqlx::AnyPool,
    cloud_repo: CloudChunksRepo,
    runner: ChunkRunner,
    repoll: RepollFn,
    cancel: Option<CancelToken>,
) -> Result<(), String> {
    use crate::profileset_generator::checkpoint::CheckpointPhase;
    use std::sync::atomic::{AtomicUsize, Ordering};

    let cloud_cp = match &checkpoint.phase {
        CheckpointPhase::CloudStreaming(cc) => cc,
        _ => return Err("resume_cloud_streaming called with non-CloudStreaming checkpoint".into()),
    };

    // ── 1. Load cloud_chunks — the source of truth for the from-start walk. ──
    let rows = cloud_repo
        .list_for_job(job_id)
        .await
        .map_err(|e| format!("cloud resume: failed to list chunks: {e}"))?;

    // Provable supersession: a `failed` retry parent whose range is fully covered
    // by completed rows (its children tiled it) is TERMINAL — never re-run it. This
    // is independent of the total combo count, so it can be computed up front; the
    // completeness guard recomputes against the real total after the tail loop.
    let coverage = coverage_report(&rows, i64::MAX);

    // ── 2. Rebuild the iterator FROM START + the run inputs. ─────────────────
    // Cloud chunk generation is dedup-free and a pure function of the iterator
    // cursor, so walking from `new()` reproduces byte-identical chunk boundaries
    // and `Combo N` names. We never `seek` to the checkpoint cursor: that forward
    // skip is exactly what dropped pre-cursor failed/lost chunks. `new()` leaves
    // the cursor at the origin and `next_name_idx = 1` (Combo 1 first), matching a
    // fresh run.
    let iter_cfg =
        crate::profileset_generator::iterator_from_request::build_iterator_from_request_json(
            request_json,
        )?;
    let envelope: crate::server::request_json::NormalizedRequest =
        serde_json::from_str(request_json).map_err(|e| format!("Invalid request_json: {e}"))?;
    let payload = &envelope.payload;
    let base_profile = payload
        .get("base_profile")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "request_json missing base_profile".to_string())?
        .to_string();
    // The request envelope persists the sim options (start_cloud_streaming writes
    // `"options"`); resumed chunks must carry them through build_simc_input_from_options
    // exactly like the fresh path, or the resumed chunk submits a malformed input.
    let options = payload.get("options").cloned().unwrap_or_else(|| serde_json::json!({}));
    let ceiling = cloud_cp.chunk_size.max(1);

    let mut it = ProfilesetIterator::new(iter_cfg.clone());

    // ── 3. Clear pause_requested + flip back to Running. ─────────────────────
    repo.set_pause_requested(job_id, false)
        .await
        .map_err(|e| format!("Failed to clear pause_requested: {e}"))?;
    repo.update_status(job_id, crate::models::JobStatus::Running)
        .await
        .map_err(|e| format!("Failed to set Running status: {e}"))?;

    // Shared tail allocator for any re-submit split sub-chunks: seed PAST the max
    // existing row so a re-submit's retry-split never collides on the
    // `(job_id, chunk_idx)` PK. `run_chunk_loop` reuses this seed for tail chunks.
    let max_existing_next = rows
        .iter()
        .map(|r| r.chunk_idx + 1)
        .max()
        .map(|n| n as usize)
        .unwrap_or(0);
    let start_chunk_idx = cloud_cp.next_chunk_idx.max(max_existing_next);
    let tail_alloc = AtomicUsize::new(start_chunk_idx);

    let mut acc = ChunkAccumulator::new();

    // The GENERATED chunks (parent=None) are the ones the iterator reproduces, one
    // `build_chunk` call each. Retry children (parent=Some) live at tail indices
    // and are NOT regenerated (their parent is skipped as superseded; the children
    // are folded in step 5). Walk the generated rows in EMISSION order — by
    // `first_combo_name_idx` (their chunk_idx may be non-contiguous when retry
    // splits claimed interleaved tail indices), so each `build_chunk` lines up with
    // the row whose range it reproduces.
    let mut generated_rows: Vec<&CloudChunkRow> =
        rows.iter().filter(|r| r.parent_chunk_idx.is_none()).collect();
    generated_rows.sort_by_key(|r| (r.first_combo_name_idx.unwrap_or(i64::MAX), r.chunk_idx));

    // ── 4. From-start walk over generated chunks. ────────────────────────────
    for row in &generated_rows {
        let row = *row;
        // Regenerate this chunk from the iterator (advances the cursor + names).
        // Run on a blocking thread so the CPU-bound iterator walk does not stall
        // the async executor while awaiting chunk results.
        let (it_back, chunk) =
            run_build_chunk_blocking(it, base_profile.clone(), ceiling).await;
        it = it_back;
        if chunk.profileset_count == 0 {
            // The iterator ran dry before reproducing all recorded generated chunks
            // — the stored chunk_size/request no longer reproduces the space.
            return Err(format!(
                "cloud resume: iterator exhausted before reproducing generated \
                 chunk {} (range start {:?})",
                row.chunk_idx, row.first_combo_name_idx
            ));
        }
        // Sanity: the regenerated chunk must cover the row's recorded name range.
        if let Some(first) = row.first_combo_name_idx {
            if chunk.first_name_idx as i64 != first {
                return Err(format!(
                    "cloud resume: regenerated chunk for row {} starts at Combo {} \
                     but the row records first_combo_name_idx {first} — the iterator \
                     no longer reproduces the original chunk boundaries",
                    row.chunk_idx, chunk.first_name_idx
                ));
            }
        }
        let chunk_idx = row.chunk_idx;
        let status = row.status.as_str();
        let live_remote = row
            .remote_job_id
            .as_deref()
            .filter(|s| !s.is_empty());

        match status {
            "completed" => {
                // Fold the stored envelope (incl. its persisted credits — already
                // billed, never re-submitted). Discard the regenerated lines.
                if let Some(env) = row
                    .results_json
                    .as_deref()
                    .and_then(|j| serde_json::from_str::<ChunkResultEnvelope>(j).ok())
                {
                    let credits = env.credits;
                    acc.add_envelope(env, credits);
                }
            }
            "submitted" => match live_remote {
                Some(remote_id) => {
                    match repoll(remote_id.to_string()).await {
                        Ok(json) => fold_repolled(
                            &cloud_repo, job_id, chunk_idx, &json, &mut acc,
                        )
                        .await,
                        Err(RunError::Paused) | Err(RunError::Cancelled) => return Ok(()),
                        // Lost/expired remote → re-submit the regenerated lines.
                        Err(RunError::Other(_)) => {
                            if let Some(t) = resume_resubmit_chunk(
                                &runner, &cloud_repo, job_id, &base_profile, &options,
                                chunk_idx, &chunk, &tail_alloc, &mut acc,
                            )
                            .await
                            {
                                return t;
                            }
                        }
                    }
                }
                // No usable remote id → re-submit.
                None => {
                    if let Some(t) = resume_resubmit_chunk(
                        &runner, &cloud_repo, job_id, &base_profile, &options,
                        chunk_idx, &chunk, &tail_alloc, &mut acc,
                    )
                    .await
                    {
                        return t;
                    }
                }
            },
            "failed" => {
                if coverage.superseded_failed.contains(&chunk_idx) {
                    // DB-provably superseded by completed children (folded in step
                    // 5) → terminal, never re-run (no PK collision, combos once).
                } else if let Some(remote_id) = live_remote {
                    // A failed chunk that still has a live remote job: re-poll it
                    // (Bug B — the old resume only re-polled `submitted`). Recover
                    // it if terminal; re-submit if the remote is truly gone.
                    match repoll(remote_id.to_string()).await {
                        Ok(json) => fold_repolled(
                            &cloud_repo, job_id, chunk_idx, &json, &mut acc,
                        )
                        .await,
                        Err(RunError::Paused) | Err(RunError::Cancelled) => return Ok(()),
                        Err(RunError::Other(_)) => {
                            if let Some(t) = resume_resubmit_chunk(
                                &runner, &cloud_repo, job_id, &base_profile, &options,
                                chunk_idx, &chunk, &tail_alloc, &mut acc,
                            )
                            .await
                            {
                                return t;
                            }
                        }
                    }
                } else {
                    // Failed, not superseded, no live remote (Bug A) → re-submit.
                    if let Some(t) = resume_resubmit_chunk(
                        &runner, &cloud_repo, job_id, &base_profile, &options,
                        chunk_idx, &chunk, &tail_alloc, &mut acc,
                    )
                    .await
                    {
                        return t;
                    }
                }
            }
            // `pending` (recorded but never submitted) → re-submit.
            _ => {
                if let Some(t) = resume_resubmit_chunk(
                    &runner, &cloud_repo, job_id, &base_profile, &options,
                    chunk_idx, &chunk, &tail_alloc, &mut acc,
                )
                .await
                {
                    return t;
                }
            }
        }
    }

    // ── 5. Fold completed retry-child rows (parent=Some). ────────────────────
    // Their combos were NOT regenerated above (the iterator only re-walks generated
    // chunks); their parent is skipped as superseded, so folding them here makes
    // each combo appear exactly once.
    for row in rows.iter().filter(|r| r.parent_chunk_idx.is_some()) {
        if row.status != "completed" {
            continue;
        }
        if let Some(env) = row
            .results_json
            .as_deref()
            .and_then(|j| serde_json::from_str::<ChunkResultEnvelope>(j).ok())
        {
            let credits = env.credits;
            acc.add_envelope(env, credits);
        }
    }

    // ── 6. Continue forward for any NEVER-generated tail chunks + finalize. ──
    // The iterator is now positioned exactly after the last recorded generated
    // chunk; `next_name_idx` continued monotonically through the walk, so tail
    // chunks keep the global `Combo N` naming without colliding. `run_chunk_loop`
    // (the same loop the fresh path uses) generates the tail, and — with the
    // resume guard — refuses to finalize Done if any range is still uncovered.
    let meta_repo = crate::db::ComboMetadataRepo::new(pool.clone());
    let combo_id_base = meta_repo
        .count_for_job(job_id)
        .await
        .map_err(|e| format!("cloud resume: failed to count combo metadata: {e}"))?;

    let run = CloudStreamingRun {
        repo: repo.clone(),
        pool: pool.clone(),
        iter_cfg,
        base_profile,
        options,
        job_id: job_id.to_string(),
        sim_type: "top_gear".to_string(),
        ceiling,
        max_active_jobs: None,
        cancel,
        affordability: None,
        est_credits_needed: 0,
    };
    run.run_chunk_loop(
        &cloud_repo,
        it,
        runner,
        acc,
        tail_alloc.load(Ordering::SeqCst),
        combo_id_base,
        None,
        /*resume_guard=*/ true,
    )
    .await;

    Ok(())
}

/// Fold a re-polled chunk's terminal Simmit JSON: extract its envelope (adopting
/// the base actor only when the accumulator still lacks one — the Top Gear base
/// is invariant across chunks), persist `mark_completed`, and fold it. Used by
/// the resume walk for both `submitted` and live-`failed` chunks.
async fn fold_repolled(
    cloud_repo: &CloudChunksRepo,
    job_id: &str,
    chunk_idx: i64,
    json: &Value,
    acc: &mut ChunkAccumulator,
) {
    let include_base = acc.needs_base();
    let mut env = ChunkAccumulator::envelope_from_simc_json(json, include_base);
    let credits = ChunkAccumulator::credits_from_simc_json(json);
    env.credits = credits;
    let completed_at = chrono::Utc::now().to_rfc3339();
    let _ = cloud_repo
        .mark_completed(job_id, chunk_idx, &env, &completed_at)
        .await;
    acc.add_envelope(env, credits);
}

/// Re-submit ONE regenerated chunk on its OWN `chunk_idx` (reusing its existing
/// `cloud_chunks` row + combo_metadata) through the same split-retry path the
/// fresh run uses. On success folds + marks the row completed; on a hard failure
/// sets the job error. Returns `Some(result)` when the resume must STOP (a clean
/// terminal abort or a hard failure), `None` to continue the walk.
#[allow(clippy::too_many_arguments)]
async fn resume_resubmit_chunk(
    runner: &ChunkRunner,
    cloud_repo: &CloudChunksRepo,
    job_id: &str,
    base_profile: &str,
    options: &Value,
    chunk_idx: i64,
    chunk: &GeneratedChunk,
    tail_alloc: &std::sync::atomic::AtomicUsize,
    acc: &mut ChunkAccumulator,
) -> Option<Result<(), String>> {
    // Re-mark the row submitted so a crash mid-re-submit leaves a re-pollable row.
    let now = chrono::Utc::now().to_rfc3339();
    let _ = cloud_repo.mark_submitted(job_id, chunk_idx, "", &now).await;

    let outcome = run_chunk_with_retry(
        runner,
        cloud_repo,
        job_id,
        base_profile,
        options,
        chunk_idx as usize,
        &chunk.profileset_lines,
        chunk.profileset_count,
        chunk.first_name_idx,
        tail_alloc,
    )
    .await;

    match outcome {
        ChunkOutcome::Done(results) => {
            for (i, (exec_idx, json)) in results.iter().enumerate() {
                let include_base = acc.needs_base() && i == 0;
                let mut env = ChunkAccumulator::envelope_from_simc_json(json, include_base);
                let credits = ChunkAccumulator::credits_from_simc_json(json);
                env.credits = credits;
                let completed_at = chrono::Utc::now().to_rfc3339();
                let _ = cloud_repo
                    .mark_completed(job_id, *exec_idx as i64, &env, &completed_at)
                    .await;
                acc.add_envelope(env, credits);
            }
            None
        }
        // Clean terminal abort (Paused/Cancelled): stop, state already set.
        ChunkOutcome::Terminal => Some(Ok(())),
        // Hard failure → propagate as a terminal Error (the resume wrapper writes
        // it to the job). Matches fresh-path semantics: a hard submit failure is
        // non-retryable and correctly NOT resumable.
        ChunkOutcome::Failed(msg) => Some(Err(msg)),
    }
}

impl ChunkAccumulator {
    /// `true` while the accumulator has not yet captured a base actor — the next
    /// folded envelope should carry `base_player` (extracted with `include_base`).
    fn needs_base(&self) -> bool {
        self.base_player.is_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn zero_active_jobs_is_rejected_not_clamped_to_one() {
        assert!(inflight_bound(0, 4).is_err());
        assert_eq!(inflight_bound(2, 4).unwrap(), 2);
        assert_eq!(inflight_bound(10, 4).unwrap(), 4);
    }

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
    fn chunk_input_includes_simulation_options() {
        // Regression: a cloud chunk's submitted input MUST carry the
        // `# Simulation Options` section (target_error/iterations/...). Chunks go
        // up with multiStage:true, which needs a target_error to tune toward — a
        // bare "# Base Actor" + profilesets is rejected by Simmit regardless of
        // size (which is why splitting never helped). This asserts the input runs
        // through build_simc_input_from_options, not just combine.
        let opts = serde_json::json!({ "target_error": 0.05, "iterations": 20000 });
        let input = combine_chunk_input(
            "mage=test\nspec=frost",
            &["profileset.\"Combo 1\"+=head=,id=200".to_string()],
            &opts,
        );
        assert!(input.contains("# Base Actor"), "keeps base actor:\n{input}");
        assert!(input.contains("target_error=0.05"), "injects target_error:\n{input}");
        assert!(input.contains("iterations=20000"), "injects iterations:\n{input}");
        assert!(input.contains("profileset.\"Combo 1\""), "keeps profileset line:\n{input}");
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

    fn bearer(s: &str) -> crate::compute::ProviderAuth {
        crate::compute::ProviderAuth::BearerToken(secrecy::SecretString::new(s.to_string().into()))
    }

    fn expose(auth: &crate::compute::ProviderAuth) -> Option<String> {
        use secrecy::ExposeSecret;
        match auth {
            crate::compute::ProviderAuth::BearerToken(s) => Some(s.expose_secret().to_string()),
            crate::compute::ProviderAuth::None => None,
        }
    }

    #[test]
    fn resume_auth_prefers_request_over_settings() {
        // Web BYO key: a per-request bearer wins even when Settings also has one.
        let resolved = resolve_resume_auth(&bearer("req-key"), Some("settings-key")).unwrap();
        assert_eq!(expose(&resolved).as_deref(), Some("req-key"));
    }

    #[test]
    fn resume_auth_falls_back_to_settings_when_no_request_auth() {
        // Desktop / web-with-Settings-key: no per-request auth → use Settings.
        let resolved =
            resolve_resume_auth(&crate::compute::ProviderAuth::None, Some("settings-key")).unwrap();
        assert_eq!(expose(&resolved).as_deref(), Some("settings-key"));
    }

    #[test]
    fn resume_auth_errors_when_neither_present() {
        // Web BYO-key with no key supplied AND none in Settings → fail clean.
        assert!(resolve_resume_auth(&crate::compute::ProviderAuth::None, None).is_none());
    }

    // ── coverage_report (provable supersession + completeness) ──────────────
    use crate::db::cloud_chunks_repo::CloudChunkRow;

    /// Build a `CloudChunkRow` with the fields coverage_report reads.
    fn row(
        chunk_idx: i64,
        status: &str,
        count: i64,
        parent: Option<i64>,
        first_name: Option<i64>,
    ) -> CloudChunkRow {
        CloudChunkRow {
            chunk_idx,
            remote_job_id: None,
            status: status.to_string(),
            profileset_count: count,
            results_json: None,
            submitted_at: None,
            completed_at: None,
            parent_chunk_idx: parent,
            first_combo_name_idx: first_name,
        }
    }

    #[test]
    fn coverage_complete_when_completed_rows_tile_one_based_range() {
        // 5 emitted combos (1-based): chunk 0 covers [1,3), chunk 1 [3,5),
        // chunk 2 [5,6) — exactly tiling [1,6). No gaps.
        let rows = [
            row(0, "completed", 2, None, Some(1)),
            row(1, "completed", 2, None, Some(3)),
            row(2, "completed", 1, None, Some(5)),
        ];
        let rep = coverage_report(&rows, 5);
        assert!(rep.is_complete(), "uncovered: {:?}", rep.uncovered);
        assert!(rep.superseded_failed.is_empty());
    }

    #[test]
    fn coverage_reports_uncovered_gap_for_unsuperseded_failed() {
        // chunk 0 completed [1,3); chunk 1 FAILED [3,5) with no completed
        // children; chunk 2 completed [5,6). The middle range [3,5) is a gap.
        let rows = [
            row(0, "completed", 2, None, Some(1)),
            row(1, "failed", 2, None, Some(3)),
            row(2, "completed", 1, None, Some(5)),
        ];
        let rep = coverage_report(&rows, 5);
        assert!(!rep.is_complete());
        assert_eq!(rep.uncovered, vec![(3, 5)]);
        // The failed parent is NOT superseded (its range is uncovered).
        assert!(!rep.superseded_failed.contains(&1));
    }

    #[test]
    fn coverage_marks_failed_parent_superseded_by_completed_children() {
        // chunk 1 FAILED [3,5); its two retry children (idx 3,4) completed and
        // tile [3,4)+[4,5) → parent 1 is superseded (terminal, never re-run).
        let rows = [
            row(0, "completed", 2, None, Some(1)),
            row(1, "failed", 2, None, Some(3)),
            row(2, "completed", 1, None, Some(5)),
            row(3, "completed", 1, Some(1), Some(3)),
            row(4, "completed", 1, Some(1), Some(4)),
        ];
        let rep = coverage_report(&rows, 5);
        assert!(rep.is_complete(), "uncovered: {:?}", rep.uncovered);
        assert!(rep.superseded_failed.contains(&1));
    }

    #[test]
    fn coverage_completed_row_without_range_does_not_prove_coverage() {
        // A legacy completed row (no first_combo_name_idx) contributes nothing,
        // so the whole space stays uncovered — the guard keeps the job resumable
        // rather than finalizing Done on unproven coverage.
        let rows = [row(0, "completed", 5, None, None)];
        let rep = coverage_report(&rows, 5);
        assert!(!rep.is_complete());
        assert_eq!(rep.uncovered, vec![(1, 6)]);
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

    // ── CloudProgress (job-level progress aggregation) ──────────────────────

    /// Insert a bare streamed top_gear job and return (repo, job_id).
    async fn progress_job(pool: &sqlx::AnyPool) -> (JobRepo, String) {
        let repo = JobRepo::new(pool.clone());
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
        (repo, job_id)
    }

    /// Poll the job until `progress_pct >= want` (the DB write is spawned), then
    /// return the observed percent. Fails the test on timeout.
    async fn wait_pct(repo: &JobRepo, job_id: &str, want: u8) -> u8 {
        for _ in 0..200 {
            let pct = repo.get(job_id).await.unwrap().unwrap().progress_pct;
            if pct >= want {
                return pct;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        panic!("timed out waiting for progress_pct >= {want}");
    }

    #[tokio::test]
    async fn cloud_progress_weights_inflight_and_completed() {
        let pool = pool().await;
        let (repo, job_id) = progress_job(&pool).await;
        let progress = CloudProgress::new(repo.clone(), job_id.clone(), 100);

        // Two in-flight chunks of 50 combos each, both at 50% → 25 + 25 = 50%.
        progress.report(0, 50, 50);
        progress.report(1, 50, 50);
        assert_eq!(wait_pct(&repo, &job_id, 50).await, 50);

        // Chunk 0 finishes: full 50 banked + chunk 1 still at 25 → 75%.
        progress.complete(0, 50);
        assert_eq!(wait_pct(&repo, &job_id, 75).await, 75);

        // Chunk 1 finishes → 100%.
        progress.complete(1, 50);
        assert_eq!(wait_pct(&repo, &job_id, 100).await, 100);

        let job = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(job.progress_stage.as_deref(), Some("Cloud"));
        assert_eq!(job.progress_detail.as_deref(), Some("100 / 100 combinations"));
    }

    #[tokio::test]
    async fn cloud_progress_bar_never_rewinds_on_dip() {
        let pool = pool().await;
        let (repo, job_id) = progress_job(&pool).await;
        let progress = CloudProgress::new(repo.clone(), job_id.clone(), 100);

        // One chunk reaches 60%.
        progress.report(0, 100, 60);
        assert_eq!(wait_pct(&repo, &job_id, 60).await, 60);

        // A transient dip to 10% (e.g. queued-floor → real 0% on a worker start)
        // must NOT rewind the bar.
        progress.report(0, 100, 10);
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert_eq!(repo.get(&job_id).await.unwrap().unwrap().progress_pct, 60);
    }

    #[tokio::test]
    async fn cloud_progress_split_does_not_double_count() {
        let pool = pool().await;
        let (repo, job_id) = progress_job(&pool).await;
        let progress = CloudProgress::new(repo.clone(), job_id.clone(), 100);

        // Chunk 0 (50) completes → 50%.
        progress.complete(0, 50);
        assert_eq!(wait_pct(&repo, &job_id, 50).await, 50);

        // Chunk 1 (50) reports progress then FAILS → its live weight is dropped.
        progress.report(1, 50, 80);
        progress.drop_inflight(1);

        // Its two retry sub-chunks (25 + 25) complete under fresh idxs → exactly
        // 100%, not 100 + the dropped chunk-1 weight.
        progress.complete(2, 25);
        progress.complete(3, 25);
        assert_eq!(wait_pct(&repo, &job_id, 100).await, 100);
        assert_eq!(repo.get(&job_id).await.unwrap().unwrap().progress_pct, 100);
    }

    /// A single varying gear slot with 6 items (equipped + 5 alternatives). The
    /// iterator skips the all-equipped baseline, so this yields exactly FIVE real
    /// profilesets ("Combo 1".."Combo 5"). With `ceiling = 2` it splits into three
    /// chunks (2, 2, 1) — the multi-chunk path.
    fn five_combo_cfg() -> ProfilesetIteratorConfig {
        let mut slot_item_lists = HashMap::new();
        slot_item_lists.insert(
            "head".to_string(),
            vec![
                arc_item(100, "head", true),
                arc_item(201, "head", false),
                arc_item(202, "head", false),
                arc_item(203, "head", false),
                arc_item(204, "head", false),
                arc_item(205, "head", false),
            ],
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
            options: serde_json::json!({ "target_error": 0.05, "desired_targets": 1, "max_time": 300 }),
            sim_type: "top_gear".to_string(),
            ceiling: REMOTE_MAX_PROFILESETS_PER_JOB,
            max_active_jobs: None,
            cancel: None,
            affordability: None,
            est_credits_needed: 0,
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
        // sim.options was injected into the merge, so the parser reports the real
        // target_error instead of its 0.0 default.
        assert_eq!(result["target_error"], 0.05);
        let names: Vec<String> = result["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["name"].as_str().unwrap().to_string())
            .collect();
        assert!(names.iter().any(|n| n == "Combo 1"), "names: {names:?}");
        assert!(names.iter().any(|n| n == "Combo 2"), "names: {names:?}");

        // (c) The per-combo simc override line is persisted to combo_metadata so
        // sim-row can rebuild the row's gear. Without it the cloud path stored an
        // empty profileset_simc and sim-row re-ran the equipped set instead.
        let meta_repo = crate::db::ComboMetadataRepo::new(pool.clone());
        let combo1 = meta_repo
            .get_by_name(&job_id, "Combo 1")
            .await
            .unwrap()
            .unwrap();
        assert!(
            combo1.profileset_simc.contains("id=200"),
            "profileset_simc must carry the override line: {:?}",
            combo1.profileset_simc
        );
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
            options: serde_json::json!({}),
            sim_type: "top_gear".to_string(),
            ceiling: REMOTE_MAX_PROFILESETS_PER_JOB,
            max_active_jobs: None,
            cancel: None,
            affordability: None,
            est_credits_needed: 0,
        };
        run.execute(runner).await;

        assert_eq!(calls.lock().unwrap().len(), 0, "no chunk should be submitted");
        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(finished.status, crate::models::JobStatus::Failed);
    }

    /// Tracks in-flight concurrency + records the requests. Emits one result row
    /// per `Combo N` name found in the chunk's simc_input (faithful merge), plus a
    /// base actor in every chunk (the orchestrator only keeps chunk 0's). Yields
    /// across an await point so concurrent runners actually overlap.
    fn tracking_runner(
        calls: std::sync::Arc<Mutex<Vec<ChunkRequest>>>,
        inflight: std::sync::Arc<std::sync::atomic::AtomicUsize>,
        max_inflight: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    ) -> ChunkRunner {
        use std::sync::atomic::Ordering;
        std::sync::Arc::new(move |req: ChunkRequest| {
            calls.lock().unwrap().push(req.clone());
            let inflight = inflight.clone();
            let max_inflight = max_inflight.clone();
            // Extract `Combo N` names from the profileset lines so the merged doc
            // carries the same combos the iterator generated.
            let names: Vec<String> = req
                .simc_input
                .match_indices("profileset.\"")
                .filter_map(|(i, _)| {
                    let rest = &req.simc_input[i + "profileset.\"".len()..];
                    rest.split('"').next().map(|s| s.to_string())
                })
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .collect();
            Box::pin(async move {
                let now = inflight.fetch_add(1, Ordering::SeqCst) + 1;
                max_inflight.fetch_max(now, Ordering::SeqCst);
                // Force overlap: yield so other spawned runners get to run.
                tokio::task::yield_now().await;
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                inflight.fetch_sub(1, Ordering::SeqCst);

                let results: Vec<Value> = names
                    .iter()
                    .map(|n| json!({ "name": n, "mean": 1000.0 }))
                    .collect();
                Ok(json!({
                    "sim": {
                        "players": [{
                            "name": "Hero",
                            "collected_data": { "dps": { "mean": 1000.0, "mean_std_dev": 0.0 } }
                        }],
                        "profilesets": { "results": results }
                    },
                    "simmit": { "credits_consumed": 100 }
                }))
            }) as Pin<Box<dyn Future<Output = Result<Value, RunError>> + Send>>
        })
    }

    #[tokio::test]
    async fn multi_chunk_run_bounds_concurrency_and_merges() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let pool = pool().await;
        let repo = JobRepo::new(pool.clone());

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
        let inflight = std::sync::Arc::new(AtomicUsize::new(0));
        let max_inflight = std::sync::Arc::new(AtomicUsize::new(0));
        let runner = tracking_runner(calls.clone(), inflight.clone(), max_inflight.clone());

        // 5 candidates, ceiling=2 -> chunks of 2,2,1 (3 chunks). K = min(4, 2) = 2.
        let run = CloudStreamingRun {
            repo: repo.clone(),
            pool: pool.clone(),
            iter_cfg: five_combo_cfg(),
            base_profile: "server=tichondrius\nregion=us".to_string(),
            job_id: job_id.clone(),
            options: serde_json::json!({}),
            sim_type: "top_gear".to_string(),
            ceiling: 2,
            max_active_jobs: Some(2),
            cancel: None,
            affordability: None,
            est_credits_needed: 0,
        };
        run.execute(runner).await;

        // Exactly 3 chunks submitted, with the expected per-chunk sizes.
        let recorded = calls.lock().unwrap();
        assert_eq!(recorded.len(), 3, "expected 3 chunk submissions");
        let mut by_idx: Vec<(usize, usize)> = recorded
            .iter()
            .map(|r| (r.chunk_idx, r.profileset_count))
            .collect();
        by_idx.sort();
        assert_eq!(by_idx, vec![(0, 2), (1, 2), (2, 1)]);
        drop(recorded);

        // Concurrency was bounded to K=2 (no more than 2 runners ever in flight).
        assert!(
            max_inflight.load(Ordering::SeqCst) <= 2,
            "max in-flight {} exceeded K=2",
            max_inflight.load(Ordering::SeqCst)
        );
        // And we DID overlap (proves the bound is real, not just sequential).
        assert!(
            max_inflight.load(Ordering::SeqCst) >= 2,
            "expected concurrency >= 2, got {}",
            max_inflight.load(Ordering::SeqCst)
        );

        // All 3 cloud_chunks rows are completed.
        let cloud_repo = CloudChunksRepo::new(pool.clone());
        let rows = cloud_repo.list_for_job(&job_id).await.unwrap();
        assert_eq!(rows.len(), 3);
        assert!(rows.iter().all(|r| r.status == "completed"));

        // The finalized job result merges all 5 combos (+ the baseline row), and
        // multi-chunk stamps reports_merged:false on the parsed result.
        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(finished.status, crate::models::JobStatus::Done);
        let result: Value =
            serde_json::from_str(finished.result_json.as_deref().unwrap()).unwrap();
        assert_eq!(result["reports_merged"], false);
        let names: Vec<String> = result["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["name"].as_str().unwrap().to_string())
            .collect();
        for n in ["Combo 1", "Combo 2", "Combo 3", "Combo 4", "Combo 5"] {
            assert!(names.iter().any(|x| x == n), "missing {n} in {names:?}");
        }

        // A CloudStreaming checkpoint was written at a chunk boundary.
        let cp_json = finished.checkpoint.expect("checkpoint written");
        let cp = crate::profileset_generator::checkpoint::Checkpoint::from_json_str(&cp_json)
            .expect("checkpoint parses");
        match cp.phase {
            crate::profileset_generator::checkpoint::CheckpointPhase::CloudStreaming(cc) => {
                assert_eq!(cc.chunk_size, 2);
                assert!(cc.next_chunk_idx >= 1);
                // next_name_idx is the global combo counter (>= number generated).
                assert!(cc.next_name_idx >= 1);
            }
            _ => panic!("expected CloudStreaming checkpoint phase"),
        }
    }

    // ── Task 9 helpers ───────────────────────────────────────────────────────

    /// Extract the `Combo N` names from a chunk's simc_input (the profileset
    /// lines), so a fake runner can echo back exactly the combos it was handed.
    fn combo_names(simc_input: &str) -> Vec<String> {
        simc_input
            .match_indices("profileset.\"")
            .filter_map(|(i, _)| {
                let rest = &simc_input[i + "profileset.\"".len()..];
                rest.split('"').next().map(|s| s.to_string())
            })
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    /// Build an adapted Simmit-shaped result that echoes the combos in `names`.
    fn result_for(names: &[String]) -> Value {
        let results: Vec<Value> = names
            .iter()
            .map(|n| json!({ "name": n, "mean": 1000.0 }))
            .collect();
        json!({
            "sim": {
                "players": [{
                    "name": "Hero",
                    "collected_data": { "dps": { "mean": 1000.0, "mean_std_dev": 0.0 } }
                }],
                "profilesets": { "results": results }
            },
            "simmit": { "credits_consumed": 100 }
        })
    }

    async fn streamed_top_gear_job(repo: &JobRepo) -> String {
        let mut job = crate::models::Job::new_with_provider(
            String::new(),
            "top_gear".to_string(),
            100,
            "patchwerk".to_string(),
            0.1,
            "simmit".to_string(),
        );
        job.simc_input_mode = crate::models::SimcInputMode::Streamed;
        let id = job.id.clone();
        repo.insert(&job).await.unwrap();
        id
    }

    // (c) Credit re-check returns unaffordable → job fails, ZERO runner calls.
    #[tokio::test]
    async fn unaffordable_at_submit_fails_clean_zero_chunks() {
        let pool = pool().await;
        let repo = JobRepo::new(pool.clone());
        let job_id = streamed_top_gear_job(&repo).await;

        let calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let runner = fake_runner(calls.clone());

        // Affordability check reports 0 credits available; need > 0.
        let affordability: AffordabilityCheck = std::sync::Arc::new(|| {
            Box::pin(async { Ok(Some(0u64)) })
                as Pin<Box<dyn Future<Output = Result<Option<u64>, String>> + Send>>
        });

        let run = CloudStreamingRun {
            repo: repo.clone(),
            pool: pool.clone(),
            iter_cfg: one_combo_cfg(),
            base_profile: "server=tichondrius\nregion=us".to_string(),
            job_id: job_id.clone(),
            options: serde_json::json!({}),
            sim_type: "top_gear".to_string(),
            ceiling: REMOTE_MAX_PROFILESETS_PER_JOB,
            max_active_jobs: None,
            cancel: None,
            affordability: Some(affordability),
            est_credits_needed: 500,
        };
        run.execute(runner).await;

        // ZERO runner calls — the gate fired before any submission.
        assert_eq!(calls.lock().unwrap().len(), 0, "no chunk may be submitted");
        // No cloud_chunks rows at all (nothing inserted past the gate).
        let cloud_repo = CloudChunksRepo::new(pool.clone());
        assert!(cloud_repo.list_for_job(&job_id).await.unwrap().is_empty());
        // Job failed cleanly with the submit-time message.
        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(finished.status, crate::models::JobStatus::Failed);
        assert!(
            finished
                .error_message
                .as_deref()
                .unwrap_or("")
                .contains("Insufficient credits at submit"),
            "msg: {:?}",
            finished.error_message
        );
    }

    // A known zero active-job limit → job fails up front, ZERO runner calls.
    #[tokio::test]
    async fn zero_active_job_limit_fails_clean_zero_chunks() {
        let pool = pool().await;
        let repo = JobRepo::new(pool.clone());
        let job_id = streamed_top_gear_job(&repo).await;

        let calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let runner = fake_runner(calls.clone());

        let run = CloudStreamingRun {
            repo: repo.clone(),
            pool: pool.clone(),
            iter_cfg: one_combo_cfg(),
            base_profile: "server=tichondrius\nregion=us".to_string(),
            job_id: job_id.clone(),
            options: serde_json::json!({}),
            sim_type: "top_gear".to_string(),
            ceiling: REMOTE_MAX_PROFILESETS_PER_JOB,
            max_active_jobs: Some(0),
            cancel: None,
            affordability: None,
            est_credits_needed: 0,
        };
        run.execute(runner).await;

        // ZERO runner calls — the gate fired before any submission.
        assert_eq!(calls.lock().unwrap().len(), 0, "no chunk may be submitted");
        // No cloud_chunks rows at all (nothing inserted past the gate).
        let cloud_repo = CloudChunksRepo::new(pool.clone());
        assert!(cloud_repo.list_for_job(&job_id).await.unwrap().is_empty());
        // Job failed cleanly with the no-capacity message.
        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(finished.status, crate::models::JobStatus::Failed);
        assert!(
            finished
                .error_message
                .as_deref()
                .unwrap_or("")
                .contains("no concurrent-job capacity"),
            "msg: {:?}",
            finished.error_message
        );
    }

    /// A runner that fails the FIRST call for `fail_chunk_idx` (when it carries
    /// more than one profileset) and otherwise echoes the combos it was handed.
    /// Sub-chunks (smaller) therefore succeed → exercises split-retry.
    fn retry_runner(
        calls: std::sync::Arc<Mutex<Vec<ChunkRequest>>>,
        fail_chunk_idx: usize,
    ) -> ChunkRunner {
        std::sync::Arc::new(move |req: ChunkRequest| {
            calls.lock().unwrap().push(req.clone());
            let should_fail = req.chunk_idx == fail_chunk_idx && req.profileset_count > 1;
            let names = combo_names(&req.simc_input);
            Box::pin(async move {
                if should_fail {
                    Err(RunError::Other("Simmit job timed_out".to_string()))
                } else {
                    Ok(result_for(&names))
                }
            })
                as Pin<Box<dyn Future<Output = Result<Value, RunError>> + Send>>
        })
    }

    // (a) First call for a chunk errors, then the retry sub-chunks succeed → the
    // job completes; the original chunk's combos still appear; metadata names
    // unchanged.
    #[tokio::test]
    async fn timed_out_chunk_retries_as_subchunks_same_target_error() {
        let pool = pool().await;
        let repo = JobRepo::new(pool.clone());
        let job_id = streamed_top_gear_job(&repo).await;

        let calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        // 5 combos, ceiling 2 → chunks (2,2,1). Fail chunk 1 (size 2) → splits to
        // two size-1 sub-chunks that succeed.
        let runner = retry_runner(calls.clone(), 1);

        let run = CloudStreamingRun {
            repo: repo.clone(),
            pool: pool.clone(),
            iter_cfg: five_combo_cfg(),
            base_profile: "server=tichondrius\nregion=us".to_string(),
            job_id: job_id.clone(),
            options: serde_json::json!({}),
            sim_type: "top_gear".to_string(),
            ceiling: 2,
            max_active_jobs: Some(1), // serialize so chunk_idx assignment is stable
            cancel: None,
            affordability: None,
            est_credits_needed: 0,
        };
        run.execute(runner).await;

        // The job completed and merges ALL 5 original combos (sub-chunks kept the
        // Combo N names — no metadata rewrite).
        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(finished.status, crate::models::JobStatus::Done);
        let result: Value =
            serde_json::from_str(finished.result_json.as_deref().unwrap()).unwrap();
        let names: Vec<String> = result["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["name"].as_str().unwrap().to_string())
            .collect();
        for n in ["Combo 1", "Combo 2", "Combo 3", "Combo 4", "Combo 5"] {
            assert!(names.iter().any(|x| x == n), "missing {n} in {names:?}");
        }

        // Submission accounting: 3 original chunk calls + 2 retry sub-chunk calls.
        let recorded = calls.lock().unwrap();
        assert_eq!(recorded.len(), 5, "3 chunks + 2 retry sub-chunks");
        drop(recorded);

        // The original chunk-1 row is failed; its two sub-chunk rows are completed.
        let cloud_repo = CloudChunksRepo::new(pool.clone());
        let rows = cloud_repo.list_for_job(&job_id).await.unwrap();
        assert!(rows.iter().any(|r| r.chunk_idx == 1 && r.status == "failed"));
        let completed = rows.iter().filter(|r| r.status == "completed").count();
        // chunk 0, chunk 2, + 2 retry sub-chunks = 4 completed.
        assert_eq!(completed, 4, "rows: {rows:?}");
    }

    /// A runner that ALWAYS fails any request touching the failing chunk's combos
    /// (Combo 3 / Combo 4), including its split sub-chunks at minimal size.
    fn always_fail_runner(calls: std::sync::Arc<Mutex<Vec<ChunkRequest>>>) -> ChunkRunner {
        std::sync::Arc::new(move |req: ChunkRequest| {
            calls.lock().unwrap().push(req.clone());
            let names = combo_names(&req.simc_input);
            let touches_failing = names.iter().any(|n| n == "Combo 3" || n == "Combo 4");
            Box::pin(async move {
                if touches_failing {
                    Err(RunError::Other("Simmit job timed_out".to_string()))
                } else {
                    Ok(result_for(&names))
                }
            })
                as Pin<Box<dyn Future<Output = Result<Value, RunError>> + Send>>
        })
    }

    // (b) A sub-chunk that still fails at minimal size → job fails cleanly,
    // naming the chunk, no panic.
    #[tokio::test]
    async fn subchunk_still_timing_out_fails_job_cleanly() {
        let pool = pool().await;
        let repo = JobRepo::new(pool.clone());
        let job_id = streamed_top_gear_job(&repo).await;

        let calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let runner = always_fail_runner(calls.clone());

        let run = CloudStreamingRun {
            repo: repo.clone(),
            pool: pool.clone(),
            iter_cfg: five_combo_cfg(),
            base_profile: "server=tichondrius\nregion=us".to_string(),
            job_id: job_id.clone(),
            options: serde_json::json!({}),
            sim_type: "top_gear".to_string(),
            ceiling: 2,
            max_active_jobs: Some(1),
            cancel: None,
            affordability: None,
            est_credits_needed: 0,
        };
        run.execute(runner).await;

        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(finished.status, crate::models::JobStatus::Failed);
        let msg = finished.error_message.unwrap_or_default();
        assert!(
            msg.contains("chunk 1"),
            "error should name the failing chunk: {msg}"
        );
    }

    // (d) Cancel mid-run → stops submitting, does not resurrect a Cancelled job.
    #[tokio::test]
    async fn cancel_stops_submitting_and_respects_terminal_state() {
        let pool = pool().await;
        let repo = JobRepo::new(pool.clone());
        let job_id = streamed_top_gear_job(&repo).await;

        // A runner that cancels the job from inside the FIRST chunk's execution,
        // then returns Cancelled — modelling Simmit's cancel acceptance.
        let calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let repo_for_runner = repo.clone();
        let job_for_runner = job_id.clone();
        let runner: ChunkRunner = {
            let calls = calls.clone();
            std::sync::Arc::new(move |req: ChunkRequest| {
                calls.lock().unwrap().push(req.clone());
                let repo = repo_for_runner.clone();
                let jid = job_for_runner.clone();
                Box::pin(async move {
                    // Flip the job to Cancelled (terminal) then report Cancelled
                    // so the orchestrator stops.
                    repo.update_status(&jid, crate::models::JobStatus::Cancelled)
                        .await
                        .unwrap();
                    Err(RunError::Cancelled)
                })
                    as Pin<Box<dyn Future<Output = Result<Value, RunError>> + Send>>
            })
        };

        let cancel = crate::cancel::CancelToken::new(repo.clone(), job_id.clone());

        let run = CloudStreamingRun {
            repo: repo.clone(),
            pool: pool.clone(),
            iter_cfg: five_combo_cfg(),
            base_profile: "server=tichondrius\nregion=us".to_string(),
            job_id: job_id.clone(),
            options: serde_json::json!({}),
            sim_type: "top_gear".to_string(),
            ceiling: 2,
            max_active_jobs: Some(1),
            cancel: Some(cancel),
            affordability: None,
            est_credits_needed: 0,
        };
        run.execute(runner).await;

        // Did NOT submit all 3 chunks (stopped after the cancel).
        assert!(
            calls.lock().unwrap().len() < 3,
            "cancel must stop further submission, got {} calls",
            calls.lock().unwrap().len()
        );
        // Terminal Cancelled status was NOT overwritten with Done/Failed.
        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(finished.status, crate::models::JobStatus::Cancelled);
    }

    // (d) Pause at a chunk boundary → checkpoints + stays Paused (chunk_count>1).
    #[tokio::test]
    async fn pause_at_chunk_boundary_checkpoints_and_stays_paused() {
        let pool = pool().await;
        let repo = JobRepo::new(pool.clone());
        let job_id = streamed_top_gear_job(&repo).await;

        // Request pause up-front; it is honored at the FIRST chunk boundary.
        repo.set_pause_requested(&job_id, true).await.unwrap();

        let calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let runner = fake_runner(calls.clone());

        let run = CloudStreamingRun {
            repo: repo.clone(),
            pool: pool.clone(),
            iter_cfg: five_combo_cfg(),
            base_profile: "server=tichondrius\nregion=us".to_string(),
            job_id: job_id.clone(),
            options: serde_json::json!({}),
            sim_type: "top_gear".to_string(),
            ceiling: 2,
            max_active_jobs: Some(1),
            cancel: None,
            affordability: None,
            est_credits_needed: 0,
        };
        run.execute(runner).await;

        // Stopped before submitting all 3 chunks.
        assert!(
            calls.lock().unwrap().len() < 3,
            "pause must stop at a boundary, got {} calls",
            calls.lock().unwrap().len()
        );
        // Status is Paused (no error), and a CloudStreaming checkpoint was written.
        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(finished.status, crate::models::JobStatus::Paused);
        assert!(finished.error_message.is_none(), "pause is not an error");
        let cp_json = finished.checkpoint.expect("pause writes a checkpoint");
        let cp = crate::profileset_generator::checkpoint::Checkpoint::from_json_str(&cp_json)
            .expect("checkpoint parses");
        assert!(matches!(
            cp.phase,
            crate::profileset_generator::checkpoint::CheckpointPhase::CloudStreaming(_)
        ));
    }

    // Single-chunk pause is a no-op: the run completes (pause only matters for
    // chunk_count > 1).
    #[tokio::test]
    async fn pause_is_noop_for_single_chunk() {
        let pool = pool().await;
        let repo = JobRepo::new(pool.clone());
        let job_id = streamed_top_gear_job(&repo).await;
        repo.set_pause_requested(&job_id, true).await.unwrap();

        let calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let runner = fake_runner(calls.clone());

        let run = CloudStreamingRun {
            repo: repo.clone(),
            pool: pool.clone(),
            iter_cfg: one_combo_cfg(),
            base_profile: "server=tichondrius\nregion=us".to_string(),
            job_id: job_id.clone(),
            options: serde_json::json!({}),
            sim_type: "top_gear".to_string(),
            ceiling: REMOTE_MAX_PROFILESETS_PER_JOB,
            max_active_jobs: None,
            cancel: None,
            affordability: None,
            est_credits_needed: 0,
        };
        run.execute(runner).await;

        // Single chunk completes despite the pause request.
        assert_eq!(calls.lock().unwrap().len(), 1);
        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(finished.status, crate::models::JobStatus::Done);
    }

    // ── Task 10: resume ──────────────────────────────────────────────────────

    /// A `request_json` envelope whose rebuilt iterator yields exactly FIVE combos
    /// ("Combo 1".."Combo 5") — the same product space as `five_combo_cfg`, but
    /// reconstructed through `build_iterator_from_request_json` (one varying head
    /// slot: equipped + 5 alternatives, all selected). Mirrors the envelope
    /// `streaming_top_gear.rs` persists.
    fn five_combo_request_json() -> String {
        let item = |id: u64, equipped: bool| {
            let origin = if equipped { "equipped" } else { "bags" };
            json!({
                "item_id": id,
                "slot": "head",
                "simc_string": format!(",id={}", id),
                "is_equipped": equipped,
                "sockets": 0,
                "bonus_ids": [],
                "enchant_id": 0,
                "gem_id": 0,
                "ilevel": 0,
                "name": format!("Item {}", id),
                "origin": origin,
            })
        };
        let items_by_slot = json!({
            "head": [
                item(100, true),
                item(201, false), item(202, false), item(203, false),
                item(204, false), item(205, false),
            ]
        });
        // UIDs are `{item_id}:{bonus_key}:{origin}:{slot}` — select all 5 alts.
        let selected = json!({
            "head": [
                "201::bags:head", "202::bags:head", "203::bags:head",
                "204::bags:head", "205::bags:head"
            ]
        });
        let envelope = crate::server::request_json::NormalizedRequest::new(
            "top_gear",
            json!({
                "base_profile": "",
                "items_by_slot": items_by_slot,
                "selected_items": selected,
                "options": { "iterations": 100, "target_error": 0.1, "fight_style": "patchwerk" },
            }),
        );
        envelope.to_json_string().unwrap()
    }

    /// Resume a cloud run: 1 completed chunk (folded, NOT re-submitted), 1 in-flight
    /// `submitted` chunk (re-polled, folded), and the remaining tail regenerated
    /// from the checkpoint cursor with a RESTORED `next_name_idx` so names continue
    /// without colliding. Asserts the job finalizes with ALL 5 combos.
    #[tokio::test]
    async fn resume_loads_completed_and_continues_from_cursor() {
        use crate::profileset_generator::checkpoint::{
            Checkpoint, CheckpointPhase, CloudStreamingCheckpoint,
        };
        use crate::profileset_generator::triage::TriageConstants;
        crate::test_support::ensure_game_data_loaded();

        let pool = pool().await;
        let repo = JobRepo::new(pool.clone());
        let cloud_repo = CloudChunksRepo::new(pool.clone());

        let request_json = five_combo_request_json();

        // Derive the cursor + name index AFTER the first 4 combos (chunks 0 and 1,
        // ceiling 2) by replaying the rebuilt iterator — exactly what the original
        // run would have checkpointed at the chunk-1 boundary.
        let cfg = crate::profileset_generator::iterator_from_request::
            build_iterator_from_request_json(&request_json)
            .expect("rebuild iterator");
        let mut probe = ProfilesetIterator::new(cfg);
        let mut emitted = Vec::new();
        for _ in 0..4 {
            emitted.push(probe.next().expect("combo").profileset_name);
        }
        assert_eq!(
            emitted,
            vec!["Combo 1", "Combo 2", "Combo 3", "Combo 4"],
            "the rebuilt iterator must reproduce the original naming"
        );
        let cursor_after_4 = probe.cursor().to_vec();
        let next_name_idx_after_4 = probe.next_name_idx(); // == 5

        // ── Seed a Paused job with the CloudStreaming checkpoint. ────────────
        let mut job = crate::models::Job::new_with_provider(
            String::new(),
            "top_gear".to_string(),
            100,
            "patchwerk".to_string(),
            0.1,
            "simmit".to_string(),
        );
        job.simc_input_mode = crate::models::SimcInputMode::Streamed;
        job.request_json = Some(request_json.clone());
        let checkpoint = Checkpoint {
            phase: CheckpointPhase::CloudStreaming(CloudStreamingCheckpoint {
                next_chunk_idx: 2,
                iterator_cursor: cursor_after_4.clone(),
                chunk_size: 2,
                total_chunks_estimate: 3,
                next_name_idx: next_name_idx_after_4,
            }),
            constants: TriageConstants::default(),
        };
        job.checkpoint = Some(checkpoint.to_json_string().unwrap());
        job.status = crate::models::JobStatus::Paused;
        let job_id = job.id.clone();
        repo.insert(&job).await.unwrap();

        // ── Seed cloud_chunks: chunk 0 completed; chunk 1 submitted (re-poll). ─
        // Ranges are 1-based: chunk 0 covers Combo [1,3), chunk 1 covers [3,5).
        cloud_repo
            .insert_pending_with_lineage(&job_id, 0, 2, None, Some(1))
            .await
            .unwrap();
        cloud_repo
            .mark_submitted(&job_id, 0, "remote-0", "2026-05-30T00:00:00Z")
            .await
            .unwrap();
        let c0_env = ChunkResultEnvelope {
            profilesets: vec![
                json!({ "name": "Combo 1", "mean": 1100.0 }),
                json!({ "name": "Combo 2", "mean": 1050.0 }),
            ],
            base_player: Some(json!({
                "name": "Hero",
                "collected_data": { "dps": { "mean": 1000.0, "mean_std_dev": 0.0 } }
            })),
            // Per-chunk credits persisted at completion time (Bug C): on resume the
            // merged total must fold this stored value, not 0.
            credits: 100,
        };
        cloud_repo
            .mark_completed(&job_id, 0, &c0_env, "2026-05-30T00:01:00Z")
            .await
            .unwrap();
        cloud_repo
            .insert_pending_with_lineage(&job_id, 1, 2, None, Some(3))
            .await
            .unwrap();
        cloud_repo
            .mark_submitted(&job_id, 1, "remote-1", "2026-05-30T00:00:30Z")
            .await
            .unwrap();

        // Seed combo_metadata for the already-persisted chunks (Combo 1..4) so the
        // resume combo_id_base offset is non-zero and the finalize join is faithful.
        super::super::helpers::write_combo_metadata_table_raw(
            &repo,
            &job_id,
            &[
                ("Combo 1".into(), "[]".into()),
                ("Combo 2".into(), "[]".into()),
                ("Combo 3".into(), "[]".into()),
                ("Combo 4".into(), "[]".into()),
            ],
            &[],
        )
        .await;

        // ── Fakes: the new-chunk runner + the in-flight re-poll. ─────────────
        let calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let runner: ChunkRunner = {
            let calls = calls.clone();
            std::sync::Arc::new(move |req: ChunkRequest| {
                calls.lock().unwrap().push(req.clone());
                let names = combo_names(&req.simc_input);
                Box::pin(async move { Ok(result_for(&names)) })
                    as Pin<Box<dyn Future<Output = Result<Value, RunError>> + Send>>
            })
        };
        let repoll_calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let repoll: RepollFn = {
            let repoll_calls = repoll_calls.clone();
            std::sync::Arc::new(move |remote_id: String| {
                repoll_calls.lock().unwrap().push(remote_id.clone());
                // The in-flight chunk 1 carried Combo 3 + Combo 4.
                Box::pin(async move {
                    Ok(result_for(&["Combo 3".to_string(), "Combo 4".to_string()]))
                })
                    as Pin<Box<dyn Future<Output = Result<Value, RunError>> + Send>>
            })
        };

        // ── Drive the resume core directly (HTTP-free). ─────────────────────
        resume_cloud_streaming_inner(
            &job_id,
            &request_json,
            &checkpoint,
            repo.clone(),
            pool.clone(),
            cloud_repo.clone(),
            runner,
            repoll,
            None,
        )
        .await
        .expect("resume succeeds");

        // (a) The completed chunk 0 was NOT re-submitted — the only new-chunk
        // runner call is the regenerated tail (Combo 5).
        let recorded = calls.lock().unwrap();
        assert_eq!(
            recorded.len(),
            1,
            "only the remaining tail chunk should be submitted, got {recorded:?}"
        );
        let tail_names = combo_names(&recorded[0].simc_input);
        assert_eq!(
            tail_names,
            vec!["Combo 5".to_string()],
            "restored next_name_idx must continue naming at Combo 5 (no collision)"
        );
        drop(recorded);

        // (b) The in-flight chunk 1 was re-polled exactly once.
        assert_eq!(repoll_calls.lock().unwrap().as_slice(), &["remote-1"]);

        // (c) All chunk rows are completed (chunk 1 flipped from submitted→completed
        // via re-poll; the new tail chunk recorded + completed).
        let rows = cloud_repo.list_for_job(&job_id).await.unwrap();
        assert!(
            rows.iter().all(|r| r.status == "completed"),
            "all chunks should be completed: {rows:?}"
        );
        assert!(rows.len() >= 3, "0,1 + tail: {rows:?}");

        // (d) The job finalized Done and the merged result carries ALL 5 combos.
        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(finished.status, crate::models::JobStatus::Done);
        let result: Value =
            serde_json::from_str(finished.result_json.as_deref().unwrap()).unwrap();
        let names: Vec<String> = result["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["name"].as_str().unwrap().to_string())
            .collect();
        for n in ["Combo 1", "Combo 2", "Combo 3", "Combo 4", "Combo 5"] {
            assert!(names.iter().any(|x| x == n), "missing {n} in {names:?}");
        }
        // No name collisions: each Combo N appears exactly once.
        for n in ["Combo 1", "Combo 2", "Combo 3", "Combo 4", "Combo 5"] {
            assert_eq!(
                names.iter().filter(|x| *x == n).count(),
                1,
                "{n} must appear exactly once (no resume name collision): {names:?}"
            );
        }

        // (e) Bug C: the merged credits_consumed must include the pre-crash
        // completed chunk 0's persisted credits (100), plus the re-polled chunk 1
        // (100) and the regenerated tail chunk (100) = 300. Before the fix, the
        // completed chunk folded credits=0, under-reporting the total as 200.
        // The merged credits live in the raw merged SimC doc (raw_json), which is
        // what the result-page footer reads.
        let raw: Value =
            serde_json::from_str(finished.raw_json.as_deref().unwrap()).unwrap();
        assert_eq!(
            raw["simmit"]["credits_consumed"], 300,
            "resume must fold the completed chunk's persisted credits, not 0"
        );
    }

    /// Finding 1 regression: a retry-split persisted tail `cloud_chunks` rows at
    /// indices >= the checkpoint's `next_chunk_idx`, then a crash landed before the
    /// next generation-boundary checkpoint advanced. On resume the chunk-idx
    /// allocator must be seeded PAST the max existing row (not blindly from the
    /// lagging checkpoint), so the next real chunk gets a fresh index and does NOT
    /// collide on the `(job_id, chunk_idx)` PK.
    #[tokio::test]
    async fn resume_seeds_allocator_past_retry_tail_rows_without_pk_collision() {
        use crate::profileset_generator::checkpoint::{
            Checkpoint, CheckpointPhase, CloudStreamingCheckpoint,
        };
        use crate::profileset_generator::triage::TriageConstants;
        crate::test_support::ensure_game_data_loaded();

        let pool = pool().await;
        let repo = JobRepo::new(pool.clone());
        let cloud_repo = CloudChunksRepo::new(pool.clone());

        let request_json = five_combo_request_json();

        // Cursor + name index AFTER the first 4 combos (chunks 0 and 1, ceiling 2).
        let cfg = crate::profileset_generator::iterator_from_request::
            build_iterator_from_request_json(&request_json)
            .expect("rebuild iterator");
        let mut probe = ProfilesetIterator::new(cfg);
        for _ in 0..4 {
            probe.next().expect("combo");
        }
        let cursor_after_4 = probe.cursor().to_vec();
        let next_name_idx_after_4 = probe.next_name_idx(); // == 5

        // Checkpoint LAGS at next_chunk_idx = 2: it was written at the chunk-1
        // generation boundary, BEFORE chunk 1's retry-split claimed tail indices.
        let checkpoint = Checkpoint {
            phase: CheckpointPhase::CloudStreaming(CloudStreamingCheckpoint {
                next_chunk_idx: 2,
                iterator_cursor: cursor_after_4.clone(),
                chunk_size: 2,
                total_chunks_estimate: 3,
                next_name_idx: next_name_idx_after_4,
            }),
            constants: TriageConstants::default(),
        };

        let mut job = crate::models::Job::new_with_provider(
            String::new(),
            "top_gear".to_string(),
            100,
            "patchwerk".to_string(),
            0.1,
            "simmit".to_string(),
        );
        job.simc_input_mode = crate::models::SimcInputMode::Streamed;
        job.request_json = Some(request_json.clone());
        job.checkpoint = Some(checkpoint.to_json_string().unwrap());
        job.status = crate::models::JobStatus::Paused;
        let job_id = job.id.clone();
        repo.insert(&job).await.unwrap();

        // ── cloud_chunks state at crash time ────────────────────────────────
        // chunk 0 completed (Combo 1,2). chunk 1 FAILED (Combo 3,4) and was
        // retry-split into two size-1 sub-chunks at TAIL indices 2 and 3 — both
        // COMPLETED — but the checkpoint never advanced past next_chunk_idx = 2.
        // Ranges are 1-based: chunk 0 covers [1,3); chunk 1 (failed parent) [3,5);
        // its children cover [3,4) and [4,5), tiling the parent → superseded.
        cloud_repo
            .insert_pending_with_lineage(&job_id, 0, 2, None, Some(1))
            .await
            .unwrap();
        cloud_repo
            .mark_submitted(&job_id, 0, "remote-0", "2026-05-30T00:00:00Z")
            .await
            .unwrap();
        let c0_env = ChunkResultEnvelope {
            profilesets: vec![
                json!({ "name": "Combo 1", "mean": 1100.0 }),
                json!({ "name": "Combo 2", "mean": 1050.0 }),
            ],
            base_player: Some(json!({
                "name": "Hero",
                "collected_data": { "dps": { "mean": 1000.0, "mean_std_dev": 0.0 } }
            })),
            credits: 0,
        };
        cloud_repo
            .mark_completed(&job_id, 0, &c0_env, "2026-05-30T00:01:00Z")
            .await
            .unwrap();
        // The original chunk-1 row, flipped to failed by the retry path.
        cloud_repo
            .insert_pending_with_lineage(&job_id, 1, 2, None, Some(3))
            .await
            .unwrap();
        cloud_repo.mark_failed(&job_id, 1).await.unwrap();
        // Retry sub-chunk rows at tail indices 2 and 3 (>= checkpoint next=2),
        // linked to parent chunk 1, each covering one combo of its range.
        for (idx, combo, first) in [(2i64, "Combo 3", 3i64), (3i64, "Combo 4", 4i64)] {
            cloud_repo
                .insert_pending_with_lineage(&job_id, idx, 1, Some(1), Some(first))
                .await
                .unwrap();
            cloud_repo
                .mark_submitted(&job_id, idx, &format!("remote-{idx}"), "2026-05-30T00:00:10Z")
                .await
                .unwrap();
            cloud_repo
                .mark_completed(
                    &job_id,
                    idx,
                    &ChunkResultEnvelope {
                        profilesets: vec![json!({ "name": combo, "mean": 1000.0 })],
                        base_player: None,
                        credits: 0,
                    },
                    "2026-05-30T00:01:10Z",
                )
                .await
                .unwrap();
        }

        super::super::helpers::write_combo_metadata_table_raw(
            &repo,
            &job_id,
            &[
                ("Combo 1".into(), "[]".into()),
                ("Combo 2".into(), "[]".into()),
                ("Combo 3".into(), "[]".into()),
                ("Combo 4".into(), "[]".into()),
            ],
            &[],
        )
        .await;

        // New-chunk runner (echoes its combos); the resume insert_pending for the
        // tail chunk MUST NOT hit a PK collision with the existing rows 2/3.
        let calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let runner: ChunkRunner = {
            let calls = calls.clone();
            std::sync::Arc::new(move |req: ChunkRequest| {
                calls.lock().unwrap().push(req.clone());
                let names = combo_names(&req.simc_input);
                Box::pin(async move { Ok(result_for(&names)) })
                    as Pin<Box<dyn Future<Output = Result<Value, RunError>> + Send>>
            })
        };
        // No `submitted` rows here, so re-poll is never exercised.
        let repoll: RepollFn = std::sync::Arc::new(move |remote_id: String| {
            Box::pin(async move {
                Err(RunError::Other(format!("unexpected re-poll of {remote_id}")))
            }) as Pin<Box<dyn Future<Output = Result<Value, RunError>> + Send>>
        });

        resume_cloud_streaming_inner(
            &job_id,
            &request_json,
            &checkpoint,
            repo.clone(),
            pool.clone(),
            cloud_repo.clone(),
            runner,
            repoll,
            None,
        )
        .await
        .expect("resume succeeds without a PK collision");

        // The tail chunk (Combo 5) was generated and submitted at a FRESH index
        // past the existing max (3), i.e. >= 4 — no PK collision.
        let recorded = calls.lock().unwrap();
        assert_eq!(recorded.len(), 1, "only the tail chunk should submit: {recorded:?}");
        assert_eq!(combo_names(&recorded[0].simc_input), vec!["Combo 5".to_string()]);
        assert!(
            recorded[0].chunk_idx >= 4,
            "tail chunk_idx must be past the retry-tail rows (>=4), got {}",
            recorded[0].chunk_idx
        );
        drop(recorded);

        // All rows completed; the tail row exists at the reconciled index.
        let rows = cloud_repo.list_for_job(&job_id).await.unwrap();
        let completed = rows.iter().filter(|r| r.status == "completed").count();
        // chunk 0 + two retry sub-chunks (2,3) + the new tail = 4 completed.
        assert_eq!(completed, 4, "rows: {rows:?}");
        assert!(
            rows.iter().any(|r| r.chunk_idx >= 4 && r.status == "completed"),
            "the tail chunk row must land past index 3: {rows:?}"
        );

        // The job finalized Done with all 5 combos, each exactly once.
        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(finished.status, crate::models::JobStatus::Done);
        let result: Value =
            serde_json::from_str(finished.result_json.as_deref().unwrap()).unwrap();
        let names: Vec<String> = result["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["name"].as_str().unwrap().to_string())
            .collect();
        for n in ["Combo 1", "Combo 2", "Combo 3", "Combo 4", "Combo 5"] {
            assert_eq!(
                names.iter().filter(|x| *x == n).count(),
                1,
                "{n} must appear exactly once: {names:?}"
            );
        }
    }

    // ── Task 11: from-start resume walk (full recovery) ──────────────────────

    /// Build a `CloudStreaming` checkpoint with the given `next_chunk_idx`/cursor.
    /// The from-start walk regenerates chunks itself, so only `next_chunk_idx`
    /// (tail-allocator floor) and `chunk_size` are load-bearing here.
    fn cloud_checkpoint(
        next_chunk_idx: usize,
        cursor: Vec<usize>,
        next_name_idx: usize,
    ) -> crate::profileset_generator::checkpoint::Checkpoint {
        use crate::profileset_generator::checkpoint::{
            Checkpoint, CheckpointPhase, CloudStreamingCheckpoint,
        };
        use crate::profileset_generator::triage::TriageConstants;
        Checkpoint {
            phase: CheckpointPhase::CloudStreaming(CloudStreamingCheckpoint {
                next_chunk_idx,
                iterator_cursor: cursor,
                chunk_size: 2,
                total_chunks_estimate: 3,
                next_name_idx,
            }),
            constants: TriageConstants::default(),
        }
    }

    /// Insert a Paused streamed top_gear job carrying the five-combo request +
    /// checkpoint, and seed combo_metadata for Combo 1..4 (the already-persisted
    /// chunks). Returns the job_id.
    async fn seed_resume_job(
        repo: &JobRepo,
        request_json: &str,
        checkpoint: &crate::profileset_generator::checkpoint::Checkpoint,
    ) -> String {
        let mut job = crate::models::Job::new_with_provider(
            String::new(),
            "top_gear".to_string(),
            100,
            "patchwerk".to_string(),
            0.1,
            "simmit".to_string(),
        );
        job.simc_input_mode = crate::models::SimcInputMode::Streamed;
        job.request_json = Some(request_json.to_string());
        job.checkpoint = Some(checkpoint.to_json_string().unwrap());
        job.status = crate::models::JobStatus::Paused;
        let job_id = job.id.clone();
        repo.insert(&job).await.unwrap();
        super::super::helpers::write_combo_metadata_table_raw(
            repo,
            &job_id,
            &[
                ("Combo 1".into(), "[]".into()),
                ("Combo 2".into(), "[]".into()),
                ("Combo 3".into(), "[]".into()),
                ("Combo 4".into(), "[]".into()),
            ],
            &[],
        )
        .await;
        job_id
    }

    /// A fake new-chunk runner that echoes the combos it was handed (records calls).
    fn echo_runner(calls: std::sync::Arc<Mutex<Vec<ChunkRequest>>>) -> ChunkRunner {
        std::sync::Arc::new(move |req: ChunkRequest| {
            calls.lock().unwrap().push(req.clone());
            let names = combo_names(&req.simc_input);
            Box::pin(async move { Ok(result_for(&names)) })
                as Pin<Box<dyn Future<Output = Result<Value, RunError>> + Send>>
        })
    }

    /// A re-poll that always errors (asserts re-poll was NOT exercised).
    fn never_repoll() -> RepollFn {
        std::sync::Arc::new(move |remote_id: String| {
            Box::pin(async move {
                Err(RunError::Other(format!("unexpected re-poll of {remote_id}")))
            }) as Pin<Box<dyn Future<Output = Result<Value, RunError>> + Send>>
        })
    }

    fn names_of(result: &Value) -> Vec<String> {
        result["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["name"].as_str().unwrap().to_string())
            .collect()
    }

    // Bug A: a PRE-CURSOR `failed` chunk (no live remote, range uncovered) is
    // regenerated + re-submitted on resume — its combos are NOT silently dropped,
    // and Done is reached only after every range is covered.
    #[tokio::test]
    async fn resume_recovers_pre_cursor_failed_chunk() {
        crate::test_support::ensure_game_data_loaded();
        let pool = pool().await;
        let repo = JobRepo::new(pool.clone());
        let cloud_repo = CloudChunksRepo::new(pool.clone());
        let request_json = five_combo_request_json();

        // Cursor after the first 6 combos doesn't matter (walk is from-start); the
        // checkpoint's next_chunk_idx=3 marks chunks 0,1,2 as generated.
        let checkpoint = cloud_checkpoint(3, vec![5], 7);
        let job_id = seed_resume_job(&repo, &request_json, &checkpoint).await;

        // chunk 0 completed [1,3); chunk 1 FAILED [3,5) with NO live remote (its
        // remote was lost) and NO superseding children → must be re-submitted;
        // chunk 2 completed [5,6). The checkpoint cursor is PAST chunk 2.
        cloud_repo
            .insert_pending_with_lineage(&job_id, 0, 2, None, Some(1))
            .await
            .unwrap();
        cloud_repo
            .mark_completed(
                &job_id,
                0,
                &ChunkResultEnvelope {
                    profilesets: vec![
                        json!({ "name": "Combo 1", "mean": 1100.0 }),
                        json!({ "name": "Combo 2", "mean": 1050.0 }),
                    ],
                    base_player: Some(json!({
                        "name": "Hero",
                        "collected_data": { "dps": { "mean": 1000.0, "mean_std_dev": 0.0 } }
                    })),
                    credits: 0,
                },
                "2026-05-30T00:01:00Z",
            )
            .await
            .unwrap();
        // The pre-cursor failed chunk with no usable remote id.
        cloud_repo
            .insert_pending_with_lineage(&job_id, 1, 2, None, Some(3))
            .await
            .unwrap();
        cloud_repo.mark_failed(&job_id, 1).await.unwrap();
        cloud_repo
            .insert_pending_with_lineage(&job_id, 2, 1, None, Some(5))
            .await
            .unwrap();
        cloud_repo
            .mark_completed(
                &job_id,
                2,
                &ChunkResultEnvelope {
                    profilesets: vec![json!({ "name": "Combo 5", "mean": 1000.0 })],
                    base_player: None,
                    credits: 0,
                },
                "2026-05-30T00:01:00Z",
            )
            .await
            .unwrap();

        let calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let runner = echo_runner(calls.clone());

        resume_cloud_streaming_inner(
            &job_id,
            &request_json,
            &checkpoint,
            repo.clone(),
            pool.clone(),
            cloud_repo.clone(),
            runner,
            never_repoll(),
            None,
        )
        .await
        .expect("resume succeeds");

        // The pre-cursor failed chunk 1 (Combo 3,4) was re-submitted (and nothing
        // else — completed chunks are never re-submitted).
        let recorded = calls.lock().unwrap();
        assert_eq!(recorded.len(), 1, "only the failed chunk re-submits: {recorded:?}");
        assert_eq!(
            combo_names(&recorded[0].simc_input),
            vec!["Combo 3".to_string(), "Combo 4".to_string()],
        );
        // It re-used chunk 1's own row index (not a fresh tail index).
        assert_eq!(recorded[0].chunk_idx, 1);
        drop(recorded);

        // Done with ALL 5 combos, each exactly once (chunk 1's combos recovered).
        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(finished.status, crate::models::JobStatus::Done);
        let names = names_of(&serde_json::from_str::<Value>(
            finished.result_json.as_deref().unwrap(),
        )
        .unwrap());
        for n in ["Combo 1", "Combo 2", "Combo 3", "Combo 4", "Combo 5"] {
            assert_eq!(
                names.iter().filter(|x| *x == n).count(),
                1,
                "{n} must appear exactly once: {names:?}"
            );
        }
    }

    // Bug B: a `failed` chunk that STILL has a live remote job is re-polled (not
    // regenerated). The re-poll recovers it and it is folded.
    #[tokio::test]
    async fn resume_repolls_failed_chunk_with_live_remote() {
        crate::test_support::ensure_game_data_loaded();
        let pool = pool().await;
        let repo = JobRepo::new(pool.clone());
        let cloud_repo = CloudChunksRepo::new(pool.clone());
        let request_json = five_combo_request_json();

        let checkpoint = cloud_checkpoint(2, vec![3], 5);
        let job_id = seed_resume_job(&repo, &request_json, &checkpoint).await;

        // chunk 0 completed [1,3); chunk 1 FAILED [3,5) but with a LIVE remote.
        cloud_repo
            .insert_pending_with_lineage(&job_id, 0, 2, None, Some(1))
            .await
            .unwrap();
        cloud_repo
            .mark_completed(
                &job_id,
                0,
                &ChunkResultEnvelope {
                    profilesets: vec![
                        json!({ "name": "Combo 1", "mean": 1100.0 }),
                        json!({ "name": "Combo 2", "mean": 1050.0 }),
                    ],
                    base_player: Some(json!({
                        "name": "Hero",
                        "collected_data": { "dps": { "mean": 1000.0, "mean_std_dev": 0.0 } }
                    })),
                    credits: 0,
                },
                "2026-05-30T00:01:00Z",
            )
            .await
            .unwrap();
        cloud_repo
            .insert_pending_with_lineage(&job_id, 1, 2, None, Some(3))
            .await
            .unwrap();
        // Mark submitted (records a live remote id) THEN failed — the live remote
        // survives the failure flip (mark_failed only changes status).
        cloud_repo
            .mark_submitted(&job_id, 1, "live-remote-1", "2026-05-30T00:00:30Z")
            .await
            .unwrap();
        cloud_repo.mark_failed(&job_id, 1).await.unwrap();

        let calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let runner = echo_runner(calls.clone());
        let repoll_calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let repoll: RepollFn = {
            let repoll_calls = repoll_calls.clone();
            std::sync::Arc::new(move |remote_id: String| {
                repoll_calls.lock().unwrap().push(remote_id.clone());
                Box::pin(async move {
                    Ok(result_for(&["Combo 3".to_string(), "Combo 4".to_string()]))
                })
                    as Pin<Box<dyn Future<Output = Result<Value, RunError>> + Send>>
            })
        };

        resume_cloud_streaming_inner(
            &job_id,
            &request_json,
            &checkpoint,
            repo.clone(),
            pool.clone(),
            cloud_repo.clone(),
            runner,
            repoll,
            None,
        )
        .await
        .expect("resume succeeds");

        // The failed-with-live-remote chunk 1 was RE-POLLED (Bug B), not regenerated.
        assert_eq!(repoll_calls.lock().unwrap().as_slice(), &["live-remote-1"]);
        // Only the tail (Combo 5) was submitted via the runner — chunk 1 was folded.
        let recorded = calls.lock().unwrap();
        assert_eq!(recorded.len(), 1, "only the tail submits: {recorded:?}");
        assert_eq!(combo_names(&recorded[0].simc_input), vec!["Combo 5".to_string()]);
        drop(recorded);

        // chunk 1 flipped failed→completed via the re-poll.
        let rows = cloud_repo.list_for_job(&job_id).await.unwrap();
        assert_eq!(
            rows.iter().find(|r| r.chunk_idx == 1).unwrap().status,
            "completed"
        );

        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(finished.status, crate::models::JobStatus::Done);
        let names = names_of(&serde_json::from_str::<Value>(
            finished.result_json.as_deref().unwrap(),
        )
        .unwrap());
        for n in ["Combo 1", "Combo 2", "Combo 3", "Combo 4", "Combo 5"] {
            assert_eq!(names.iter().filter(|x| *x == n).count(), 1, "{names:?}");
        }
    }

    // A `failed` retry parent whose completed children tile its range is provably
    // superseded: it is NOT re-run (no PK collision; its combos appear once).
    #[tokio::test]
    async fn resume_skips_superseded_retry_parent() {
        crate::test_support::ensure_game_data_loaded();
        let pool = pool().await;
        let repo = JobRepo::new(pool.clone());
        let cloud_repo = CloudChunksRepo::new(pool.clone());
        let request_json = five_combo_request_json();

        let checkpoint = cloud_checkpoint(2, vec![3], 5);
        let job_id = seed_resume_job(&repo, &request_json, &checkpoint).await;

        // chunk 0 completed [1,3). chunk 1 FAILED parent [3,5); children at tail
        // idx 2,3 completed and tile [3,4)+[4,5) → parent superseded.
        cloud_repo
            .insert_pending_with_lineage(&job_id, 0, 2, None, Some(1))
            .await
            .unwrap();
        cloud_repo
            .mark_completed(
                &job_id,
                0,
                &ChunkResultEnvelope {
                    profilesets: vec![
                        json!({ "name": "Combo 1", "mean": 1100.0 }),
                        json!({ "name": "Combo 2", "mean": 1050.0 }),
                    ],
                    base_player: Some(json!({
                        "name": "Hero",
                        "collected_data": { "dps": { "mean": 1000.0, "mean_std_dev": 0.0 } }
                    })),
                    credits: 0,
                },
                "2026-05-30T00:01:00Z",
            )
            .await
            .unwrap();
        cloud_repo
            .insert_pending_with_lineage(&job_id, 1, 2, None, Some(3))
            .await
            .unwrap();
        cloud_repo.mark_failed(&job_id, 1).await.unwrap();
        for (idx, combo, first) in [(2i64, "Combo 3", 3i64), (3i64, "Combo 4", 4i64)] {
            cloud_repo
                .insert_pending_with_lineage(&job_id, idx, 1, Some(1), Some(first))
                .await
                .unwrap();
            cloud_repo
                .mark_completed(
                    &job_id,
                    idx,
                    &ChunkResultEnvelope {
                        profilesets: vec![json!({ "name": combo, "mean": 1000.0 })],
                        base_player: None,
                        credits: 0,
                    },
                    "2026-05-30T00:01:10Z",
                )
                .await
                .unwrap();
        }

        let calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let runner = echo_runner(calls.clone());

        resume_cloud_streaming_inner(
            &job_id,
            &request_json,
            &checkpoint,
            repo.clone(),
            pool.clone(),
            cloud_repo.clone(),
            runner,
            never_repoll(),
            None,
        )
        .await
        .expect("resume succeeds (superseded parent not re-run)");

        // The superseded parent (Combo 3,4) was NOT re-submitted: only the tail
        // (Combo 5) reaches the runner.
        let recorded = calls.lock().unwrap();
        assert_eq!(recorded.len(), 1, "only the tail submits: {recorded:?}");
        assert_eq!(combo_names(&recorded[0].simc_input), vec!["Combo 5".to_string()]);
        // The parent stays `failed` (it was legitimately superseded; never resurrected).
        drop(recorded);
        let rows = cloud_repo.list_for_job(&job_id).await.unwrap();
        assert_eq!(
            rows.iter().find(|r| r.chunk_idx == 1).unwrap().status,
            "failed",
            "superseded parent must remain failed (not resurrected): {rows:?}"
        );

        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(finished.status, crate::models::JobStatus::Done);
        let names = names_of(&serde_json::from_str::<Value>(
            finished.result_json.as_deref().unwrap(),
        )
        .unwrap());
        for n in ["Combo 1", "Combo 2", "Combo 3", "Combo 4", "Combo 5"] {
            assert_eq!(
                names.iter().filter(|x| *x == n).count(),
                1,
                "{n} appears exactly once (no double-count with superseded parent): {names:?}"
            );
        }
    }

    // The completeness guard (defense-in-depth): if — after the walk + tail loop —
    // the persisted completed ranges do NOT tile [1, total+1), the job MUST NOT
    // finalize Done. It is left PAUSED (the frontend Resume affordance shows for
    // Paused) with the CloudStreaming checkpoint preserved, so the user can resume
    // again — never silently dropping combos.
    //
    // The from-start walk re-submits every non-completed generated chunk, so a
    // recoverable gap can't arise from the generated walk in normal flow; this
    // drives `run_chunk_loop` (the finalize site the guard guards) directly with a
    // deliberately-incomplete row set and an exhausted iterator (no tail to fill
    // the gap), proving the guard refuses Done.
    #[tokio::test]
    async fn resume_guard_keeps_incomplete_job_resumable() {
        crate::test_support::ensure_game_data_loaded();
        let pool = pool().await;
        let repo = JobRepo::new(pool.clone());
        let cloud_repo = CloudChunksRepo::new(pool.clone());
        let request_json = five_combo_request_json();

        // Seed a Paused job whose checkpoint is preserved across the guard.
        let checkpoint = cloud_checkpoint(3, vec![5], 6);
        let job_id = seed_resume_job(&repo, &request_json, &checkpoint).await;

        // Persisted coverage has a HOLE: chunk 0 completed [1,3) and chunk 2
        // completed [5,6), but [3,5) is never covered (its chunk was lost and not
        // recoverable). total = 5 → emitted space [1,6); [3,5) is uncovered.
        cloud_repo
            .insert_pending_with_lineage(&job_id, 0, 2, None, Some(1))
            .await
            .unwrap();
        cloud_repo
            .mark_completed(
                &job_id,
                0,
                &ChunkResultEnvelope {
                    profilesets: vec![
                        json!({ "name": "Combo 1", "mean": 1100.0 }),
                        json!({ "name": "Combo 2", "mean": 1050.0 }),
                    ],
                    base_player: Some(json!({
                        "name": "Hero",
                        "collected_data": { "dps": { "mean": 1000.0, "mean_std_dev": 0.0 } }
                    })),
                    credits: 0,
                },
                "2026-05-30T00:01:00Z",
            )
            .await
            .unwrap();
        cloud_repo
            .insert_pending_with_lineage(&job_id, 2, 1, None, Some(5))
            .await
            .unwrap();
        cloud_repo
            .mark_completed(
                &job_id,
                2,
                &ChunkResultEnvelope {
                    profilesets: vec![json!({ "name": "Combo 5", "mean": 1000.0 })],
                    base_player: None,
                    credits: 0,
                },
                "2026-05-30T00:01:00Z",
            )
            .await
            .unwrap();

        let run = CloudStreamingRun {
            repo: repo.clone(),
            pool: pool.clone(),
            iter_cfg: five_combo_cfg(),
            base_profile: String::new(),
            options: serde_json::json!({}),
            job_id: job_id.clone(),
            sim_type: "top_gear".to_string(),
            ceiling: 2,
            max_active_jobs: Some(1),
            cancel: None,
            affordability: None,
            est_credits_needed: 0,
        };

        // An iterator already EXHAUSTED (seeked to the end) so the tail loop
        // generates nothing — the [3,5) hole cannot be filled and the guard fires.
        let mut it = ProfilesetIterator::new(five_combo_cfg());
        while it.next().is_some() {}

        let calls = std::sync::Arc::new(Mutex::new(Vec::new()));
        let runner = echo_runner(calls.clone());

        run.run_chunk_loop(
            &cloud_repo,
            it,
            runner,
            ChunkAccumulator::new(),
            /*start_chunk_idx=*/ 3,
            /*combo_id_base=*/ 5,
            /*first=*/ None,
            /*resume_guard=*/ true,
        )
        .await;

        // No tail submitted (iterator exhausted).
        assert!(calls.lock().unwrap().is_empty(), "no tail chunk should submit");

        // Guard fired: NOT Done (no silent drop of Combo 3,4); left PAUSED so the
        // user can resume again; the CloudStreaming checkpoint is preserved.
        let finished = repo.get(&job_id).await.unwrap().unwrap();
        assert_eq!(
            finished.status,
            crate::models::JobStatus::Paused,
            "incomplete coverage must keep the job resumable, not Done"
        );
        assert!(
            finished.result_json.is_none(),
            "guard must not write a Done result"
        );
        let cp_json = finished.checkpoint.expect("checkpoint preserved for re-resume");
        assert!(matches!(
            crate::profileset_generator::checkpoint::Checkpoint::from_json_str(&cp_json)
                .unwrap()
                .phase,
            crate::profileset_generator::checkpoint::CheckpointPhase::CloudStreaming(_)
        ));
    }

    // ── Direct interval-math tests ───────────────────────────────────────────
    // `merge_intervals`/`subtract_covered` are the core of the coverage proof and
    // were only exercised transitively via `coverage_report`. These lock the
    // half-open `[start, end)` math so a future refactor is caught in isolation.

    #[test]
    fn merge_intervals_merges_adjacent_overlapping_and_unsorted() {
        // Empty input → empty.
        assert_eq!(merge_intervals(vec![]), vec![]);

        // Adjacent half-open ranges fuse: [1,3) + [3,5) → [1,5).
        assert_eq!(merge_intervals(vec![(1, 3), (3, 5)]), vec![(1, 5)]);

        // Overlapping ranges fuse to their union.
        assert_eq!(merge_intervals(vec![(1, 4), (2, 6)]), vec![(1, 6)]);

        // Out-of-order input is sorted before merging.
        assert_eq!(merge_intervals(vec![(5, 7), (1, 3), (3, 5)]), vec![(1, 7)]);

        // A real gap is preserved (a 1-wide gap at the boundary): [1,3) and [4,6)
        // do NOT touch (3 != 4), so they stay two disjoint ranges.
        assert_eq!(merge_intervals(vec![(1, 3), (4, 6)]), vec![(1, 3), (4, 6)]);

        // Single combo range survives as-is.
        assert_eq!(merge_intervals(vec![(2, 3)]), vec![(2, 3)]);

        // Empty/inverted ranges (e > s violated) are dropped.
        assert_eq!(merge_intervals(vec![(4, 4), (1, 1)]), vec![]);
    }

    #[test]
    fn subtract_covered_reports_half_open_gaps() {
        // Fully covered → no gaps.
        assert_eq!(subtract_covered(1, 6, &[(1, 6)]), vec![]);

        // No coverage → the whole range is the gap.
        assert_eq!(subtract_covered(1, 6, &[]), vec![(1, 6)]);

        // A single interior hole: [1,3) and [5,6) covered → gap [3,5).
        assert_eq!(subtract_covered(1, 6, &[(1, 3), (5, 6)]), vec![(3, 5)]);

        // Adjacent covers leave no gap (boundary-exact): [1,3)+[3,5) tile [1,5).
        assert_eq!(subtract_covered(1, 5, &[(1, 3), (3, 5)]), vec![]);

        // A covered interval entirely BEFORE lo is ignored.
        assert_eq!(subtract_covered(5, 8, &[(1, 3)]), vec![(5, 8)]);

        // A covered interval entirely AFTER hi is ignored.
        assert_eq!(subtract_covered(1, 4, &[(6, 9)]), vec![(1, 4)]);

        // Coverage overhanging both ends is clamped to [lo, hi).
        assert_eq!(subtract_covered(2, 5, &[(0, 10)]), vec![]);

        // Single-combo range left uncovered.
        assert_eq!(subtract_covered(3, 4, &[]), vec![(3, 4)]);
    }
}
