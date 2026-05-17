//! Calibration harness for the Triage stage.
//!
//! Reads a captured Top Gear scenario JSON (a `NormalizedRequest` envelope —
//! exactly the shape stored in `jobs.request_json`), runs Triage across a
//! 3-axis grid (batch_size, iterations, cutoff_multiplier), measures
//! per-grid-point wall time and survivor-recall vs a reference baseline,
//! writes the results to a companion JSON file.
//!
//! Usage:
//!   simhammer-calibration <scenario.json> [--baseline <baseline.json>] \
//!     [--simc-bin <path>] [--out <path>]
//!
//! See `calibration/README.md` for the full process.

use clap::Parser;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use simhammer_core::db::{ComboMetadataRepo, Database};
use simhammer_core::log_buffer::LogBuffer;
use simhammer_core::profileset_generator::{
    build_iterator_from_request_json,
    triage::{run_triage_with_constants, TriageConstants, TriageRunInputs},
};

#[derive(Parser, Debug)]
#[command(name = "simhammer-calibration")]
struct Args {
    /// Path to a captured Top Gear scenario JSON (a NormalizedRequest envelope
    /// — copy this from `jobs.request_json` for a streamed-mode Top Gear sim).
    scenario: PathBuf,

    /// Optional baseline JSON with the reference top-N ranked profilesets for
    /// survivor-recall measurement. See README §2.
    #[arg(long)]
    baseline: Option<PathBuf>,

    /// Path to the simc binary.
    #[arg(long, default_value = "simc")]
    simc_bin: PathBuf,

    /// Where to write the grid results JSON. Default: <scenario>.calibration.json.
    #[arg(long)]
    out: Option<PathBuf>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GridPoint {
    batch_size_target_bytes: usize,
    triage_iterations: u32,
    triage_cutoff_multiplier: f64,
    end_to_end_seconds: f64,
    triage_survivors: usize,
    total_batches: usize,
    total_candidates: usize,
    total_accepted: usize,
    /// Number of baseline top-N combos missing from this grid point's survivors.
    /// `Some(0)` = perfect recall; `None` = no baseline supplied.
    /// Note: matches by combo_name. Streaming and eager iterators assign names
    /// in their own order, so identical combos may have different names across
    /// runs — for true content-based matching, the baseline export needs to
    /// include the profileset_simc content per combo. v1 limitation.
    winner_loss_count: Option<usize>,
    notes: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();

    let scenario_text = std::fs::read_to_string(&args.scenario)?;
    println!("Loaded scenario: {}", args.scenario.display());

    // Parse the envelope once to pull out fight_style / target_error / base_profile.
    // build_iterator_from_request_json validates the rest of the payload shape.
    let envelope: serde_json::Value = serde_json::from_str(&scenario_text)?;
    let payload = envelope
        .get("payload")
        .ok_or("scenario JSON missing `payload` field — expected a NormalizedRequest envelope")?;
    let base_profile = payload
        .get("base_profile")
        .and_then(|v| v.as_str())
        .ok_or("payload missing `base_profile`")?
        .to_string();
    let options = payload
        .get("options")
        .ok_or("payload missing `options`")?;
    let fight_style = options
        .get("fight_style")
        .and_then(|v| v.as_str())
        .unwrap_or("Patchwerk")
        .to_string();
    let target_error = options
        .get("target_error")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.05);

