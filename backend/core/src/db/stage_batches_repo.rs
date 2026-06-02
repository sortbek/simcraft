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

#[derive(Debug, Clone, Default)]
pub struct StageTotals {
    pub batch_count: i64,
    pub candidate_total: i64,
    pub accepted_total: i64,
    pub local_survivor_total: i64,
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

    /// Highest `batch_idx` with status='completed' for a stage, or None.
    pub async fn max_completed_batch_idx(
        &self,
        job_id: &str,
        stage_idx: i64,
    ) -> Result<Option<i64>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT MAX(batch_idx) AS m FROM stage_batches
             WHERE job_id = $1 AND stage_idx = $2 AND status = 'completed'",
        )
        .bind(job_id)
        .bind(stage_idx)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.try_get::<i64, _>("m").ok())
    }

    /// Aggregate counts over a stage's COMPLETED batches (DB-derived summary).
    pub async fn stage_totals(
        &self,
        job_id: &str,
        stage_idx: i64,
    ) -> Result<StageTotals, sqlx::Error> {
        let row = sqlx::query(
            "SELECT COUNT(*) AS bc,
                    COALESCE(SUM(candidate_count), 0) AS cc,
                    COALESCE(SUM(accepted_count), 0) AS ac,
                    COALESCE(SUM(local_survivor_count), 0) AS lsc
             FROM stage_batches
             WHERE job_id = $1 AND stage_idx = $2 AND status = 'completed'",
        )
        .bind(job_id)
        .bind(stage_idx)
        .fetch_one(&self.pool)
        .await?;
        Ok(StageTotals {
            batch_count: row.get("bc"),
            candidate_total: row.get("cc"),
            accepted_total: row.get("ac"),
            local_survivor_total: row.get("lsc"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> sqlx::AnyPool {
        sqlx::any::install_default_drivers();
        crate::db::Database::connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite")
            .pool
    }

    #[tokio::test]
    async fn resume_cleanup_removes_only_pending_rows() {
        use crate::db::ComboDedupRepo;
        let pool = pool().await;
        let batches = StageBatchesRepo::new(pool.clone());
        let dedup = ComboDedupRepo::new(pool.clone());

        // completed batch 0 (keys K0) + committed-pending batch 1 (keys K1)
        let mut tx = pool.begin().await.unwrap();
        dedup.insert_chunked(&mut tx, "job", 0, &["K0a".into(), "K0b".into()]).await.unwrap();
        batches.insert_committed(&mut tx, "job", 0, 0, "generated", Some("[0]"), Some("[1]"), 2, 2).await.unwrap();
        dedup.insert_chunked(&mut tx, "job", 1, &["K1a".into()]).await.unwrap();
        batches.insert_committed(&mut tx, "job", 0, 1, "generated", Some("[1]"), Some("[2]"), 1, 1).await.unwrap();
        tx.commit().await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        batches.mark_completed(&mut tx, "job", 0, 0, 2).await.unwrap();
        tx.commit().await.unwrap();

        // simulate resume cleanup of batch 1
        dedup.delete_for_batch("job", 1).await.unwrap();
        sqlx::query("DELETE FROM stage_batches WHERE job_id='job' AND stage_idx=0 AND batch_idx=1")
            .execute(&pool).await.unwrap();

        // batch 0's keys survive; pending row gone
        let mut tx = pool.begin().await.unwrap();
        let survived = dedup.snapshot_existing(&mut tx, "job", &["K0a".into(), "K1a".into()]).await.unwrap();
        tx.commit().await.unwrap();
        assert!(survived.contains("K0a"));
        assert!(!survived.contains("K1a"));
        assert_eq!(batches.committed_pending("job").await.unwrap().len(), 0);
        assert_eq!(batches.max_completed_batch_idx("job", 0).await.unwrap(), Some(0));
    }

    #[tokio::test]
    async fn max_completed_and_totals_ignore_committed_rows() {
        let pool = pool().await;
        let repo = StageBatchesRepo::new(pool.clone());
        let mut tx = pool.begin().await.unwrap();
        // completed batch 0: 100 candidates, 80 accepted, 30 survivors
        repo.insert_committed(&mut tx, "job", 0, 0, "generated", Some("[0]"), Some("[1]"), 100, 80).await.unwrap();
        // committed-pending batch 1: 50 candidates, 40 accepted
        repo.insert_committed(&mut tx, "job", 0, 1, "generated", Some("[1]"), Some("[2]"), 50, 40).await.unwrap();
        tx.commit().await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        repo.mark_completed(&mut tx, "job", 0, 0, 30).await.unwrap();
        tx.commit().await.unwrap();

        assert_eq!(repo.max_completed_batch_idx("job", 0).await.unwrap(), Some(0));
        let totals = repo.stage_totals("job", 0).await.unwrap();
        assert_eq!(totals.batch_count, 1);          // only completed
        assert_eq!(totals.accepted_total, 80);
        assert_eq!(totals.local_survivor_total, 30);
    }
}
