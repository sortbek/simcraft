//! Calibration harness for the Triage stage.
//!
//! Reads a captured Top Gear scenario JSON, runs Triage across a 3-axis grid
//! (batch_size, iterations, cutoff_multiplier), measures per-grid-point wall
//! time and winner-loss rate vs a reference baseline, writes the results to
//! a companion JSON file.
//!
//! Usage:
//!   simhammer-calibration <scenario.json> [--baseline <baseline.json>]
//!
//! See `calibration/README.md` for the full process.

use clap::Parser;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Instant;

#[derive(Parser, Debug)]
#[command(name = "simhammer-calibration")]
struct Args {
    /// Path to a captured Top Gear scenario JSON (the request body from /api/top-gear/sim).
    scenario: PathBuf,

    /// Optional baseline JSON with the reference top-10 ranked profilesets for winner-loss measurement.
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
    /// Number of baseline top-10 combos NOT in this grid point's survivors. 0 = perfect.
    /// None if no baseline was provided.
    winner_loss_count: Option<usize>,
    notes: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();

    let scenario_text = std::fs::read_to_string(&args.scenario)?;
    let _scenario: serde_json::Value = serde_json::from_str(&scenario_text)?;
    println!("Loaded scenario: {}", args.scenario.display());

    let baseline_top10: Option<Vec<String>> = if let Some(p) = &args.baseline {
        let text = std::fs::read_to_string(p)?;
        let baseline: serde_json::Value = serde_json::from_str(&text)?;
        baseline
            .get("top_10")
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

    for &bsize in &batch_sizes {
        for &iters in &iterations {
            for &cutoff in &cutoff_mults {
                println!(
                    "[grid] batch_bytes={}, iters={}, cutoff={}",
                    bsize, iters, cutoff
                );

                let start = Instant::now();

                // TODO: To complete the grid run:
                //   1. Open an in-memory SQLite DB and run migrations.
                //   2. Build a ProfilesetIteratorConfig from the scenario JSON. The
                //      handler at top_gear_handlers.rs:start_streaming_top_gear_job
                //      already does this construction; extract the relevant code into
                //      a pub(crate) helper that both the handler and this harness use.
                //   3. Construct TriageConstants from (bsize, iters, cutoff) with other
                //      fields from Default:
                //        let constants = TriageConstants {
                //            target_batch_input_bytes: bsize,
                //            triage_iterations: iters,
                //            triage_cutoff_multiplier: cutoff,
                //            ..TriageConstants::default()
                //        };
                //   4. Call run_triage_with_constants(iter_cfg, inputs, estimated_combos, constants).await.
                //   5. Read survivors from combo_metadata, compute winner_loss_count vs
                //      baseline_top10.
                //
                // For now this scaffold records placeholder values so the harness
                // structure exists and is callable. Wire the runtime in a follow-up
                // when ready to actually calibrate.

                let elapsed = start.elapsed().as_secs_f64();

                results.push(GridPoint {
                    batch_size_target_bytes: bsize,
                    triage_iterations: iters,
                    triage_cutoff_multiplier: cutoff,
                    end_to_end_seconds: elapsed,
                    triage_survivors: 0,
                    total_batches: 0,
                    total_candidates: 0,
                    total_accepted: 0,
                    winner_loss_count: baseline_top10.as_ref().map(|_| 0),
                    notes: "SCAFFOLD: wire run_triage_with_constants to make this real".to_string(),
                });
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
