use sqlx::{AnyPool, Row};

#[derive(Clone)]
pub struct StageResultsRepo {
    pool: AnyPool,
}

#[derive(Debug, Clone)]
pub struct StageResultRow {
    pub stage_idx: i64,
    pub combo_id: i64,
    pub combo_name: String,
    pub combo_key: String,
    pub mean: f64,
    pub mean_error: f64,
    pub result_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StageResultInsert<'a> {
    pub stage_idx: i64,
    pub combo_id: i64,
    pub combo_name: &'a str,
    pub combo_key: &'a str,
    pub mean: f64,
    pub mean_error: f64,
    pub result_json: Option<&'a str>,
}

const INSERT_CHUNK_SIZE: usize = 100;

impl StageResultsRepo {
    pub fn new(pool: AnyPool) -> Self {
        Self { pool }
    }

    pub async fn insert_batch(
        &self,
        executor: &mut sqlx::AnyConnection,
        job_id: &str,
        rows: &[StageResultInsert<'_>],
    ) -> Result<(), sqlx::Error> {
        for chunk in rows.chunks(INSERT_CHUNK_SIZE) {
            if chunk.is_empty() {
                continue;
            }
            let values = crate::db::values_placeholders(chunk.len(), 8);
            let sql = format!(
                "INSERT INTO stage_results
                 (job_id, stage_idx, combo_id, combo_name, combo_key,
                  mean, mean_error, result_json)
                 VALUES {}
                 ON CONFLICT (job_id, stage_idx, combo_id) DO UPDATE SET
                    combo_name = excluded.combo_name,
                    combo_key = excluded.combo_key,
                    mean = excluded.mean,
                    mean_error = excluded.mean_error,
                    result_json = excluded.result_json",
                values
            );
            let mut q = sqlx::query(&sql);
            for row in chunk {
                q = q
                    .bind(job_id)
                    .bind(row.stage_idx)
                    .bind(row.combo_id)
                    .bind(row.combo_name)
                    .bind(row.combo_key)
                    .bind(row.mean)
                    .bind(row.mean_error)
                    .bind(row.result_json);
            }
            q.execute(&mut *executor).await?;
        }
        Ok(())
    }

    pub async fn list_for_stage(
        &self,
        job_id: &str,
        stage_idx: i64,
    ) -> Result<Vec<StageResultRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT stage_idx, combo_id, combo_name, combo_key, mean,
                    mean_error, result_json
             FROM stage_results
             WHERE job_id = $1 AND stage_idx = $2
             ORDER BY combo_id",
        )
        .bind(job_id)
        .bind(stage_idx)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(row_from_sql).collect())
    }

    pub async fn latest_for_job(&self, job_id: &str) -> Result<Vec<StageResultRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT sr.stage_idx, sr.combo_id, sr.combo_name, sr.combo_key,
                    sr.mean, sr.mean_error, sr.result_json
             FROM stage_results sr
             INNER JOIN (
                SELECT combo_id, MAX(stage_idx) AS max_stage
                FROM stage_results
                WHERE job_id = $1
                GROUP BY combo_id
             ) latest
                ON latest.combo_id = sr.combo_id
               AND latest.max_stage = sr.stage_idx
             WHERE sr.job_id = $1
             ORDER BY sr.combo_id",
        )
        .bind(job_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(row_from_sql).collect())
    }

    pub async fn delete_for_job(&self, job_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM stage_results WHERE job_id = $1")
            .bind(job_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

fn row_from_sql(r: sqlx::any::AnyRow) -> StageResultRow {
    StageResultRow {
        stage_idx: r.get("stage_idx"),
        combo_id: r.get("combo_id"),
        combo_name: r.get("combo_name"),
        combo_key: r.get("combo_key"),
        mean: r.get("mean"),
        mean_error: r.get("mean_error"),
        result_json: r.get("result_json"),
    }
}
