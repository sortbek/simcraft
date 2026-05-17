use crate::types::RotationMode;
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use tempfile::TempDir;

/// Output from a simc subprocess, including all generated report files.
pub struct SimcOutput {
    pub json: Value,
    pub html_report: Option<String>,
    pub text_output: Option<String>,
}

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

// ---- Process Registry (for cancellation) ----

use once_cell::sync::Lazy;

/// Maps job_id -> child process PID. Used to kill running sims.
static RUNNING_PROCESSES: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn register_process(job_id: &str, pid: u32) {
    RUNNING_PROCESSES
        .lock()
        .unwrap()
        .insert(job_id.to_string(), pid);
}

fn unregister_process(job_id: &str) {
    RUNNING_PROCESSES.lock().unwrap().remove(job_id);
}

/// Kill the simc process for a job. Returns true if a process was found and killed.
pub fn kill_job(job_id: &str) -> bool {
    let pid = RUNNING_PROCESSES.lock().unwrap().remove(job_id);
    if let Some(pid) = pid {
        #[cfg(unix)]
        {
            let _ = std::process::Command::new("kill")
                .args(["-9", &pid.to_string()])
                .output();
        }
        #[cfg(windows)]
        {
            // Use taskkill /T to kill the process tree (simc may spawn child threads)
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output();
        }
        println!("Killed simc process {} for job {}", pid, job_id);
        true
    } else {
        false
    }
}

#[cfg(windows)]
extern "system" {
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
    fn SetProcessAffinityMask(h: *mut std::ffi::c_void, mask: usize) -> i32;
    fn CloseHandle(h: *mut std::ffi::c_void) -> i32;
}

#[cfg(windows)]
fn set_process_affinity(pid: u32, threads: u32) {
    const PROCESS_SET_INFORMATION: u32 = 0x0200;
    const PROCESS_QUERY_INFORMATION: u32 = 0x0400;

    unsafe {
        let h = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION, 0, pid);
        if h.is_null() {
            return;
        }
        let mask: usize = if threads as usize >= usize::BITS as usize {
            usize::MAX
        } else {
            (1usize << threads as usize) - 1
        };
        SetProcessAffinityMask(h, mask);
        CloseHandle(h);
    }
}

const SIMC_TIMEOUT_SECS: u64 = 600;

fn max_threads() -> u32 {
    std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4)
}

/// Resolve the thread count from the API options.
/// A value of 0 (or absent) means use all available threads.
fn resolve_threads(options: &Value) -> u32 {
    let requested = options.get("threads").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    if requested == 0 {
        max_threads()
    } else {
        requested.min(max_threads()).max(1)
    }
}

const OVERRIDES: &[&str] = &[
    "override.bloodlust=1",
    "override.arcane_intellect=1",
    "override.power_word_fortitude=1",
    "override.battle_shout=1",
    "override.mystic_touch=1",
    "override.chaos_brand=1",
    "override.skyfury=1",
    "override.mark_of_the_wild=1",
    "override.hunters_mark=1",
    "override.bleeding=1",
];

const EXPANSION_OPTIONS: &[&str] = &[
    "midnight.crucible_of_erratic_energies_violence=1",
    "midnight.crucible_of_erratic_energies_sustenance=1",
    "midnight.crucible_of_erratic_energies_predation=1",
];

struct Stage {
    name: &'static str,
    target_error: f64,
}

/// Coarse-to-fine candidate target_errors used to construct the adaptive schedule.
/// Each entry produces an intermediate stage when its target_error is strictly
/// looser than the user's requested precision. Names are paired by position so
/// log output stays consistent across runs at different user precisions.
const STAGE_CANDIDATES: &[(f64, &str)] = &[
    (2.0,  "Probe"),
    (1.0,  "Coarse"),
    (0.5,  "Refine"),
    (0.2,  "Medium"),
    (0.1,  "Fine"),
    (0.05, "Trace"),
    (0.02, "Ultra"),
];

/// Build the staged schedule for the user's requested `target_error`.
///
/// Keeps every candidate stage looser than `user_target_error`, then appends a
/// "Final" stage at the user's exact precision. Stages pass profilesets through
/// progressively tighter SimC passes; intermediate stages prune via
/// `STAGE_CUTOFF_MULTIPLIER * target_error` of the top (and baseline) mean.
///
/// Examples:
///   0.2  -> Probe, Coarse, Refine, Final(0.2)         (4 stages)
///   0.05 -> Probe, Coarse, Refine, Medium, Fine, Final(0.05)   (6 stages)
///   0.01 -> ..., Trace, Ultra, Final(0.01)            (8 stages)
fn build_stage_schedule(user_target_error: f64) -> Vec<Stage> {
    let mut schedule: Vec<Stage> = STAGE_CANDIDATES
        .iter()
        .filter(|(te, _)| *te > user_target_error)
        .map(|(te, name)| Stage {
            name,
            target_error: *te,
        })
        .collect();
    schedule.push(Stage {
        name: "Final",
        target_error: user_target_error,
    });
    schedule
}

/// Below this combo count, skip staging and run a single direct sim. The 6-stage
/// schedule needs enough combos for pruning to amortize the per-stage subprocess
/// startup cost — for small jobs a single full-precision pass is faster.
const STAGED_THRESHOLD: usize = 20;

/// Min survivors retained at any pruning step. Acts as a floor inside
/// `select_kept_profilesets` so a tight distribution still advances ≥ this many.
const STAGE_MIN_KEEP: usize = 5;

/// If survivors after pruning fall to or below this number, jump straight to the
/// final precision stage instead of walking the remaining intermediate stages.
const SKIP_TO_FINAL_THRESHOLD: usize = 5;

/// Iteration count cap for stage `idx` of `total` stages. simc treats
/// `iterations=N` as a hard ceiling; setting it loosely lets simc overshoot
/// a stage's `target_error` toward final-pass precision (e.g. a Probe stage
/// at 2.0% target_error empirically hitting ~0.5% because simc kept running).
///
/// We cap pruning stages at roughly what simc needs to reach the stage's
/// target_error band, so simc stops near the intended precision. Final
/// stage always runs at the user-requested iteration count.
fn iterations_for_stage(
    stage_idx: usize,
    total_stages: usize,
    user_iters: u32,
    target_error_pct: f64,
) -> u32 {
    if stage_idx + 1 >= total_stages {
        return user_iters;
    }
    // Hard caps by target_error band. simc's per-profileset auto-tuner picks
    // an iteration count based on observed variance; these caps keep that
    // count from drifting much past the stage's stated precision target.
    let cap: u32 = if target_error_pct >= 2.0 {
        50 // Probe
    } else if target_error_pct >= 1.0 {
        125 // Coarse
    } else if target_error_pct >= 0.5 {
        500 // Refine
    } else if target_error_pct >= 0.2 {
        3_000 // Medium
    } else if target_error_pct >= 0.1 {
        12_000 // Fine
    } else if target_error_pct >= 0.05 {
        50_000 // Trace
    } else {
        user_iters
    };
    std::cmp::min(cap, user_iters)
}

/// Progress-bar range `(start_pct, end_pct)` allocated to stage `idx` of `total`.
/// `base_start` is the lower bound of the allocated range (10 for inline jobs,
/// 50 for streamed jobs that ran Triage first), and the upper bound is always 95.
/// Skipped stages produce a visible jump forward when fast-forwarding to final.
fn progress_range_for_stage(stage_idx: usize, total_stages: usize, base_start: u8) -> (u8, u8) {
    let span = 95u8 - base_start;
    let per_stage = span as f64 / total_stages as f64;
    let start = base_start + (stage_idx as f64 * per_stage) as u8;
    let end = base_start + ((stage_idx + 1) as f64 * per_stage) as u8;
    (start, end)
}

