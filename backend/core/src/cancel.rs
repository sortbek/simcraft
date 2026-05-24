//! Cooperative cancellation for staged sim jobs.
//!
//! A `CancelToken` lets long-running tasks check whether their job has been
//! cancelled, without holding a strong reference to anything async-runtime
//! specific. The token reads the DB-backed status (the source of truth) so
//! cancellation works across stage boundaries even when no simc subprocess
//! is currently registered in `RUNNING_PROCESSES`.

use crate::db::JobRepo;
use crate::models::JobStatus;

#[derive(Clone)]
pub struct CancelToken {
    repo: JobRepo,
    job_id: String,
}

impl CancelToken {
    pub fn new(repo: JobRepo, job_id: impl Into<String>) -> Self {
        Self {
            repo,
            job_id: job_id.into(),
        }
    }

    /// True if the job has been cancelled. Errors are treated as "not cancelled"
    /// so a transient DB hiccup never falsely aborts execution.
    pub async fn is_cancelled(&self) -> bool {
        // `get` reads the full row; that's fine for a once-per-stage check.
        // If this ever becomes hot enough to matter we can add a slim
        // `get_status_summary` back; today the staged loop is the only caller
        // and per-stage cost is dwarfed by the simc subprocess.
        match self.repo.get(&self.job_id).await {
            Ok(Some(j)) => j.status == JobStatus::Cancelled,
            _ => false,
        }
    }

    pub fn job_id(&self) -> &str {
        &self.job_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Job;

    #[tokio::test]
    async fn fresh_job_is_not_cancelled() {
        let repo = JobRepo::new_memory();
        let job = Job::new("".into(), "quick".into(), 100, "Patchwerk".into(), 0.1);
        let id = job.id.clone();
        repo.insert(&job).await.unwrap();
        let token = CancelToken::new(repo, id);
        assert!(!token.is_cancelled().await);
    }

    #[tokio::test]
    async fn cancelled_job_reports_cancelled() {
        let repo = JobRepo::new_memory();
        let job = Job::new("".into(), "quick".into(), 100, "Patchwerk".into(), 0.1);
        let id = job.id.clone();
        repo.insert(&job).await.unwrap();
        repo.update_status(&id, JobStatus::Cancelled).await.unwrap();
        let token = CancelToken::new(repo, id);
        assert!(token.is_cancelled().await);
    }

    #[tokio::test]
    async fn unknown_job_id_reports_not_cancelled() {
        // Treat missing jobs as not-cancelled rather than panicking — keeps
        // race-with-deletion benign.
        let repo = JobRepo::new_memory();
        let token = CancelToken::new(repo, "does-not-exist");
        assert!(!token.is_cancelled().await);
    }
}
