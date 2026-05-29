use sqlx::{AnyPool, Row};

#[derive(Clone)]
pub struct TriageBatchesRepo {
    pool: AnyPool,
}

#[derive(Debug, Clone)]
pub struct TriageBatchRow {
    pub batch_idx: i64,
    pub start_cursor_json: String,
    pub end_cursor_json: Option<String>,
    pub candidate_count: Option<i64>,
    pub accepted_count: Option<i64>,
    pub survivors_count: Option<i64>,
    pub status: String,
}

impl TriageBatchesRepo {
    pub fn new(pool: AnyPool) -> Self {
        Self { pool }
    }

    /// Insert a 'committed' batch row at the start of the pre-simc phase.
    /// Caller passes the same executor used for the dedup inserts so this
    /// is atomic with them.
    #[allow(clippy::too_many_arguments)]
    pub async fn insert_committed(
        &self,
        executor: &mut sqlx::AnyConnection,
        job_id: &str,
        batch_idx: i64,
        start_cursor_json: &str,
        end_cursor_json: &str,
        candidate_count: i64,
        accepted_count: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO triage_batches
             (job_id, batch_idx, start_cursor_json, end_cursor_json,
              candidate_count, accepted_count, survivors_count, status)
             VALUES ($1, $2, $3, $4, $5, $6, NULL, 'committed')",
        )
        .bind(job_id)
        .bind(batch_idx)
        .bind(start_cursor_json)
        .bind(end_cursor_json)
        .bind(candidate_count)
        .bind(accepted_count)
        .execute(&mut *executor)
        .await?;
        Ok(())
    }

    /// Mark a batch as completed after simc + survivor metadata write.
    pub async fn mark_completed(
        &self,
        executor: &mut sqlx::AnyConnection,
        job_id: &str,
        batch_idx: i64,
        survivors_count: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE triage_batches
             SET survivors_count = $1, status = 'completed'
             WHERE job_id = $2 AND batch_idx = $3",
        )
        .bind(survivors_count)
        .bind(job_id)
        .bind(batch_idx)
        .execute(&mut *executor)
        .await?;
        Ok(())
    }

    /// Used on crash recovery: any committed-but-not-completed batch needs replay.
    pub async fn committed_pending(
        &self,
        job_id: &str,
    ) -> Result<Vec<TriageBatchRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT batch_idx, start_cursor_json, end_cursor_json,
                    candidate_count, accepted_count, survivors_count, status
             FROM triage_batches
             WHERE job_id = $1 AND status = 'committed'
             ORDER BY batch_idx",
        )
        .bind(job_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| TriageBatchRow {
                batch_idx: r.get("batch_idx"),
                start_cursor_json: r.get("start_cursor_json"),
                end_cursor_json: r.get("end_cursor_json"),
                candidate_count: r.get("candidate_count"),
                accepted_count: r.get("accepted_count"),
                survivors_count: r.get("survivors_count"),
                status: r.get("status"),
            })
            .collect())
    }

    pub async fn delete_for_job(&self, job_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM triage_batches WHERE job_id = $1")
            .bind(job_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