/// Multiplier on a stage's target_error used to set the keep threshold.
///
/// At a stage's target_error `te` (95% CI half-width as a percent), two profileset
/// means could in the worst case overlap by `2 * te`. Anything below that gap from
/// the top mean provably cannot be the true best — safe to prune. We keep `min_keep`
/// as a floor so a flat distribution (all combos statistically tied) still progresses.
const STAGE_CUTOFF_MULTIPLIER: f64 = 2.0;

/// Decide which profilesets survive a stage cut.
///
/// Drops any profileset whose mean falls more than `STAGE_CUTOFF_MULTIPLIER * target_error`
/// percent below **both**:
/// - the top mean (can no longer be the best at this precision), and
/// - `baseline_mean`, if provided (can no longer be an upgrade at this precision).
///
/// The baseline cutoff matters most when the user already has good gear and most
/// alternatives aren't actually upgrades — those get pruned at Probe instead of
/// trickling through every stage just because they cluster near the (small) top.
///
/// `min_keep` is a floor: if fewer than `min_keep` clear both thresholds we top
/// up from the sorted list, so a flat distribution still progresses.
fn select_kept_profilesets(
    profilesets: &[Value],
    target_error: f64,
    min_keep: usize,
    baseline_mean: Option<f64>,
) -> std::collections::HashSet<String> {
    if profilesets.is_empty() {
        return std::collections::HashSet::new();
    }

    let mut sorted: Vec<&Value> = profilesets.iter().collect();
    sorted.sort_by(|a, b| {
        let a_mean = a.get("mean").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let b_mean = b.get("mean").and_then(|v| v.as_f64()).unwrap_or(0.0);
        b_mean
            .partial_cmp(&a_mean)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let top_mean = sorted[0].get("mean").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let cutoff_factor = 1.0 - STAGE_CUTOFF_MULTIPLIER * target_error / 100.0;
    let top_threshold = top_mean * cutoff_factor;
    let baseline_threshold = baseline_mean.map(|m| m * cutoff_factor).unwrap_or(f64::MIN);
    let threshold = top_threshold.max(baseline_threshold);

    let mut kept: Vec<&&Value> = sorted
        .iter()
        .filter(|ps| ps.get("mean").and_then(|v| v.as_f64()).unwrap_or(0.0) >= threshold)
        .collect();

    if kept.len() < min_keep {
        let take_n = std::cmp::min(min_keep, sorted.len());
        kept = sorted.iter().take(take_n).collect();
    }

    kept.into_iter()
        .filter_map(|ps| {
            ps.get("name")
                .and_then(|n| n.as_str())
                .map(|s| s.to_string())
        })
        .collect()
}

/// Best "current DPS" we can compare against when deciding if a combo is still
/// plausibly an upgrade. Reads the base actor mean from `sim.players[0]`, and
/// folds in any profilesets named like "Currently Equipped*" (multi-talent jobs
/// emit one per non-first talent) — taking the max so we don't prune a combo
/// that beats one baseline but not another.
fn baseline_mean_for_pruning(raw: &Value, profilesets: &[Value]) -> Option<f64> {
    let base = raw
        .get("sim")
        .and_then(|s| s.get("players"))
        .and_then(|p| p.as_array())
        .and_then(|arr| arr.first())
        .and_then(|p| p.get("collected_data"))
        .and_then(|c| c.get("dps"))
        .and_then(|d| d.get("mean"))
        .and_then(|m| m.as_f64());

    let from_profilesets = profilesets
        .iter()
        .filter(|ps| {
            ps.get("name")
                .and_then(|n| n.as_str())
                .is_some_and(|n| n.starts_with("Currently Equipped"))
        })
        .filter_map(|ps| ps.get("mean").and_then(|v| v.as_f64()))
        .fold(f64::NEG_INFINITY, f64::max);

    match (base, from_profilesets.is_finite()) {
        (Some(b), true) => Some(b.max(from_profilesets)),
        (Some(b), false) => Some(b),
        (None, true) => Some(from_profilesets),
        (None, false) => None,
    }
}

/// Build the full simc input from the options Value (convenience wrapper).
pub fn build_simc_input_from_options(simc_input: &str, options: &Value) -> String {
    let fight_style = options
        .get("fight_style")
        .and_then(|v| v.as_str())
        .unwrap_or("Patchwerk");
    let target_error = options
        .get("target_error")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.1);
    let iterations = options
        .get("iterations")
        .and_then(|v| v.as_u64())
        .unwrap_or(10000) as u32;
    let desired_targets = options
        .get("desired_targets")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as u32;
    let max_time = options
        .get("max_time")
        .and_then(|v| v.as_u64())
        .unwrap_or(300) as u32;
    let calculate_scale_factors =
        options.get("sim_type").and_then(|v| v.as_str()) == Some("stat_weights");
    let single_actor_batch = options
        .get("single_actor_batch")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let is_dungeon_route = simc_input.lines().any(|l| {
        let t = l.trim();
        t == "fight_style=DungeonRoute" || t == "fight_style=\"DungeonRoute\""
    });

    build_full_simc_input(
        simc_input,
        options,
        fight_style,
        target_error,
        iterations,
        desired_targets,
        max_time,
        calculate_scale_factors,
        single_actor_batch,
        is_dungeon_route,
    )
}

/// Build the full simc input file with all options inline (matching Raidbots format).
/// Injects consumables, expansion options after the base actor, and appends a
/// `# Simulation Options` section at the end with overrides, sim config, etc.
#[allow(clippy::too_many_arguments)]
pub fn build_full_simc_input(
    simc_input: &str,
    options: &Value,
    fight_style: &str,
    target_error: f64,
    iterations: u32,
    desired_targets: u32,
    max_time: u32,
    calculate_scale_factors: bool,
    single_actor_batch: bool,
    is_dungeon_route: bool,
) -> String {
    let consumables = options.get("consumables").and_then(|v| v.as_object());
    let expansion_opts = options.get("expansion_options").and_then(|v| v.as_object());
    let raid_buffs = options.get("raid_buffs").and_then(|v| v.as_object());
    let rotation_mode: RotationMode = options
        .get("rotation_mode")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // Extract character name for the name= line
    let char_name: Option<String> = simc_input.lines().find_map(|l| {
        let trimmed = l.trim();
        if let Some(idx) = trimmed.find("=\"") {
            let after = &trimmed[idx + 2..];
            after.strip_suffix('"').map(|s| s.to_string())
        } else {
            None
        }
    });

    // --- Base actor options (consumables + expansion) injected before combos ---
    let mut base_actor_lines: Vec<String> = Vec::new();

    // Actor name (matches Raidbots format)
    if let Some(name) = &char_name {
        base_actor_lines.push(format!("name={}", name));
    }

    // Consumables
    base_actor_lines.push("\n# Consumables".to_string());
    if let Some(cons) = consumables {
        for (key, val) in cons {
            if let Some(v) = val.as_str() {
                if v.is_empty() {
                    continue;
                }
                if key == "weapon_rune" {
                    base_actor_lines.push(format!("temporary_enchant=main_hand:{}", v));
                } else {
                    base_actor_lines.push(format!("{}={}", key, v));
                }
            }
        }
    }

    // Expansion options
    base_actor_lines.push("\n# Expansion Options".to_string());
    // Weapon rune: if not set via consumables, clear it
    let has_weapon_rune = consumables
        .map(|c| c.contains_key("weapon_rune"))
        .unwrap_or(false);
    if !has_weapon_rune {
        base_actor_lines.push("temporary_enchant=".to_string());
    }
    for default_opt in EXPANSION_OPTIONS {
        let parts: Vec<&str> = default_opt.splitn(2, '=').collect();
        let key = parts[0];
        let enabled = expansion_opts
            .and_then(|e| e.get(key))
            .and_then(|v| v.as_u64())
            .map(|v| v != 0)
            .unwrap_or(true);
        base_actor_lines.push(format!("{}={}", key, if enabled { "1" } else { "0" }));
    }

    // Rotation Mode (Assisted Combat / One Button)
    match rotation_mode {
        RotationMode::AssistedCombat => {
            base_actor_lines.push("\n# Rotation".to_string());
            base_actor_lines.push("use_blizzard_action_list=1".to_string());
        }
        RotationMode::OneButton => {
            base_actor_lines.push("\n# Rotation".to_string());
            base_actor_lines.push("use_blizzard_action_list=1".to_string());
            base_actor_lines.push("one_button_mode=1".to_string());
        }
        RotationMode::Default => {}
    }

    // Find insertion point for base actor options
    let input_lines: Vec<&str> = simc_input.lines().collect();
    let mut insert_idx = input_lines.len();
    for (i, line) in input_lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed == "### Combo 2"
            || trimmed == "# Actors"
            || trimmed.starts_with("profileset.")
            || trimmed.starts_with("copy=")
        {
            insert_idx = i;
            break;
        }
    }

    let mut result = input_lines[..insert_idx].join("\n");
    result.push('\n');
    result.push_str(&base_actor_lines.join("\n"));
    result.push('\n');
    if insert_idx < input_lines.len() {
        result.push_str("\n# Actors\n");
        result.push_str(&input_lines[insert_idx..].join("\n"));
    } else {
        // Quick sim (no combos) — still add # Actors marker for consistency
        result.push_str("\n# Actors\n");
    }

    // --- Simulation Options section at the end ---
    result.push_str("\n\n# Simulation Options\n");
    result.push_str(&format!("iterations={}\n", iterations));
    result.push_str(&format!("desired_targets={}\n", desired_targets));
    if !is_dungeon_route {
        result.push_str(&format!("max_time={}\n", max_time));
    }
    result.push_str(&format!(
        "calculate_scale_factors={}\n",
        if calculate_scale_factors { "1" } else { "0" }
    ));

    // Scale factors
    result.push_str("scale_only=strength,intellect,agility,crit,mastery,vers,haste,weapon_dps,weapon_offhand_dps\n");

    // Raid buff overrides (skip for dungeon routes)
    if !is_dungeon_route {
        for opt in OVERRIDES {
            let key = opt
                .strip_prefix("override.")
                .and_then(|s| s.split('=').next())
                .unwrap_or("");
            let enabled = raid_buffs
                .and_then(|b| b.get(key))
                .and_then(|v| v.as_u64())
                .map(|v| v != 0)
                .unwrap_or(true);
            result.push_str(&format!(
                "override.{}={}\n",
                key,
                if enabled { "1" } else { "0" }
            ));
        }
    }

    // Sim options
    result.push_str("report_details=1\n");
    if single_actor_batch {
        result.push_str("single_actor_batch=1\n");
    }
    result.push_str("optimize_expressions=1\n");
    if !is_dungeon_route {
        result.push_str(&format!("fight_style={}\n", fight_style));
    }
    result.push_str(&format!("target_error={}\n", target_error));

    // Run profilesets in parallel (each on one thread) instead of the default
    // sequential mode where each profileset uses all iteration threads. Whether
    // this wins depends on iteration count per profileset, which target_error
    // controls. Measured on a 19-thread box:
    //   te=1.0  (≈150 iters/profileset)   → pwt=1 is 2.5× faster (sync overhead dominates)
    //   te=0.2  (≈1.5k iters/profileset)  → roughly equal (within noise)
    //   te=0.05 (≈14k iters/profileset)   → pwt=1 is 12% slower (iter parallelism wins)
    // Cutoff at te > 0.2 enables pwt=1 only for the early staged Top Gear stages
    // (Probe/Coarse/Refine) where the win is clear. Medium (te=0.2) and below are
    // marginal or slower, so we leave SimC's default sequential mode in place.
    // The `parallel_profilesets` option overrides this for A/B testing.
    let combo_count = simc_input
        .lines()
        .filter(|l| l.trim_start().starts_with("### Combo "))
        .count();
    let enable_parallel = match options.get("parallel_profilesets").and_then(|v| v.as_bool()) {
        Some(b) => b,
        None => combo_count >= 4 && target_error > 0.2,
    };
    if enable_parallel {
        result.push_str("profileset_work_threads=1\n");
    }

    result
}

