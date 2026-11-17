//! Runs `simhammer-forever <command> --in request.json --out result.json` and reads the result.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::watch;

const TIMEOUT: Duration = Duration::from_secs(30 * 60);
pub const CANCELLED: &str = "cancelled";

#[cfg(unix)]
extern "C" {
    fn setpriority(which: i32, who: u32, prio: i32) -> i32;
}

/// Turns the engine's `progress <done> <total>` lines into whole percents that only move
/// forward: one update per percent, none when a bulk stage restarts its count.
#[derive(Default)]
pub struct ProgressGate {
    last: u8,
}

impl ProgressGate {
    pub fn advance(&mut self, done: u32, total: u32) -> Option<u8> {
        if total == 0 {
            return None;
        }
        let pct = ((done as u64 * 100) / total as u64).min(99) as u8;
        (pct > self.last).then(|| {
            self.last = pct;
            pct
        })
    }
}

pub fn parse_progress(line: &str) -> Option<(u32, u32)> {
    let mut parts = line.strip_prefix("progress ")?.split_whitespace();
    Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
}

pub async fn run_cli(
    binary: &Path,
    command: &str,
    request: &Value,
    extra_args: &[String],
    mut cancel: watch::Receiver<bool>,
    on_log: impl Fn(&str) + Send,
    on_progress: impl Fn(u8) + Send,
) -> Result<Value, String> {
    let dir = tempfile::tempdir().map_err(|e| format!("temp dir: {e}"))?;
    let (input, output) = (
        dir.path().join("request.json"),
        dir.path().join("result.json"),
    );
    std::fs::write(&input, request.to_string()).map_err(|e| format!("write request: {e}"))?;
    let mut cmd = Command::new(binary);
    cmd.arg(command)
        .arg("--in")
        .arg(&input)
        .arg("--out")
        .arg(&output)
        .args(extra_args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000 | 0x00004000); // CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS
    #[cfg(unix)]
    unsafe {
        cmd.pre_exec(|| {
            setpriority(0, 0, 19);
            Ok(())
        });
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Forever engine could not start: {e}"))?;
    let stderr = child.stderr.take().expect("stderr piped");
    // Owns the child, so dropping this future (timeout, cancel) kills the process.
    let run = async move {
        let mut last_error = String::new();
        let mut gate = ProgressGate::default();
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some((done, total)) = parse_progress(&line) {
                if let Some(pct) = gate.advance(done, total) {
                    on_progress(pct);
                }
            } else {
                if let Some(msg) = line.strip_prefix("error: ") {
                    last_error = msg.to_string();
                }
                on_log(&line);
            }
        }
        (child.wait().await, last_error)
    };
    let cancelled = async {
        while cancel.changed().await.is_ok() {
            if *cancel.borrow() {
                return;
            }
        }
        std::future::pending::<()>().await
    };
    let (status, last_error) = tokio::select! {
        done = run => done,
        _ = cancelled => return Err(CANCELLED.into()),
        _ = tokio::time::sleep(TIMEOUT) => return Err("Forever engine timed out after 30 minutes".into()),
    };
    let status = status.map_err(|e| format!("Forever engine: {e}"))?;
    if !status.success() {
        return Err(if last_error.is_empty() {
            format!("Forever engine exited with {status}")
        } else {
            last_error
        });
    }
    let raw = std::fs::read_to_string(&output)
        .map_err(|e| format!("Forever engine wrote no result: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Forever engine result: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn never_cancelled() -> tokio::sync::watch::Receiver<bool> {
        let (tx, rx) = tokio::sync::watch::channel(false);
        std::mem::forget(tx);
        rx
    }

    #[test]
    fn progress_only_moves_forward_once_per_percent() {
        let mut gate = ProgressGate::default();
        assert_eq!(gate.advance(1, 1000), None, "0% is not news");
        assert_eq!(gate.advance(10, 1000), Some(1));
        assert_eq!(gate.advance(19, 1000), None, "still 1%");
        assert_eq!(gate.advance(500, 1000), Some(50));
        assert_eq!(
            gate.advance(400, 1000),
            None,
            "never backwards (a new bulk stage restarts its count)"
        );
        assert_eq!(
            gate.advance(1000, 1000),
            Some(99),
            "100% is the result write, not a progress line"
        );
        assert_eq!(gate.advance(5, 0), None);
    }

    #[test]
    fn progress_lines_parse() {
        assert_eq!(parse_progress("progress 150 3000"), Some((150, 3000)));
        assert_eq!(parse_progress("Sim Progress: 1 / 2"), None);
        assert_eq!(parse_progress("progress x 1"), None);
    }

    #[tokio::test]
    async fn missing_binary_is_an_error() {
        let err = run_cli(
            Path::new("does-not-exist-forever"),
            "sim",
            &serde_json::json!({}),
            &[],
            never_cancelled(),
            |_| {},
            |_| {},
        )
        .await
        .unwrap_err();
        assert!(err.contains("could not start"), "{err}");
    }

    /// The real engine, when FOREVER_DIR names an install: the request it takes and the results
    /// the result pages are built from.
    #[tokio::test]
    async fn installed_engine_sims_and_ranks_gear() {
        use crate::forever::import::parse_export;
        use crate::forever::request::{bulk_request, raid_request, SimSettings};
        use crate::forever::result::{gear_result, quick_result, ResultMeta};

        let Some(engine) = std::env::var("FOREVER_DIR")
            .ok()
            .and_then(|dir| crate::forever::ForeverEngine::locate(Path::new(&dir)).ok())
        else {
            eprintln!("skipped: FOREVER_DIR names no Forever engine");
            return;
        };
        let export = include_str!("testdata/sylfrey.simc").replace("level=27", "level=60");
        let ch = parse_export(&export).unwrap();
        let settings = SimSettings {
            iterations: 1000,
            duration_seconds: 120.0,
        };
        let meta = ResultMeta {
            player_name: ch.name.clone(),
            spec_key: "protectionPaladin".into(),
            fight_length: 120.0,
            iterations: 1000,
            engine_commit: engine.data.version.engine_commit.clone(),
            gear: Vec::new(),
            settings: Value::Null,
        };
        let base = raid_request(&ch, &engine.data, "protectionPaladin", "", &settings);
        let worn = base["raid"]["parties"][0]["players"][0]["equipment"]["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|i| i["id"].as_u64().unwrap_or(0) > 0)
            .count();
        assert!(worn >= 10, "the bundle knows {worn} of the worn items");

        let raw = run_cli(
            &engine.binary,
            "sim",
            &base,
            &[],
            never_cancelled(),
            |_| {},
            |_| {},
        )
        .await
        .unwrap();
        let quick = quick_result(&raw, &engine.data, &meta);
        assert!(quick["dps"].as_f64().unwrap() > 0.0, "{quick}");
        let abilities = quick["abilities"].as_array().unwrap();
        assert!(!abilities.is_empty());
        assert!(abilities
            .iter()
            .all(|a| !a["name"].as_str().unwrap().starts_with("Spell ")));

        let bulk = bulk_request(base, &ch.bags, &engine.data);
        assert!(!bulk["bulkSettings"]["items"].as_array().unwrap().is_empty());
        let raw = run_cli(
            &engine.binary,
            "bulk",
            &bulk,
            &["--max-combinations".to_string(), "500".to_string()],
            never_cancelled(),
            |_| {},
            |_| {},
        )
        .await
        .unwrap();
        let gear = gear_result(&raw, &engine.data, &meta);
        assert!(gear["base_dps"].as_f64().unwrap() > 0.0, "{gear}");
        assert!(gear["results"].as_array().unwrap().len() >= 2, "{gear}");

        // A live level 29 hunter: talents read with the live bundle, sheet, pet and bags.
        let ch = parse_export(include_str!("testdata/sortbek.simc")).unwrap();
        let summary = crate::forever::import::summarize(&ch, &engine.data);
        assert!(summary.can_sim, "{:?}", summary.blocked_reason);
        assert_eq!(
            summary.points_per_tree,
            vec![20, 0, 0],
            "{:?}",
            summary.warnings
        );
        assert!(
            summary.equipped.iter().all(|g| g.known),
            "{:?}",
            summary.warnings
        );
        let base = raid_request(
            &ch,
            &engine.data,
            "hunter",
            &summary.talents_string,
            &settings,
        );
        // As a Quick Sim asks: one logged fight and every fight's value.
        let mut logged = base.clone();
        logged["simOptions"]["debugFirstIteration"] = serde_json::json!(true);
        logged["simOptions"]["saveAllValues"] = serde_json::json!(true);
        let raw = run_cli(
            &engine.binary,
            "sim",
            &logged,
            &[],
            never_cancelled(),
            |_| {},
            |_| {},
        )
        .await
        .unwrap();
        let unit = &raw["raidMetrics"]["parties"][0]["players"][0];
        let dps = unit["dps"]["avg"].as_f64().unwrap();
        assert!(
            (100.0..250.0).contains(&dps),
            "level 29 hunter at {dps} dps"
        );
        assert!(unit["pets"][0]["dps"]["avg"].as_f64().unwrap() > 0.0);
        assert_eq!(unit["pets"][0]["name"], "Raptor");
        let hunter = quick_result(&raw, &engine.data, &meta);
        let rows = hunter["abilities"].as_array().unwrap();
        let missing: Vec<&Value> = rows
            .iter()
            .chain(
                rows.iter()
                    .flat_map(|r| r["children"].as_array().into_iter().flatten()),
            )
            .filter(|r| !r["icon"].is_string())
            .map(|r| &r["name"])
            .collect();
        assert!(missing.is_empty(), "rows without an icon: {missing:?}");
        let shoot = hunter["ability_details"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["name"] == "Shoot")
            .unwrap();
        assert!(
            shoot["casts"].as_f64().unwrap() > 20.0 && shoot["per_cast"].as_f64().unwrap() > 20.0,
            "{shoot}"
        );
        assert!(hunter["ability_details"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["owner"] == "Raptor"));
        assert!(hunter["dps_min"].as_f64().unwrap() < hunter["dps_max"].as_f64().unwrap());
        assert!(!hunter["dps_hist"].as_array().unwrap().is_empty());
        assert!(
            hunter["debuffs"]
                .as_array()
                .unwrap()
                .iter()
                .any(|d| d["name"] == "Hunter's Mark"),
            "{}",
            hunter["debuffs"]
        );
        assert!(!hunter["buffs"].as_array().unwrap().is_empty());
        let median = hunter["dps_median"].as_f64().unwrap();
        assert!((median - dps).abs() < 10.0, "median {median} against {dps}");
        let apm = hunter["apm"].as_f64().unwrap();
        assert!((5.0..30.0).contains(&apm), "{apm} actions a minute");
        assert!(!hunter["mana"]["spends"].as_array().unwrap().is_empty());
        assert_eq!(hunter["mana"]["gains"][0]["name"], "Regeneration");
        let timeline = &hunter["timeline"];
        let casts = timeline["casts"].as_array().unwrap();
        assert!(
            casts.len() > 50,
            "{} casts in the logged fight",
            casts.len()
        );
        assert!(
            casts[0]["t"].as_f64().unwrap() < 0.0,
            "the prepull comes first"
        );
        assert!(casts.iter().any(|c| c["owner"] == "Raptor"));
        assert!(timeline["auras"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["name"] == "Hunter's Mark" && a["on"] == "target"));
        assert!(timeline["mana"].as_array().unwrap().len() > 10);
        assert_eq!(hunter["rotation"]["id"], "hunter/dps/bm");
        let lines = hunter["rotation"]["lines"].as_array().unwrap();
        assert!(
            lines.len() >= 5 && lines.iter().any(|l| l["text"] == "Cast Aimed Shot"),
            "{lines:?}"
        );
        assert!(!hunter["rotation"]["prepull"].as_array().unwrap().is_empty());
        let bulk = bulk_request(base, &ch.bags, &engine.data);
        let raw = run_cli(
            &engine.binary,
            "bulk",
            &bulk,
            &["--max-combinations".to_string(), "500".to_string()],
            never_cancelled(),
            |_| {},
            |_| {},
        )
        .await
        .unwrap();
        let gear = gear_result(&raw, &engine.data, &meta);
        assert!(gear["results"].as_array().unwrap().len() >= 2, "{gear}");

        // The settings block's options, and a sim with a chosen set.
        let options = run_cli(
            &engine.binary,
            "options",
            &serde_json::json!({ "specKeys": ["hunter"], "talentsString": "", "level": 60 }),
            &[],
            never_cancelled(),
            |_| {},
            |_| {},
        )
        .await
        .unwrap();
        let toggles = options["hunter"]["toggles"].as_array().unwrap();
        assert!(
            toggles.iter().any(|t| t["on"] == true) && toggles.iter().any(|t| t["on"] == false)
        );
        let mut buffed = raid_request(
            &ch,
            &engine.data,
            "hunter",
            &summary.talents_string,
            &settings,
        );
        buffed["simhammer"] =
            serde_json::json!({ "buffs": ["party.trueshotAura", "debuff.huntersMark"] });
        let raw = run_cli(
            &engine.binary,
            "sim",
            &buffed,
            &[],
            never_cancelled(),
            |_| {},
            |_| {},
        )
        .await
        .unwrap();
        let with_buffs = raw["raidMetrics"]["parties"][0]["players"][0]["dps"]["avg"]
            .as_f64()
            .unwrap();
        assert!(
            with_buffs > dps,
            "Trueshot Aura and Hunter's Mark: {with_buffs} against {dps} solo"
        );

        // The same hunter from the MythicSim addon's export, which brings the spellbook. With the
        // Raptor, MythicSim's own site gave 127 for this export.
        let mythic = crate::forever::import::parse_export_with(
            include_str!("testdata/sortbek.mythicsim.json"),
            &engine.data,
        )
        .unwrap();
        let mythic_summary = crate::forever::import::summarize(&mythic, &engine.data);
        assert!(mythic_summary
            .equipped
            .iter()
            .all(|g| g.known && !g.slot.is_empty()));
        assert!(mythic_summary.equipped.iter().any(|g| g.slot == "ranged"));
        assert_eq!(mythic_summary.points_per_tree, vec![20, 0, 0]);
        let request = raid_request(
            &mythic,
            &engine.data,
            "hunter",
            &mythic_summary.talents_string,
            &settings,
        );
        assert!(request["raid"]["parties"][0]["players"][0]["knownSpells"].is_array());
        let raw = run_cli(
            &engine.binary,
            "sim",
            &request,
            &[],
            never_cancelled(),
            |_| {},
            |_| {},
        )
        .await
        .unwrap();
        let with_book = raw["raidMetrics"]["parties"][0]["players"][0]["dps"]["avg"]
            .as_f64()
            .unwrap();
        eprintln!("MythicSim export through SimHammer: {with_book:.1} dps");
        assert!(
            (124.0..130.0).contains(&with_book),
            "MythicSim export at {with_book} dps; their site says 127"
        );

        // A healer sims for healing, and talent builds compare side by side.
        let export = include_str!("testdata/sylfrey.simc").replace("level=27", "level=60");
        let paladin = parse_export(&export).unwrap();
        let healer_meta = ResultMeta {
            spec_key: "holyPaladin".into(),
            player_name: meta.player_name.clone(),
            engine_commit: meta.engine_commit.clone(),
            gear: Vec::new(),
            settings: Value::Null,
            ..meta
        };
        let healer = raid_request(&paladin, &engine.data, "holyPaladin", "", &settings);
        let raw = run_cli(
            &engine.binary,
            "sim",
            &healer,
            &[],
            never_cancelled(),
            |_| {},
            |_| {},
        )
        .await
        .unwrap();
        let healing = quick_result(&raw, &engine.data, &healer_meta);
        assert_eq!(healing["metric"], "hps");
        assert!(healing["dps"].as_f64().unwrap() > 0.0, "{healing}");

        let compare = serde_json::json!({
            "baseRequest": raid_request(&ch, &engine.data, "hunter", "", &settings),
            "variants": [
                { "name": "Exported", "talentsString": summary.talents_string },
                { "name": "No talents", "talentsString": "" },
            ],
        });
        let raw = run_cli(
            &engine.binary,
            "compare",
            &compare,
            &[],
            never_cancelled(),
            |_| {},
            |_| {},
        )
        .await
        .unwrap();
        let compared = crate::forever::result::compare_result(&raw, &healer_meta).unwrap();
        let rows = compared["results"].as_array().unwrap();
        assert_eq!(rows.len(), 2, "{compared}");
        assert_eq!(
            rows[0]["name"], "Exported",
            "20 talent points beat none: {compared}"
        );
    }

    #[cfg(unix)]
    fn fake_engine(dir: &Path, body: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join("fake-engine");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn engine_error_message_is_returned() {
        let dir = tempfile::tempdir().unwrap();
        let bin = fake_engine(dir.path(), "echo 'error: boom' >&2; exit 1");
        let err = run_cli(
            &bin,
            "sim",
            &serde_json::json!({}),
            &[],
            never_cancelled(),
            |_| {},
            |_| {},
        )
        .await
        .unwrap_err();
        assert_eq!(err, "boom");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancel_stops_the_engine() {
        let dir = tempfile::tempdir().unwrap();
        let bin = fake_engine(dir.path(), "sleep 30");
        let (tx, rx) = tokio::sync::watch::channel(false);
        let started = std::time::Instant::now();
        let run = run_cli(&bin, "sim", &serde_json::json!({}), &[], rx, |_| {}, |_| {});
        let cancel = async {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            tx.send(true).unwrap();
        };
        let (result, ()) = tokio::join!(run, cancel);
        assert_eq!(result.unwrap_err(), CANCELLED);
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
    }
}
