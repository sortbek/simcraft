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