/// Run simc as a subprocess, streaming stderr for real-time profileset progress.
/// `on_profileset_progress(current, total)` is called whenever simc reports
/// completing a profileset (e.g. "3/7").
/// `on_log(line)` is called for every line of output from either stdout or stderr.
#[allow(clippy::too_many_arguments)]
async fn run_simc_subprocess(
    simc_path: &Path,
    raw: bool,
    job_id: &str,
    simc_input: &str,
    options: &Value,
    fight_style: &str,
    target_error: f64,
    iterations: u32,
    threads: u32,
    desired_targets: u32,
    max_time: u32,
    calculate_scale_factors: bool,
    single_actor_batch: bool,
    stage_name: &str,
    generate_html: bool,
    on_profileset_progress: impl Fn(usize, usize),
    on_log: impl Fn(&str),
) -> Result<SimcOutput, String> {
    let suffix = if stage_name.is_empty() {
        String::new()
    } else {
        format!("_{}", stage_name)
    };

    let tmp_dir = TempDir::with_prefix(format!("simc_{}{}_", job_id, suffix))
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;

    let input_file = tmp_dir.path().join("input.simc");
    let output_file = tmp_dir.path().join("output.json");
    let html_file = tmp_dir.path().join("report.html");

    if !simc_path.exists() {
        return Err(format!("simc binary not found at: {}", simc_path.display()));
    }

    // On Windows, remove the Zone.Identifier ADS that marks files as "downloaded
    // from the internet". Without this, Windows may block programmatic execution
    // with "Access is denied" even though the file runs fine from a terminal.
    #[cfg(windows)]
    {
        let zone_id = format!("{}:Zone.Identifier", simc_path.display());
        let _ = std::fs::remove_file(&zone_id);
    }

    let is_dungeon_route = simc_input.lines().any(|l| {
        let trimmed = l.trim();
        trimmed == "fight_style=DungeonRoute" || trimmed == "fight_style=\"DungeonRoute\""
    });

    // Build the full input file with all options inline
    let final_input = if raw {
        simc_input.to_string()
    } else {
        build_full_simc_input(
            simc_input,
            options,
            fight_style,
            target_error,
            iterations,
            desired_targets,
            max_time,
            calculate_scale_factors,
            single_actor_batch,
            is_dungeon_route,
        )
    };
    std::fs::write(&input_file, &final_input)
        .map_err(|e| format!("Failed to write input file: {}", e))?;

    let mut cmd = Command::new(simc_path);
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS
        cmd.creation_flags(0x08000000 | 0x00004000);
    }

    // Only pass output format and threads as CLI args — everything else is in the input file
    cmd.arg(input_file.to_str().unwrap_or(""))
        .arg(format!("json2={}", output_file.display()))
        .arg(format!("threads={}", threads));
    if generate_html {
        cmd.arg(format!("html={}", html_file.display()));
    }

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    println!(
        "Running simc: {} (threads={}, desired_targets={}, max_time={}, affinity limited)",
        simc_path.display(),
        threads,
        desired_targets,
        max_time
    );

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to run simc at '{}': {}", simc_path.display(), e))?;

    // Register for cancellation + limit CPU affinity
    if let Some(pid) = child.id() {
        register_process(job_id, pid);
        #[cfg(windows)]
        set_process_affinity(pid, threads);
    }

    // Multiplex stdout + stderr through a single channel for unified log streaming.
    // Each line is tagged (is_stderr, text).
    let (tx, mut rx) = tokio::sync::mpsc::channel::<(bool, String)>(256);

    let stderr = child.stderr.take();
    let tx_err = tx.clone();
    tokio::spawn(async move {
        if let Some(stream) = stderr {
            let mut reader = BufReader::new(stream);
            let mut line_buf = String::new();
            loop {
                line_buf.clear();
                match AsyncBufReadExt::read_line(&mut reader, &mut line_buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        // simc uses \r to overwrite progress lines in-place.
                        // read_line reads until \n, so a single "line" may contain
                        // multiple \r-separated updates. Take the last segment.
                        let resolved = line_buf
                            .trim_end()
                            .rsplit('\r')
                            .next()
                            .unwrap_or("")
                            .to_string();
                        if !resolved.is_empty() {
                            let _ = tx_err.send((true, resolved)).await;
                        }
                    }
                }
            }
        }
    });

    let stdout = child.stdout.take();
    let tx_out = tx.clone();
    tokio::spawn(async move {
        if let Some(stream) = stdout {
            let mut reader = BufReader::new(stream);
            let mut line_buf = String::new();
            loop {
                line_buf.clear();
                match AsyncBufReadExt::read_line(&mut reader, &mut line_buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let resolved = line_buf
                            .trim_end()
                            .rsplit('\r')
                            .next()
                            .unwrap_or("")
                            .to_string();
                        if !resolved.is_empty() {
                            let _ = tx_out.send((false, resolved)).await;
                        }
                    }
                }
            }
        }
    });

    // Drop our copy so rx completes when both reader tasks finish.
    drop(tx);

    let progress_re = Regex::new(r"(\d+)/(\d+)").unwrap();
    let mut stderr_collected: Vec<String> = Vec::new();
    let mut stdout_collected: Vec<String> = Vec::new();

    loop {
        match tokio::time::timeout(std::time::Duration::from_secs(SIMC_TIMEOUT_SECS), rx.recv())
            .await
        {
            Ok(Some((is_stderr, line))) => {
                on_log(&line);
                if is_stderr {
                    if let Some(caps) = progress_re.captures(&line) {
                        if let (Ok(current), Ok(total)) =
                            (caps[1].parse::<usize>(), caps[2].parse::<usize>())
                        {
                            if total > 1 && current <= total {
                                on_profileset_progress(current, total);
                            }
                        }
                    }
                    stderr_collected.push(line);
                } else {
                    stdout_collected.push(line);
                }
            }
            Ok(None) => break, // both senders dropped — streams closed
            Err(_) => {
                // Timeout — no output for SIMC_TIMEOUT_SECS, kill the child
                unregister_process(job_id);
                let _ = child.kill().await;
                return Err(format!("simc timed out after {}s", SIMC_TIMEOUT_SECS));
            }
        }
    }

    // Wait for the process to exit.
    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for simc: {}", e))?;

    unregister_process(job_id);

    if !status.success() {
        let stderr_text = stderr_collected.join("\n");
        let stdout_text = stdout_collected.join("\n");
        let error_msg = if !stderr_text.trim().is_empty() {
            stderr_text
        } else if !stdout_text.trim().is_empty() {
            stdout_text
        } else {
            "simc exited with non-zero code".to_string()
        };
        return Err(format!(
            "simc failed (exit {:?}): {}",
            status.code(),
            error_msg
        ));
    }

    if !output_file.exists() {
        return Err("simc did not produce output JSON".to_string());
    }

    let json_text = std::fs::read_to_string(&output_file)
        .map_err(|e| format!("Failed to read output JSON: {}", e))?;

    let json: Value = serde_json::from_str(&json_text)
        .map_err(|e| format!("Failed to parse output JSON: {}", e))?;

    let html_report = if generate_html && html_file.exists() {
        std::fs::read_to_string(&html_file).ok()
    } else {
        None
    };

    let text_output = if !stdout_collected.is_empty() {
        Some(stdout_collected.join("\n"))
    } else {
        None
    };

    Ok(SimcOutput {
        json,
        html_report,
        text_output,
    })
}