    let baseline_top: Option<Vec<String>> = if let Some(p) = &args.baseline {
        let text = std::fs::read_to_string(p)?;
        let baseline: serde_json::Value = serde_json::from_str(&text)?;
        // Accept either `top_10` (legacy README) or `top` (forward-compat).
        baseline
            .get("top_10")
            .or_else(|| baseline.get("top"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|e| {
                        e.get("combo_name")
                            .and_then(|n| n.as_str())
                            .map(String::from)
                    })
                    .collect()
            })
    } else {
        None
    };

    // Grid axes per spec §3.
    let batch_sizes: Vec<usize> = vec![
        1 * 1024 * 1024,
        4 * 1024 * 1024,
        16 * 1024 * 1024,
        32 * 1024 * 1024,
        64 * 1024 * 1024,
    ];
    let iterations: Vec<u32> = vec![25, 50, 100];
    let cutoff_mults: Vec<f64> = vec![2.0, 3.0, 4.0];

    let total_points = batch_sizes.len() * iterations.len() * cutoff_mults.len();
    println!(
        "Running {} grid points ({} batch_sizes x {} iterations x {} cutoff_mults)",
        total_points,
        batch_sizes.len(),
        iterations.len(),
        cutoff_mults.len()
    );

    let mut results: Vec<GridPoint> = Vec::new();
    let mut grid_idx = 0usize;

    for &bsize in &batch_sizes {
        for &iters in &iterations {
            for &cutoff in &cutoff_mults {
                grid_idx += 1;
                println!(
                    "[grid {:>2}/{}] batch_bytes={}, iters={}, cutoff={}",
                    grid_idx, total_points, bsize, iters, cutoff
                );

                let outcome = run_one_grid_point(
                    &scenario_text,
                    &base_profile,
                    &fight_style,
                    target_error,
                    &args.simc_bin,
                    grid_idx,
                    bsize,
                    iters,
                    cutoff,
                    baseline_top.as_deref(),
                )
                .await;

                match outcome {
                    Ok(point) => results.push(point),
                    Err(e) => {
                        eprintln!("[grid {}] FAILED: {}", grid_idx, e);
                        results.push(GridPoint {
                            batch_size_target_bytes: bsize,
                            triage_iterations: iters,
                            triage_cutoff_multiplier: cutoff,
                            end_to_end_seconds: 0.0,
                            triage_survivors: 0,
                            total_batches: 0,
                            total_candidates: 0,
                            total_accepted: 0,
                            winner_loss_count: None,
                            notes: format!("FAILED: {}", e),
                        });
                    }
                }
            }
        }
    }

    let out_path = args
        .out
        .unwrap_or_else(|| args.scenario.with_extension("calibration.json"));
    std::fs::write(&out_path, serde_json::to_string_pretty(&results)?)?;
    println!("Wrote {}", out_path.display());

    Ok(())
}

/// Run a single grid point against a fresh in-memory SQLite DB. Each grid point
/// gets its own pool + job_id so survivors don't leak across points.
async fn run_one_grid_point(
    scenario_json: &str,
    base_profile: &str,
    fight_style: &str,
    target_error: f64,
    simc_bin: &std::path::Path,
    grid_idx: usize,
    bsize: usize,
    iters: u32,
    cutoff: f64,
    baseline_top: Option<&[String]>,
) -> Result<GridPoint, String> {
    let job_id = format!("calibration-{}", grid_idx);

    // Fresh DB per grid point — keeps combo_metadata isolated and avoids
    // cross-point pollution in combo_dedup / triage_batches as well.
    let db = Database::connect("sqlite::memory:")
        .await
        .map_err(|e| format!("Failed to open in-memory SQLite: {}", e))?;
    let pool = db.pool.clone();

    // Iterator config from the captured envelope.
    let iter_cfg = build_iterator_from_request_json(scenario_json)?;

    // Conservative upper-bound estimate. Triage uses this only for progress
    // reporting; we don't have the unpacked payload fields here, and it's not
    // worth the parsing duplication. The harness already prints its own grid
    // progress.
    let estimated_total_combos: u64 = u64::MAX;

    let constants = TriageConstants {
        target_batch_input_bytes: bsize,
        triage_iterations: iters,
        triage_cutoff_multiplier: cutoff,
        ..TriageConstants::default()
    };

    let log_buffer = Arc::new(LogBuffer::new());
    let on_progress = Box::new(|_pct: u8, _detail: String| {
        // Calibration runs are short; the per-grid println from the caller is enough.
    });

    let inputs = TriageRunInputs {
        pool: &pool,
        job_id: &job_id,
        simc_bin,
        fight_style,
        target_error,
        base_profile,
        log_buffer: log_buffer.clone(),
        on_progress,
    };

    let start = Instant::now();
    let result = run_triage_with_constants(iter_cfg, inputs, estimated_total_combos, constants, None)
        .await
        .map_err(|e| format!("Triage run failed: {}", e))?;
    let elapsed = start.elapsed().as_secs_f64();

    // Pull survivor combo_names for winner-loss matching.
    let metadata_repo = ComboMetadataRepo::new(pool.clone());
    let rows = metadata_repo
        .list_for_job(&job_id, None)
        .await
        .map_err(|e| format!("Failed to read survivors: {}", e))?;
    let survivor_names: std::collections::HashSet<&str> =
        rows.iter().map(|r| r.combo_name.as_str()).collect();

    let winner_loss_count = baseline_top.map(|baseline| {
        baseline
            .iter()
            .filter(|name| !survivor_names.contains(name.as_str()))
            .count()
    });

    Ok(GridPoint {
        batch_size_target_bytes: bsize,
        triage_iterations: iters,
        triage_cutoff_multiplier: cutoff,
        end_to_end_seconds: elapsed,
        triage_survivors: result.survivor_combo_ids.len(),
        total_batches: result.total_batches,
        total_candidates: result.total_candidates,
        total_accepted: result.total_accepted,
        winner_loss_count,
        notes: String::new(),
    })
}
