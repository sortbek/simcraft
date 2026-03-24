pub mod memory;
#[cfg(feature = "web")]
pub mod sqlite;
#[cfg(feature = "postgres")]
pub mod postgres;

use once_cell::sync::Lazy;
use crate::models::{Job, JobStatus, JobSummary};

/// Maximum number of jobs to retain. Oldest jobs are deleted on insert.
/// Override with MAX_JOBS env var. Defaults: desktop=50, web=200.
pub static MAX_JOBS: Lazy<usize> = Lazy::new(|| {
    if let Ok(val) = std::env::var("MAX_JOBS") {
        if let Ok(n) = val.parse() { return n; }
    }
    if cfg!(feature = "desktop") { 50 } else { 200 }
});

/// Trait for job persistence — implemented by in-memory store (desktop) and SQLite (web).
pub trait JobStorage: Send + Sync {
    fn insert(&self, job: Job);
    fn get(&self, id: &str) -> Option<Job>;
    fn list_recent(&self, limit: usize, player: Option<&str>, realm: Option<&str>) -> Vec<JobSummary>;
    fn update_status(&self, id: &str, status: JobStatus);
    fn update_progress(&self, id: &str, pct: u8, stage: &str, detail: &str);
    fn complete_stage(&self, id: &str, summary: &str);
    fn set_result(&self, id: &str, result: String, raw_json: Option<String>);
    fn set_error(&self, id: &str, error: String);
    fn set_report_files(&self, id: &str, html: Option<String>, text: Option<String>);
}