fn get_profileset_results(raw: &Value) -> &[Value] {
    raw.get("sim")
        .and_then(|s| s.get("profilesets"))
        .and_then(|p| p.get("results"))
        .and_then(|r| r.as_array())
        .map(|v| v.as_slice())
        .unwrap_or(&[])
}

// Matches a profileset declaration like `profileset."Combo 42"+=...` and
// captures the combo name. Quotes are required: the streamed-mode iterator
// always emits the form `profileset."Combo N"+=...`, and the legacy top-gear
// path uses the same quoted form.
static PROFILESET_NAME_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"^\s*profileset\."(Combo \d+)""#).unwrap());
static COMBO_HEADER_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^###\s+(Combo \d+)").unwrap());

pub fn filter_simc_input(
    simc_input: &str,
    keep_combos: &std::collections::HashSet<String>,
) -> String {
    let mut output: Vec<&str> = Vec::new();

    for line in simc_input.split('\n') {
        if let Some(caps) = COMBO_HEADER_RE.captures(line) {
            if keep_combos.contains(&caps[1]) {
                output.push(line);
            }
            continue;
        }
        if let Some(caps) = PROFILESET_NAME_RE.captures(line) {
            if keep_combos.contains(&caps[1]) {
                output.push(line);
            }
            continue;
        }
        output.push(line);
    }

    output.join("\n")
}

/// Run simc and return parsed JSON output.
pub async fn run_simc(
    simc_path: &Path,
    job_id: &str,
    simc_input: &str,
    options: &Value,
    on_log: impl Fn(&str),
) -> Result<SimcOutput, String> {
    let fight_style = options
        .get("fight_style")
        .and_then(|v| v.as_str())
        .unwrap_or("Patchwerk");
    let target_error = options
        .get("target_error")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.2);
    let iterations = options
        .get("iterations")
        .and_then(|v| v.as_u64())
        .unwrap_or(1000) as u32;
    let calculate_scale_factors =
        options.get("sim_type").and_then(|v| v.as_str()) == Some("stat_weights");
    let threads = resolve_threads(options);
    let desired_targets = options
        .get("desired_targets")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as u32;
    let max_time = options
        .get("max_time")
        .and_then(|v| v.as_u64())
        .unwrap_or(300) as u32;

    let single_actor_batch = options
        .get("single_actor_batch")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let raw = options
        .get("raw")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    run_simc_subprocess(
        simc_path,
        raw,
        job_id,
        simc_input,
        options,
        fight_style,
        target_error,
        iterations,
        threads,
        desired_targets,
        max_time,
        calculate_scale_factors,
        single_actor_batch,
        "",
        true,      // generate HTML for quick sims
        |_, _| {}, // Quick sim has no profilesets to track
        on_log,
    )
    .await
}

/// Error type returned by `run_simc_staged`.
#[derive(Debug)]
pub enum StagedRunError {
    /// The user paused mid-run; status has already been set to Paused.
    Paused,
    /// Any other error.
    Other(String),
}

impl std::fmt::Display for StagedRunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Paused => f.write_str("paused_by_user"),
            Self::Other(s) => f.write_str(s),
        }
    }
}

impl From<String> for StagedRunError {
    fn from(s: String) -> Self {
        Self::Other(s)
    }
}

