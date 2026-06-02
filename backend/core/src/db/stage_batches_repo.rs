use sqlx::{AnyPool, Row};

#[derive(Clone)]
pub struct StageBatchesRepo {
    pool: AnyPool,
}

#[derive(Debug, Clone)]
pub struct StageBatchRow {
    pub stage_idx: i64,
    pub batch_idx: i64,
    pub source_kind: String,
    pub start_cursor_json: Option<String>,
    pub end_cursor_json: Option<String>,
    pub candidate_count: Option<i64>,
    pub accepted_count: Option<i64>,
    pub local_survivor_count: Option<i64>,
    pub status: String,
}

impl StageBatchesRepo {
    pub fn new(pool: AnyPool) -> Self {
        Self { pool }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn insert_committed(
        &self,
        executor: &mut sqlx::AnyConnection,
        job_id: &str,
        stage_idx: i64,
        batch_idx: i64,
        source_kind: &str,
        start_cursor_json: Option<&str>,
        end_cursor_json: Option<&str>,
        candidate_count: i64,
        accepted_count: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO stage_batches
             (job_id, stage_idx, batch_idx, source_kind, start_cursor_json,
              end_cursor_json, candidate_count, accepted_count,
              local_survivor_count, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, 'committed')",
        )
        .bind(job_id)
        .bind(stage_idx)
        .bind(batch_idx)
        .bind(source_kind)
        .bind(start_cursor_json)
        .bind(end_cursor_json)
        .bind(candidate_count)
        .bind(accepted_count)
        .execute(&mut *executor)
        .await?;
        Ok(())
    }

    pub async fn mark_completed(
        &self,
        executor: &mut sqlx::AnyConnection,
        job_id: &str,
        stage_idx: i64,
        batch_idx: i64,
        local_survivor_count: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE stage_batches
             SET local_survivor_count = $1, status = 'completed'
             WHERE job_id = $2 AND stage_idx = $3 AND batch_idx = $4",
        )
        .bind(local_survivor_count)
        .bind(job_id)
        .bind(stage_idx)
        .bind(batch_idx)
        .execute(&mut *executor)
        .await?;
        Ok(())
    }

    pub async fn committed_pending(
        &self,
        job_id: &str,
    ) -> Result<Vec<StageBatchRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT stage_idx, batch_idx, source_kind, start_cursor_json,
                    end_cursor_json, candidate_count, accepted_count,
                    local_survivor_count, status
             FROM stage_batches
             WHERE job_id = $1 AND status = 'committed'
             ORDER BY stage_idx, batch_idx",
        )
        .bind(job_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| StageBatchRow {
                stage_idx: r.get("stage_idx"),
                batch_idx: r.get("batch_idx"),
                source_kind: r.get("source_kind"),
                start_cursor_json: r.get("start_cursor_json"),
                end_cursor_json: r.get("end_cursor_json"),
                candidate_count: r.get("candidate_count"),
                accepted_count: r.get("accepted_count"),
                local_survivor_count: r.get("local_survivor_count"),
                status: r.get("status"),
            })
            .collect())
    }

    pub async fn delete_for_job(&self, job_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM stage_batches WHERE job_id = $1")
            .bind(job_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
