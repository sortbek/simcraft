use serde::{Deserialize, Serialize};
use sqlx::{AnyPool, Row};

#[derive(Clone)]
pub struct CloudChunksRepo {
    pool: AnyPool,
}

/// The explicit envelope stored in `cloud_chunks.results_json` for a completed
/// chunk. `profilesets` is this chunk's adapted `sim.profilesets.results`
/// array; `base_player` is the base-actor `sim.players[0]` ONLY for chunk 0
/// (`None` otherwise). One column, one schema, no positional ambiguity — lets
/// resume merge a finished chunk without re-billing it.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChunkResultEnvelope {
    pub profilesets: Vec<serde_json::Value>,
    #[serde(default)]
    pub base_player: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct CloudChunkRow {
    pub chunk_idx: i64,
    pub remote_job_id: Option<String>,
    pub status: String,
    pub profileset_count: i64,
    pub results_json: Option<String>,
    pub submitted_at: Option<String>,
    pub completed_at: Option<String>,
}

impl CloudChunksRepo {
    pub fn new(pool: AnyPool) -> Self {
        Self { pool }
    }

    /// Insert a `pending` chunk row at generation time, before submission.
    pub async fn insert_pending(
        &self,
        job_id: &str,
        chunk_idx: i64,
        profileset_count: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO cloud_chunks
             (job_id, chunk_idx, remote_job_id, status, profileset_count,
              results_json, submitted_at, completed_at)
             VALUES ($1, $2, NULL, 'pending', $3, NULL, NULL, NULL)",
        )
        .bind(job_id)
        .bind(chunk_idx)
        .bind(profileset_count)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Record the Simmit remote job id + flip to `submitted` (sets submitted_at).
    pub async fn mark_submitted(
        &self,
        job_id: &str,
        chunk_idx: i64,
        remote_job_id: &str,
        submitted_at: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE cloud_chunks
             SET remote_job_id = $1, status = 'submitted', submitted_at = $2
             WHERE job_id = $3 AND chunk_idx = $4",
        )
        .bind(remote_job_id)
        .bind(submitted_at)
        .bind(job_id)
        .bind(chunk_idx)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Store the result envelope + flip to `completed` (sets completed_at).
    pub async fn mark_completed(
        &self,
        job_id: &str,
        chunk_idx: i64,
        envelope: &ChunkResultEnvelope,
        completed_at: &str,
    ) -> Result<(), sqlx::Error> {
        let json = serde_json::to_string(envelope).unwrap_or_else(|_| "{}".to_string());
        sqlx::query(
            "UPDATE cloud_chunks
             SET results_json = $1, status = 'completed', completed_at = $2
             WHERE job_id = $3 AND chunk_idx = $4",
        )
        .bind(json)
        .bind(completed_at)
        .bind(job_id)
        .bind(chunk_idx)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Flip to `failed` (resume treats failed as terminal-error for the job).
    pub async fn mark_failed(&self, job_id: &str, chunk_idx: i64) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE cloud_chunks SET status = 'failed' WHERE job_id = $1 AND chunk_idx = $2",
        )
        .bind(job_id)
        .bind(chunk_idx)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Reset a lost/expired chunk back to `pending` so it is regenerated +
    /// resubmitted on resume.
    pub async fn reset_to_pending(&self, job_id: &str, chunk_idx: i64) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE cloud_chunks
             SET status = 'pending', remote_job_id = NULL, submitted_at = NULL
             WHERE job_id = $1 AND chunk_idx = $2",
        )
        .bind(job_id)
        .bind(chunk_idx)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// All chunks for a job, ordered by chunk_idx. Resume's source of truth.
    pub async fn list_for_job(&self, job_id: &str) -> Result<Vec<CloudChunkRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT chunk_idx, remote_job_id, status, profileset_count,
                    results_json, submitted_at, completed_at
             FROM cloud_chunks
             WHERE job_id = $1
             ORDER BY chunk_idx",
        )
        .bind(job_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| CloudChunkRow {
                chunk_idx: r.get("chunk_idx"),
                remote_job_id: r.get("remote_job_id"),
                status: r.get("status"),
                profileset_count: r.get("profileset_count"),
                results_json: r.get("results_json"),
                submitted_at: r.get("submitted_at"),
                completed_at: r.get("completed_at"),
            })
            .collect())
    }

    pub async fn delete_for_job(&self, job_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM cloud_chunks WHERE job_id = $1")
            .bind(job_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> AnyPool {
        sqlx::any::install_default_drivers();
        crate::db::Database::connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite")
            .pool
    }

    #[tokio::test]
    async fn insert_submit_complete_roundtrip() {
        let repo = CloudChunksRepo::new(pool().await);
        repo.insert_pending("job-1", 0, 500).await.unwrap();
        repo.insert_pending("job-1", 1, 250).await.unwrap();

        repo.mark_submitted("job-1", 0, "remote-abc", "2026-05-30T00:00:00Z")
            .await
            .unwrap();
        let env = ChunkResultEnvelope {
            profilesets: vec![serde_json::json!({"name": "Combo 1", "mean": 100.0})],
            base_player: Some(serde_json::json!({"name": "Base"})),
        };
        repo.mark_completed("job-1", 0, &env, "2026-05-30T00:01:00Z")
            .await
            .unwrap();

        let rows = repo.list_for_job("job-1").await.unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].chunk_idx, 0);
        assert_eq!(rows[0].status, "completed");
        assert_eq!(rows[0].remote_job_id.as_deref(), Some("remote-abc"));
        let decoded: ChunkResultEnvelope =
            serde_json::from_str(rows[0].results_json.as_ref().unwrap()).unwrap();
        assert_eq!(decoded.profilesets.len(), 1);
        assert!(decoded.base_player.is_some());
        assert_eq!(rows[1].status, "pending");
    }

    #[tokio::test]
    async fn reset_to_pending_clears_remote_id() {
        let repo = CloudChunksRepo::new(pool().await);
        repo.insert_pending("job-2", 0, 10).await.unwrap();
        repo.mark_submitted("job-2", 0, "lost", "2026-05-30T00:00:00Z")
            .await
            .unwrap();
        repo.reset_to_pending("job-2", 0).await.unwrap();
        let rows = repo.list_for_job("job-2").await.unwrap();
        assert_eq!(rows[0].status, "pending");
        assert!(rows[0].remote_job_id.is_none());
    }
}