impl From<&str> for StagedRunError {
    fn from(s: &str) -> Self {
        Self::Other(s.to_string())
    }
}

/// Parse the combo_id integer out of a combo_name in the canonical "Combo N" format.
/// Returns None for any name that doesn't match.
fn parse_combo_id(name: &str) -> Option<i64> {
    name.strip_prefix("Combo ")
        .and_then(|s| s.trim().parse::<i64>().ok())
}

/// Run a multi-stage simulation for Top Gear.
///
/// `base_start` is the lower bound of the progress-bar range allocated to the
/// staged pipeline (10 for inline/eager jobs, 50 for streamed jobs that ran
/// Triage first and already consumed 5-50%).
///
/// `pool` is required for Streamed-mode jobs (checkpoint writes + pause polling).
/// Inline-mode jobs pass `None` and skip those paths entirely.
///
/// `start_stage_idx` controls which stage to begin at. Pass `0` for a fresh run.
/// Resume calls pass the `next_stage_idx` from the Staged checkpoint to skip
/// already-completed stages. The `simc_input` must already contain only the
/// survivor profilesets for the resumed stage.
#[allow(clippy::too_many_arguments)]
pub async fn run_simc_staged(
    simc_path: &Path,
    job_id: &str,
    simc_input: &str,
    options: &Value,
    combo_count: usize,
    base_start: u8,
    simc_input_mode: crate::models::SimcInputMode,
    pool: Option<sqlx::AnyPool>,
    start_stage_idx: usize,
    constants: crate::profileset_generator::triage::TriageConstants,
    on_progress: impl Fn(u8, &str, &str),
    on_stage_complete: impl Fn(&str),
    on_log: impl Fn(&str) + Clone,
) -> Result<SimcOutput, StagedRunError> {
    let fight_style = options
        .get("fight_style")
        .and_then(|v| v.as_str())
        .unwrap_or("Patchwerk");
    let user_iterations = options
        .get("iterations")
        .and_then(|v| v.as_u64())
        .unwrap_or(1000) as u32;
    let threads = resolve_threads(options);
    let desired_targets = options
        .get("desired_targets")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as u32;
    let max_time = options
        .get("max_time")
        .and_then(|v| v.as_u64())
        .unwrap_or(300) as u32;
    let single_actor_batch = options
        .get("single_actor_batch")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    if combo_count < STAGED_THRESHOLD {
        on_progress(5, "Simulating", &format!("{} combos", combo_count));
        let target_error = options
            .get("target_error")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.2);
        return run_simc_subprocess(
            simc_path,
            false, // not raw
            job_id,
            simc_input,
            options,
            fight_style,
            target_error,
            user_iterations,
            threads,
            desired_targets,
            max_time,
            false,
            single_actor_batch,
            "direct",
            false, // skip HTML for profileset sims
            |current, total| {
                // Map profileset progress to 5%–95%
                let pct = 5 + ((current as f64 / total as f64) * 90.0) as u8;
                on_progress(
                    pct,
                    "Simulating",
                    &format!("{}/{} profilesets", current, total),
                );
            },
            on_log,
        )
        .await
        .map_err(Into::into);
    }

    let mut current_input = simc_input.to_string();
    let mut remaining = combo_count;
    let mut result: Option<SimcOutput> = None;

    // Collect eliminated combos' results so they appear in the final output.
    // Key: combo name, Value: profileset result object from the stage where it was cut.
    let mut eliminated: HashMap<String, Value> = HashMap::new();

    let user_target_error = options
        .get("target_error")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.05);
    let stages = build_stage_schedule(user_target_error);
    let total_stages = stages.len();
    let final_idx = total_stages - 1;
    // Clamp start_stage_idx to a valid range. If it's past the last stage the
    // while loop body never executes and we fall through to the "no result"
    // error — the caller (resume_staged) guards against this case upstream.
    let mut stage_idx = start_stage_idx.min(total_stages);

    while stage_idx < total_stages {
        let stage = &stages[stage_idx];
        let is_final = stage_idx == final_idx;
        let (range_start, range_end) = progress_range_for_stage(stage_idx, total_stages, base_start);
        let stage_iters =
            iterations_for_stage(stage_idx, total_stages, user_iterations, stage.target_error);

        on_progress(
            range_start,
            &format!("Stage {} of {}", stage_idx + 1, total_stages),
            &format!("{} combos · {} precision", remaining, stage.name),
        );

        println!(
            "Job {}: Stage {} — {} combos, target_error={}, iterations={}",
            job_id, stage.name, remaining, stage.target_error, stage_iters
        );

        let stage_label = stage.name.to_lowercase();
        let stage_name_for_progress = stage.name;
        let stage_result = run_simc_subprocess(
            simc_path,
            false, // not raw
            job_id,
            &current_input,
            options,
            fight_style,
            stage.target_error,
            stage_iters,
            threads,
            desired_targets,
            max_time,
            false,
            single_actor_batch,
            &stage_label,
            false, // skip HTML for staged sims
            |current, total| {
                let pct = range_start
                    + ((current as f64 / total as f64) * (range_end - range_start) as f64) as u8;
                on_progress(
                    pct,
                    &format!("Stage {} of {}", stage_idx + 1, total_stages),
                    &format!(
                        "{}/{} profilesets · {} precision",
                        current, total, stage_name_for_progress
                    ),
                );
            },
            on_log.clone(),
        )
        .await?;

        result = Some(stage_result);

        if is_final {
            on_stage_complete(&format!("{} · {} combos · done", stage.name, remaining));
            break;
        }

        let stage_json = &result.as_ref().unwrap().json;
        let profilesets = get_profileset_results(stage_json);
        if profilesets.is_empty() {
            on_stage_complete(&format!("{} · no results", stage.name));
            break;
        }

        let baseline_mean = baseline_mean_for_pruning(stage_json, profilesets);
        let keep_combos = select_kept_profilesets(
            profilesets,
            stage.target_error,
            STAGE_MIN_KEEP,
            baseline_mean,
        );

        if keep_combos.len() >= profilesets.len() {
            on_stage_complete(&format!(
                "{} · kept all {} combos",
                stage.name,
                profilesets.len()
            ));

            if simc_input_mode == crate::models::SimcInputMode::Streamed {
                if let Some(ref p) = pool {
                    let next_idx = stage_idx + 1;
                    let next_name = stages
                        .get(next_idx)
                        .map(|s| s.name.to_string())
                        .unwrap_or_else(|| "Done".to_string());
                    // All profilesets survived — collect their combo_ids.
                    // combo_name format is "Combo N" where N is the combo_id,
                    // so parse the integer directly instead of DB round-trips.
                    let survivor_combo_ids: Vec<i64> =
                        keep_combos.iter().filter_map(|n| parse_combo_id(n)).collect();
                    let checkpoint =
                        crate::profileset_generator::checkpoint::Checkpoint {
                            phase: crate::profileset_generator::checkpoint::CheckpointPhase::Staged(
                                crate::profileset_generator::checkpoint::StagedCheckpoint {
                                    next_stage_idx: next_idx,
                                    next_stage_name: next_name,
                                    survivor_combo_ids,
                                },
                            ),
                            constants,
                        };
                    if let Ok(json) = checkpoint.to_json_string() {
                        let _ = sqlx::query(
                            "UPDATE jobs SET checkpoint = $1 WHERE id = $2",
                        )
                        .bind(&json)
                        .bind(job_id)
                        .execute(p)
                        .await;
                    }
                    // Poll pause_requested.
                    let pause_repo = crate::db::JobRepo::new(p.clone());
                    if let Ok(true) = pause_repo.get_pause_requested(job_id).await {
                        let _ = pause_repo.set_pause_requested(job_id, false).await;
                        let _ = pause_repo
                            .update_status(job_id, crate::models::JobStatus::Paused)
                            .await;
                        return Err(StagedRunError::Paused);
                    }
                }
            }

            stage_idx += 1;
            continue;
        }

        // Save eliminated combos' DPS from this stage (for the final result merge).
        // Only clones the subset we actually drop — full kept set stays as borrow.
        for ps in profilesets {
            let name = ps.get("name").and_then(|n| n.as_str()).unwrap_or("");
            if !name.is_empty() && !keep_combos.contains(name) {
                eliminated.insert(name.to_string(), ps.clone());
            }
        }

        on_stage_complete(&format!(
            "{} · {} → {} combos",
            stage.name,
            profilesets.len(),
            keep_combos.len()
        ));

        println!(
            "Job {}: Stage {} complete — keeping {}/{} combos",
            job_id,
            stage.name,
            keep_combos.len(),
            profilesets.len()
        );

        if simc_input_mode == crate::models::SimcInputMode::Streamed {
            if let Some(ref p) = pool {
                let next_idx = stage_idx + 1;
                let next_name = stages
                    .get(next_idx)
                    .map(|s| s.name.to_string())
                    .unwrap_or_else(|| "Done".to_string());
                // combo_name format is "Combo N" where N is the combo_id,
                // so parse the integer directly instead of DB round-trips.
                let survivor_combo_ids: Vec<i64> =
                    keep_combos.iter().filter_map(|n| parse_combo_id(n)).collect();
                let checkpoint =
                    crate::profileset_generator::checkpoint::Checkpoint {
                        phase: crate::profileset_generator::checkpoint::CheckpointPhase::Staged(
                            crate::profileset_generator::checkpoint::StagedCheckpoint {
                                next_stage_idx: next_idx,
                                next_stage_name: next_name,
                                survivor_combo_ids,
                            },
                        ),
                        constants,
                    };
                if let Ok(json) = checkpoint.to_json_string() {
                    let _ = sqlx::query(
                        "UPDATE jobs SET checkpoint = $1 WHERE id = $2",
                    )
                    .bind(&json)
                    .bind(job_id)
                    .execute(p)
                    .await;
                }
                // Poll pause_requested.
                let pause_repo = crate::db::JobRepo::new(p.clone());
                if let Ok(true) = pause_repo.get_pause_requested(job_id).await {
                    let _ = pause_repo.set_pause_requested(job_id, false).await;
                    let _ = pause_repo
                        .update_status(job_id, crate::models::JobStatus::Paused)
                        .await;
                    return Err(StagedRunError::Paused);
                }
            }
        }

        current_input = filter_simc_input(&current_input, &keep_combos);
        remaining = keep_combos.len();

        // Skip intermediate stages once survivors are few enough — jump to final precision.
        if remaining <= SKIP_TO_FINAL_THRESHOLD {
            stage_idx = final_idx;
        } else {
            stage_idx += 1;
        }
    }

    // Inject eliminated combos into the final result so all combos appear in output.
    if !eliminated.is_empty() {
        if let Some(ref mut output) = result {
            if let Some(results_arr) = output
                .json
                .pointer_mut("/sim/profilesets/results")
                .and_then(|v| v.as_array_mut())
            {
                let final_names: std::collections::HashSet<String> = results_arr
                    .iter()
                    .filter_map(|ps| {
                        ps.get("name")
                            .and_then(|n| n.as_str())
                            .map(|s| s.to_string())
                    })
                    .collect();
                for (name, ps) in &eliminated {
                    if !final_names.contains(name) {
                        results_arr.push(ps.clone());
                    }
                }
            }
        }
    }

    result.ok_or_else(|| StagedRunError::Other("No simulation result produced".to_string()))
}

