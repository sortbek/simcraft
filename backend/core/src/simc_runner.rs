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
    keep_top: f64,
    min_keep: usize,
}

const STAGES: &[Stage] = &[
    Stage {
        name: "Low",
        target_error: 1.0,
        keep_top: 0.5,
        min_keep: 10,
    },
    Stage {
        name: "Medium",
        target_error: 0.2,
        keep_top: 0.3,
        min_keep: 5,
    },
    Stage {
        name: "High",
        target_error: 0.05,
        keep_top: 1.0,
        min_keep: 1,
    },
];

const STAGED_THRESHOLD: usize = 10;

/// Build the full simc input from the options Value (convenience wrapper).
pub fn build_simc_input_from_options(simc_input: &str, options: &Value) -> String {
    let fight_style = options.get("fight_style").and_then(|v| v.as_str()).unwrap_or("Patchwerk");
    let target_error = options.get("target_error").and_then(|v| v.as_f64()).unwrap_or(0.1);
    let iterations = options.get("iterations").and_then(|v| v.as_u64()).unwrap_or(10000) as u32;
    let desired_targets = options.get("desired_targets").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
    let max_time = options.get("max_time").and_then(|v| v.as_u64()).unwrap_or(300) as u32;
    let calculate_scale_factors = options.get("sim_type").and_then(|v| v.as_str()) == Some("stat_weights");
    let single_actor_batch = options.get("single_actor_batch").and_then(|v| v.as_bool()).unwrap_or(true);
    let is_dungeon_route = simc_input.lines().any(|l| {
        let t = l.trim();
        t == "fight_style=DungeonRoute" || t == "fight_style=\"DungeonRoute\""
    });

    build_full_simc_input(
        simc_input, options, fight_style, target_error, iterations,
        desired_targets, max_time, calculate_scale_factors, single_actor_batch, is_dungeon_route,
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
            result.push_str(&format!("override.{}={}\n", key, if enabled { "1" } else { "0" }));
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

fn get_profileset_results(raw: &Value) -> Vec<Value> {
    raw.get("sim")
        .and_then(|s| s.get("profilesets"))
        .and_then(|p| p.get("results"))
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default()
}

pub fn filter_simc_input(
    simc_input: &str,
    keep_combos: &std::collections::HashSet<String>,
) -> String {
    let header_re = Regex::new(r"^###\s+(Combo \d+)").unwrap();
    let lines: Vec<&str> = simc_input.split('\n').collect();
    let mut output: Vec<&str> = Vec::new();
    let mut current_combo: Option<String> = None;
    let mut in_kept_combo = true;

    for line in &lines {
        if let Some(caps) = header_re.captures(line) {
            let combo_name = caps[1].to_string();
            in_kept_combo = keep_combos.contains(&combo_name);
            current_combo = Some(combo_name);
            if in_kept_combo {
                output.push(line);
            }
            continue;
        }

        if line.trim().starts_with("profileset.") {
            if in_kept_combo {
                output.push(line);
            }
            continue;
        }

        if current_combo.is_some() && line.trim().starts_with('#') {
            if in_kept_combo {
                output.push(line);
            }
            continue;
        }

        output.push(line);
        current_combo = None;
        in_kept_combo = true;
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

/// Run a multi-stage simulation for Top Gear.
#[allow(clippy::too_many_arguments)]
pub async fn run_simc_staged(
    simc_path: &Path,
    job_id: &str,
    simc_input: &str,
    options: &Value,
    combo_count: usize,
    on_progress: impl Fn(u8, &str, &str),
    on_stage_complete: impl Fn(&str),
    on_log: impl Fn(&str) + Clone,
) -> Result<SimcOutput, String> {
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
        .await;
    }

    let mut current_input = simc_input.to_string();
    let mut remaining = combo_count;
    let mut result: Option<SimcOutput> = None;

    // Collect eliminated combos' results so they appear in the final output.
    // Key: combo name, Value: profileset result object from the stage where it was cut.
    let mut eliminated: HashMap<String, Value> = HashMap::new();

    let stage_iterations = [
        std::cmp::max(100, user_iterations / 10),
        std::cmp::max(500, user_iterations / 2),
        user_iterations,
    ];

    // Progress ranges per stage: [10..40), [40..70), [70..95)
    let stage_ranges: [(u8, u8); 3] = [(10, 40), (40, 70), (70, 95)];

    for (stage_idx, stage) in STAGES.iter().enumerate() {
        let is_final = stage_idx == STAGES.len() - 1;
        let (range_start, range_end) = stage_ranges[stage_idx];

        on_progress(
            range_start,
            &format!("Stage {} of {}", stage_idx + 1, STAGES.len()),
            &format!("{} combos · {} precision", remaining, stage.name),
        );

        println!(
            "Job {}: Stage {} — {} combos, target_error={}, iterations={}",
            job_id, stage.name, remaining, stage.target_error, stage_iterations[stage_idx]
        );

        let stage_result = run_simc_subprocess(
            simc_path,
            false, // not raw
            job_id,
            &current_input,
            options,
            fight_style,
            stage.target_error,
            stage_iterations[stage_idx],
            threads,
            desired_targets,
            max_time,
            false,
            single_actor_batch,
            &stage.name.to_lowercase(),
            false, // skip HTML for staged sims
            |current, total| {
                let pct = range_start
                    + ((current as f64 / total as f64) * (range_end - range_start) as f64) as u8;
                on_progress(
                    pct,
                    &format!("Stage {} of {}", stage_idx + 1, STAGES.len()),
                    &format!(
                        "{}/{} profilesets · {} precision",
                        current, total, stage.name
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

        let profilesets = get_profileset_results(&result.as_ref().unwrap().json);
        if profilesets.is_empty() {
            on_stage_complete(&format!("{} · no results", stage.name));
            break;
        }

        let keep_count = std::cmp::max(
            stage.min_keep,
            (profilesets.len() as f64 * stage.keep_top) as usize,
        );

        if keep_count >= profilesets.len() {
            on_stage_complete(&format!(
                "{} · kept all {} combos",
                stage.name,
                profilesets.len()
            ));
            continue;
        }

        let mut sorted_ps = profilesets.clone();
        sorted_ps.sort_by(|a, b| {
            let a_mean = a.get("mean").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let b_mean = b.get("mean").and_then(|v| v.as_f64()).unwrap_or(0.0);
            b_mean
                .partial_cmp(&a_mean)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let keep_combos: std::collections::HashSet<String> = sorted_ps
            .iter()
            .take(keep_count)
            .filter_map(|ps| {
                ps.get("name")
                    .and_then(|n| n.as_str())
                    .map(|s| s.to_string())
            })
            .collect();

        // Save eliminated combos' DPS from this stage
        for ps in &sorted_ps {
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

        current_input = filter_simc_input(&current_input, &keep_combos);
        remaining = keep_combos.len();
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

    result.ok_or_else(|| "No simulation result produced".to_string())
}
