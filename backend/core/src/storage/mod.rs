pub mod memory;
#[cfg(feature = "postgres")]
pub mod postgres;
pub mod sqlite;

use crate::models::{Job, JobStatus, JobSummary};
use std::sync::atomic::{AtomicUsize, Ordering};

pub static MAX_JOBS: AtomicUsize = AtomicUsize::new(200);
pub static MAX_SCENARIOS: AtomicUsize = AtomicUsize::new(10);
pub static MAX_COMBINATIONS: AtomicUsize = AtomicUsize::new(0);

/// Initialize limits from environment variables. Call once at startup.
pub fn init_limits() {
    let max_jobs = std::env::var("MAX_JOBS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(if cfg!(feature = "desktop") { 50 } else { 200 });
    let max_scenarios = std::env::var("MAX_SCENARIOS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);
    let max_combos = std::env::var("MAX_COMBINATIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    MAX_JOBS.store(max_jobs, Ordering::Relaxed);
    MAX_SCENARIOS.store(max_scenarios, Ordering::Relaxed);
    MAX_COMBINATIONS.store(max_combos, Ordering::Relaxed);
}

/// Trait for job persistence — implemented by in-memory store (desktop) and SQLite (web).
pub trait JobStorage: Send + Sync {
    fn insert(&self, job: Job);
    fn get(&self, id: &str) -> Option<Job>;
    fn list_recent(
        &self,
        limit: usize,
        player: Option<&str>,
        realm: Option<&str>,
    ) -> Vec<JobSummary>;
    fn update_status(&self, id: &str, status: JobStatus);
    fn update_progress(&self, id: &str, pct: u8, stage: &str, detail: &str);
    fn complete_stage(&self, id: &str, summary: &str);
    fn set_result(&self, id: &str, result: String, raw_json: Option<String>);
    fn set_error(&self, id: &str, error: String);
    fn set_report_files(&self, id: &str, html: Option<String>, text: Option<String>);
    fn count_batch(&self, batch_id: &str) -> usize;
}
