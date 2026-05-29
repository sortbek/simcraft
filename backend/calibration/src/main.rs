//! Calibration harness for the Triage stage.
//!
//! Reads a captured Top Gear scenario JSON (a `NormalizedRequest` envelope —
//! exactly the shape stored in `jobs.request_json`), runs Triage across a
//! 3-axis grid (profilesets_per_batch, iterations, cutoff_multiplier), measures
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
    triage::{run_triage_with_constants, TriageConstants, TriageRunInputs, TriageRunOutcome},
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

    /// Comma-separated Triage batch sizes, in profilesets per SimC invocation.
    /// Each value pins min/max count for a direct overhead comparison.
    #[arg(long, value_delimiter = ',', default_value = "100,250,500,1000")]
    batch_profilesets: Vec<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GridPoint {
    batch_profilesets: usize,
    triage_iterations: u32,
    triage_cutoff_multiplier: f64,
    end_to_end_seconds: f64,
    average_batch_seconds: f64,
    profilesets_per_second: f64,
    seconds_per_1000_profilesets: f64,
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
    let options = payload.get("options").ok_or("payload missing `options`")?;
    let fight_style = options
        .get("fight_style")
        .and_then(|v| v.as_str())
        .unwrap_or("Patchwerk")
        .to_string();
    let estimated_total_combos = payload
        .get("estimate")
        .and_then(|v| v.as_u64())
        .ok_or(
            "payload missing `estimate` - capture a streamed Top Gear request so survivor budgeting matches production",
        )?;

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
    let batch_sizes = args.batch_profilesets;
    if batch_sizes.is_empty() || batch_sizes.contains(&0) {
        return Err("--batch-profilesets values must be positive".into());
    }
    let iterations: Vec<u32> = vec![25, 50, 100];
    let cutoff_mults: Vec<f64> = vec![2.0, 3.0, 4.0];

    let total_points = batch_sizes.len() * iterations.len() * cutoff_mults.len();
    println!(
        "Running {} grid points ({} profileset batch sizes x {} iterations x {} cutoff_mults)",
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
                    "[grid {:>2}/{}] batch_profilesets={}, iters={}, cutoff={}",
                    grid_idx, total_points, bsize, iters, cutoff
                );

                let outcome = run_one_grid_point(
                    &scenario_text,
                    &base_profile,
                    options,
                    &fight_style,
                    &args.simc_bin,
                    grid_idx,
                    bsize,
                    iters,
                    cutoff,
                    estimated_total_combos,
                    baseline_top.as_deref(),
                )
                .await;

                match outcome {
                    Ok(point) => results.push(point),
                    Err(e) => {
                        eprintln!("[grid {}] FAILED: {}", grid_idx, e);
                        results.push(GridPoint {
                            batch_profilesets: bsize,
                            triage_iterations: iters,
                            triage_cutoff_multiplier: cutoff,
                            end_to_end_seconds: 0.0,
                            average_batch_seconds: 0.0,
                            profilesets_per_second: 0.0,
                            seconds_per_1000_profilesets: 0.0,
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
#[allow(clippy::too_many_arguments)]
async fn run_one_grid_point(
    scenario_json: &str,
    base_profile: &str,
    options: &serde_json::Value,
    fight_style: &str,
    simc_bin: &std::path::Path,
    grid_idx: usize,
    batch_profilesets: usize,
    iters: u32,
    cutoff: f64,
    estimated_total_combos: u64,
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

    let constants = TriageConstants {
        min_batch_profilesets: batch_profilesets,
        max_batch_profilesets: batch_profilesets,
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
        options,
        base_profile,
        log_buffer: log_buffer.clone(),
        on_progress,
    };

    let start = Instant::now();
    let outcome =
        run_triage_with_constants(iter_cfg, inputs, estimated_total_combos, constants, None)
            .await
            .map_err(|e| format!("Triage run failed: {}", e))?;
    let result = match outcome {
        TriageRunOutcome::Completed(result) => result,
        TriageRunOutcome::Paused => {
            return Err("Triage paused unexpectedly during calibration".to_string())
        }
    };
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
    let average_batch_seconds = if result.total_batches > 0 {
        elapsed / result.total_batches as f64
    } else {
        0.0
    };
    let profilesets_per_second = if elapsed > 0.0 {
        result.total_accepted as f64 / elapsed
    } else {
        0.0
    };
    let seconds_per_1000_profilesets = if result.total_accepted > 0 {
        elapsed * 1000.0 / result.total_accepted as f64
    } else {
        0.0
    };

    Ok(GridPoint {
        batch_profilesets,
        triage_iterations: iters,
        triage_cutoff_multiplier: cutoff,
        end_to_end_seconds: elapsed,
        average_batch_seconds,
        profilesets_per_second,
        seconds_per_1000_profilesets,
        triage_survivors: result.survivor_combo_ids.len(),
        total_batches: result.total_batches,
        total_candidates: result.total_candidates,
        total_accepted: result.total_accepted,
        winner_loss_count,
        notes: String::new(),
    })
}