/// Run simc on a single Triage batch's profileset input.
/// Fixed 50 iterations (or the caller-supplied value), no scale factors,
/// no HTML report, no consumables / expansion options injection.
/// Returns the parsed `sim.profilesets.results` JSON array.
pub async fn run_simc_triage_batch(
    base_profile: &str,
    profileset_simc_lines: &str,
    iterations: u32,
    fight_style: &str,
    target_error: f64,
    simc_bin: &std::path::Path,
    job_id: &str,
    log_buffer: std::sync::Arc<crate::log_buffer::LogBuffer>,
) -> Result<Vec<Value>, String> {
    // Build a minimal simc input: base profile + profilesets + sim options.
    // Intentionally bypasses build_full_simc_input to avoid injecting consumables
    // and expansion options that are irrelevant for the cheap triage pass.
    let threads = max_threads();
    let mut triage_input = String::with_capacity(
        base_profile.len() + profileset_simc_lines.len() + 256,
    );
    triage_input.push_str(base_profile);
    triage_input.push('\n');
    triage_input.push_str(profileset_simc_lines);
    triage_input.push_str("\n\n# Simulation Options\n");
    triage_input.push_str(&format!("iterations={}\n", iterations));
    triage_input.push_str(&format!("target_error={}\n", target_error));
    triage_input.push_str(&format!("fight_style={}\n", fight_style));
    triage_input.push_str("calculate_scale_factors=0\n");
    triage_input.push_str("single_actor_batch=1\n");
    triage_input.push_str("optimize_expressions=1\n");
    triage_input.push_str("report_details=0\n");
    // Use parallel profilesets for triage — many profilesets, low iterations.
    triage_input.push_str("profileset_work_threads=1\n");

    // Reuse existing overrides for buffs/baseline consistency.
    for opt in OVERRIDES {
        triage_input.push_str(&format!("{}\n", opt));
    }

    // Use `raw=true` so run_simc_subprocess skips build_full_simc_input.
    let options = serde_json::json!({});
    let logs = log_buffer.clone();
    let log_jid = job_id.to_string();
    let output = run_simc_subprocess(
        simc_bin,
        true, // raw — input is already fully composed above
        job_id,
        &triage_input,
        &options,
        fight_style,
        target_error,
        iterations,
        threads,
        1,     // desired_targets
        300,   // max_time (seconds)
        false, // calculate_scale_factors
        true,  // single_actor_batch
        "triage",
        false, // generate_html
        |_, _| {}, // no per-profileset progress callbacks needed
        move |line| logs.push_line(&log_jid, line.to_string()),
    )
    .await?;

    let results = output
        .json
        .get("sim")
        .and_then(|s| s.get("profilesets"))
        .and_then(|p| p.get("results"))
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashSet;

    fn ps(name: &str, mean: f64) -> Value {
        json!({ "name": name, "mean": mean })
    }

    fn keep_set(names: &[&str]) -> HashSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn filter_simc_input_keeps_only_named_combos_inline_format() {
        // Legacy top_gear path: each combo prefixed by `### Combo N`.
        let input = "# Base Actor\nhead=base\n\
            ### Combo 1\nprofileset.\"Combo 1\"+=head=a\n\
            ### Combo 2\nprofileset.\"Combo 2\"+=head=b\n\
            ### Combo 3\nprofileset.\"Combo 3\"+=head=c";
        let out = filter_simc_input(input, &keep_set(&["Combo 2"]));
        assert!(out.contains("### Combo 2"));
        assert!(out.contains("profileset.\"Combo 2\""));
        assert!(!out.contains("### Combo 1"));
        assert!(!out.contains("profileset.\"Combo 1\""));
        assert!(!out.contains("### Combo 3"));
        assert!(!out.contains("profileset.\"Combo 3\""));
        assert!(out.contains("head=base"));
    }

    #[test]
    fn filter_simc_input_keeps_only_named_combos_streamed_format() {
        // Streamed handoff path: profileset.* lines only, no `### Combo` headers.
        // Regression test for the bug where staged-pipeline pruning silently
        // no-op'd because the filter relied on headers that don't exist here.
        let input = "# Base Actor\nhead=base\n\
            profileset.\"Combo 2\"+=head=a\n\
            profileset.\"Combo 2\"+=talents=x\n\
            profileset.\"Combo 3\"+=head=b\n\
            profileset.\"Combo 4\"+=head=c";
        let out = filter_simc_input(input, &keep_set(&["Combo 3"]));
        assert!(out.contains("profileset.\"Combo 3\"+=head=b"));
        assert!(!out.contains("profileset.\"Combo 2\""));
        assert!(!out.contains("profileset.\"Combo 4\""));
        assert!(out.contains("head=base"));
    }

    #[test]
    fn filter_simc_input_empty_keep_set_drops_all_profilesets() {
        let input = "# Base Actor\nhead=base\nprofileset.\"Combo 2\"+=head=a";
        let out = filter_simc_input(input, &keep_set(&[]));
        assert!(!out.contains("profileset."));
        assert!(out.contains("head=base"));
    }

    #[test]
    fn empty_input_returns_empty() {
        let kept = select_kept_profilesets(&[], 1.0, 5, None);
        assert!(kept.is_empty());
    }

    #[test]
    fn keeps_combos_within_two_target_error_of_top() {
        // Top = 1000, te = 1.0% → threshold = 1000 * 0.98 = 980.
        // 990 kept, 980 kept (boundary), 979.99 dropped, 950 dropped.
        let pss = vec![
            ps("a", 1000.0),
            ps("b", 990.0),
            ps("c", 980.0),
            ps("d", 979.99),
            ps("e", 950.0),
        ];
        let kept = select_kept_profilesets(&pss, 1.0, 1, None);
        assert!(kept.contains("a"));
        assert!(kept.contains("b"));
        assert!(kept.contains("c"));
        assert!(!kept.contains("d"));
        assert!(!kept.contains("e"));
    }

    #[test]
    fn min_keep_floor_takes_top_n_when_too_few_pass_threshold() {
        // Top = 1000, te = 0.1% → threshold = 1000 * 0.998 = 998.
        // Only "a" passes (1000 ≥ 998), but min_keep = 3 → top 3 by mean.
        let pss = vec![
            ps("a", 1000.0),
            ps("b", 500.0),
            ps("c", 400.0),
            ps("d", 300.0),
        ];
        let kept = select_kept_profilesets(&pss, 0.1, 3, None);
        assert_eq!(kept.len(), 3);
        assert!(kept.contains("a"));
        assert!(kept.contains("b"));
        assert!(kept.contains("c"));
        assert!(!kept.contains("d"));
    }

    #[test]
    fn all_tied_within_threshold_keeps_all() {
        // All within 1% of top, te = 1.0% (threshold = 98%) → everyone passes.
        let pss = vec![ps("a", 1000.0), ps("b", 995.0), ps("c", 990.0)];
        let kept = select_kept_profilesets(&pss, 1.0, 1, None);
        assert_eq!(kept.len(), 3);
    }

    #[test]
    fn high_target_error_keeps_more_than_low_target_error() {
        // Same data, different te → larger te keeps more.
        let pss = vec![
            ps("a", 1000.0),
            ps("b", 970.0),
            ps("c", 960.0),
            ps("d", 950.0),
        ];
        let kept_loose = select_kept_profilesets(&pss, 2.0, 1, None); // threshold = 960
        let kept_tight = select_kept_profilesets(&pss, 0.5, 1, None); // threshold = 990
        assert!(kept_loose.len() > kept_tight.len());
        assert_eq!(kept_tight.len(), 1); // only "a"
    }

    #[test]
    fn min_keep_capped_at_total_combos_count() {
        // min_keep larger than the input size shouldn't panic.
        let pss = vec![ps("a", 1000.0), ps("b", 500.0)];
        let kept = select_kept_profilesets(&pss, 0.01, 999, None);
        assert_eq!(kept.len(), 2);
    }

    #[test]
    fn unnamed_profilesets_filtered_out() {
        // A profileset missing the "name" field can't be tracked downstream.
        let pss = vec![ps("a", 1000.0), json!({ "mean": 990.0 })];
        let kept = select_kept_profilesets(&pss, 1.0, 1, None);
        assert_eq!(kept.len(), 1);
        assert!(kept.contains("a"));
    }

    #[test]
    fn missing_mean_treated_as_zero_and_drops_to_bottom() {
        // A profileset without "mean" sorts to the bottom; threshold logic still works.
        let pss = vec![
            ps("a", 1000.0),
            json!({ "name": "no_mean" }),
            ps("b", 990.0),
        ];
        let kept = select_kept_profilesets(&pss, 1.0, 1, None);
        assert!(kept.contains("a"));
        assert!(kept.contains("b"));
        assert!(!kept.contains("no_mean"));
    }

    // ---- baseline cutoff ----

    #[test]
    fn baseline_cutoff_prunes_likely_non_upgrades_when_top_is_close_to_baseline() {
        // Baseline = 1000, top alt = 1005 (marginal upgrade). te = 2.0%.
        //   top threshold     = 1005 * (1 - 0.04) =  964.8
        //   baseline threshold = 1000 * (1 - 0.04) =  960.0
        //   effective        = max(964.8, 960.0)  =  964.8
        // Without baseline: "c" at 970 would survive only the top cut anyway,
        // but adding baseline makes the cut explicit even when top tracks baseline.
        let pss = vec![ps("a", 1005.0), ps("b", 980.0), ps("c", 970.0), ps("d", 950.0)];
        let kept = select_kept_profilesets(&pss, 2.0, 1, Some(1000.0));
        assert!(kept.contains("a"));
        assert!(kept.contains("b"));
        assert!(kept.contains("c"));
        assert!(!kept.contains("d"));
    }

    #[test]
    fn baseline_cutoff_drops_everything_when_no_alternatives_are_upgrades() {
        // Baseline = 1000, all alts below baseline. te = 2.0% → baseline cutoff = 960.
        // Top-only cutoff (top = 900) would keep "a"+"b" (within 4% of 900 = 864).
        // Baseline cutoff (960) drops all. min_keep = 1 still tops up to 1 survivor
        // so the runner has something to keep around for the next stage / final.
        let pss = vec![ps("a", 900.0), ps("b", 880.0), ps("c", 850.0)];
        let kept = select_kept_profilesets(&pss, 2.0, 1, Some(1000.0));
        assert_eq!(kept.len(), 1);
        assert!(kept.contains("a"));
    }

    #[test]
    fn baseline_cutoff_only_applies_when_stricter_than_top() {
        // Big upgrade exists: top = 1200, baseline = 1000, te = 2.0%.
        //   top threshold     = 1200 * 0.96 = 1152
        //   baseline threshold = 1000 * 0.96 =  960
        //   effective        = max(1152, 960) = 1152
        // Combo "b" at 1100 is above baseline cutoff (960) but below top cutoff
        // (1152) — top-cutoff dominates, "b" drops.
        let pss = vec![ps("a", 1200.0), ps("b", 1100.0), ps("c", 1050.0)];
        let kept = select_kept_profilesets(&pss, 2.0, 1, Some(1000.0));
        assert_eq!(kept.len(), 1);
        assert!(kept.contains("a"));
    }

    #[test]
    fn baseline_none_behaves_like_top_only_cutoff() {
        // Sanity: passing None reproduces the pre-baseline behavior exactly.
        let pss = vec![ps("a", 1000.0), ps("b", 990.0), ps("c", 950.0)];
        let kept_none = select_kept_profilesets(&pss, 1.0, 1, None);
        let kept_baseline_neg_inf = select_kept_profilesets(&pss, 1.0, 1, Some(f64::MIN));
        assert_eq!(kept_none, kept_baseline_neg_inf);
    }

    // ---- baseline_mean_for_pruning ----

    fn sim_with_base_actor_dps(mean: f64) -> Value {
        json!({
            "sim": {
                "players": [{ "collected_data": { "dps": { "mean": mean } } }]
            }
        })
    }

    #[test]
    fn baseline_reads_base_actor_dps_from_sim_output() {
        let raw = sim_with_base_actor_dps(1000.0);
        assert_eq!(baseline_mean_for_pruning(&raw, &[]), Some(1000.0));
    }

    #[test]
    fn baseline_takes_max_of_base_actor_and_currently_equipped_profilesets() {
        // Multi-talent job: base actor on talent A is 950, Currently Equipped (B)
        // profileset is 1010. Use the larger.
        let raw = sim_with_base_actor_dps(950.0);
        let pss = vec![
            ps("Currently Equipped (B)", 1010.0),
            ps("Combo 2", 900.0),
        ];
        assert_eq!(baseline_mean_for_pruning(&raw, &pss), Some(1010.0));
    }

    #[test]
    fn baseline_returns_none_when_no_player_dps_and_no_baseline_profileset() {
        let raw = json!({ "sim": { "players": [] } });
        let pss = vec![ps("Combo 2", 900.0)];
        assert_eq!(baseline_mean_for_pruning(&raw, &pss), None);
    }

    #[test]
    fn baseline_falls_back_to_currently_equipped_profileset_when_player_dps_missing() {
        let raw = json!({ "sim": { "players": [] } });
        let pss = vec![ps("Currently Equipped", 1000.0)];
        assert_eq!(baseline_mean_for_pruning(&raw, &pss), Some(1000.0));
    }

    // ---- iterations_for_stage ----

    #[test]
    fn iterations_final_stage_uses_user_iters() {
        // Last stage always returns user_iters regardless of target_error.
        assert_eq!(iterations_for_stage(5, 6, 1000, 0.5), 1000);
        assert_eq!(iterations_for_stage(0, 1, 1000, 0.5), 1000);
    }

    #[test]
    fn iterations_caps_by_target_error_band() {
        // High user_iters: cap is dominated by target_error.
        assert_eq!(iterations_for_stage(0, 4, 100_000, 2.0), 50); // Probe
        assert_eq!(iterations_for_stage(0, 4, 100_000, 1.0), 125); // Coarse
        assert_eq!(iterations_for_stage(0, 4, 100_000, 0.5), 500); // Refine
        assert_eq!(iterations_for_stage(0, 4, 100_000, 0.2), 3_000); // Medium
        assert_eq!(iterations_for_stage(0, 4, 100_000, 0.1), 12_000); // Fine
        assert_eq!(iterations_for_stage(0, 4, 100_000, 0.05), 50_000); // Trace
    }

    #[test]
    fn iterations_user_iters_caps_below_band_cap() {
        // user_iters below the band's cap → user_iters wins.
        assert_eq!(iterations_for_stage(0, 4, 30, 2.0), 30); // Probe band=50, user=30
        assert_eq!(iterations_for_stage(0, 4, 100, 1.0), 100); // Coarse band=125, user=100
    }

    // ---- progress_range_for_stage ----

    #[test]
    fn progress_ranges_span_10_to_95_inline() {
        // Inline (eager) path: base_start = 10, spans 10..95.
        let (start, _) = progress_range_for_stage(0, 6, 10);
        assert_eq!(start, 10);
        let (_, end) = progress_range_for_stage(5, 6, 10);
        assert!(end >= 90 && end <= 95);
    }

    #[test]
    fn progress_ranges_span_50_to_95_streamed() {
        // Streamed path: base_start = 50, spans 50..95.
        let (start, _) = progress_range_for_stage(0, 6, 50);
        assert_eq!(start, 50);
        let (_, end) = progress_range_for_stage(5, 6, 50);
        assert!(end >= 90 && end <= 95);
    }

    #[test]
    fn progress_ranges_are_monotonic_and_non_overlapping() {
        let total = 6;
        // Test both inline (base_start=10) and streamed (base_start=50) paths.
        for base_start in [10u8, 50u8] {
            let mut prev_end = 0u8;
            for i in 0..total {
                let (start, end) = progress_range_for_stage(i, total, base_start);
                assert!(
                    start >= prev_end,
                    "base_start={base_start} stage {i} start {start} < prev end {prev_end}"
                );
                assert!(
                    end > start,
                    "base_start={base_start} stage {i} end {end} <= start {start}"
                );
                prev_end = end;
            }
        }
    }

    // ---- staged schedule sanity ----

    fn schedule_targets(user_te: f64) -> Vec<f64> {
        build_stage_schedule(user_te)
            .into_iter()
            .map(|s| s.target_error)
            .collect()
    }

    #[test]
    fn schedule_targets_decrease_monotonically_at_every_user_precision() {
        for user_te in [2.5, 1.0, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005] {
            let stages = build_stage_schedule(user_te);
            let mut prev = f64::INFINITY;
            for stage in &stages {
                assert!(
                    stage.target_error <= prev,
                    "user_te={user_te}: stage {} target_error {} > previous {}",
                    stage.name,
                    stage.target_error,
                    prev
                );
                prev = stage.target_error;
            }
        }
    }

    #[test]
    fn schedule_final_stage_is_user_target_error() {
        for user_te in [2.5, 0.5, 0.2, 0.05, 0.01, 0.005] {
            let stages = build_stage_schedule(user_te);
            let last = stages.last().expect("schedule must be non-empty");
            assert_eq!(last.name, "Final");
            assert!(
                (last.target_error - user_te).abs() < f64::EPSILON,
                "user_te={user_te}: final stage target_error was {}",
                last.target_error
            );
        }
    }

    #[test]
    fn schedule_at_005_matches_legacy_six_stage_schedule() {
        // Lock the existing production schedule so this refactor is a no-op
        // for the default user precision.
        assert_eq!(schedule_targets(0.05), vec![2.0, 1.0, 0.5, 0.2, 0.1, 0.05]);
    }

    #[test]
    fn schedule_drops_intermediate_stages_tighter_than_user_precision() {
        // user_te=0.2 should not run a 0.1/0.05 intermediate pass — those would
        // be more precise than the user asked for.
        assert_eq!(schedule_targets(0.2), vec![2.0, 1.0, 0.5, 0.2]);
        assert_eq!(schedule_targets(0.5), vec![2.0, 1.0, 0.5]);
        assert_eq!(schedule_targets(1.0), vec![2.0, 1.0]);
    }

    #[test]
    fn schedule_extends_with_extra_intermediates_for_tighter_user_precision() {
        // user_te=0.01 grows the schedule past the legacy 0.05 floor.
        assert_eq!(
            schedule_targets(0.01),
            vec![2.0, 1.0, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01]
        );
    }

    #[test]
    fn schedule_handles_user_target_error_between_candidate_stops() {
        // 0.3 doesn't match a candidate — keeps stages > 0.3 and appends Final(0.3).
        assert_eq!(schedule_targets(0.3), vec![2.0, 1.0, 0.5, 0.3]);
    }

    #[test]
    fn schedule_at_very_loose_user_precision_collapses_to_single_final_stage() {
        // user_te=3.0 has no looser candidates — runs a single Final pass.
        let stages = build_stage_schedule(3.0);
        assert_eq!(stages.len(), 1);
        assert_eq!(stages[0].name, "Final");
        assert_eq!(stages[0].target_error, 3.0);
    }
}
