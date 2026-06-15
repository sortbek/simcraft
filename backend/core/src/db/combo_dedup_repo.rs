use sqlx::{AnyPool, Row};
use std::collections::HashSet;

/// Per-job dedup-key storage backing the streaming Triage path. Ops run inside
/// short transactions; callers must NOT hold a transaction across a simc
/// subprocess invocation (see the streaming design's transaction lifecycle).
#[derive(Clone)]
pub struct ComboDedupRepo {
    pool: AnyPool,
}

/// IN-clause chunk size. SQLite's SQLITE_LIMIT_VARIABLE_NUMBER is historically
/// 999, so 500 leaves margin and works on every supported version.
const IN_CHUNK_SIZE: usize = 500;
const INSERT_CHUNK_SIZE: usize = 400;

impl ComboDedupRepo {
    pub fn new(pool: AnyPool) -> Self {
        Self { pool }
    }

    /// The subset of `keys` already present for this job — the pre-INSERT
    /// snapshot, so anything not returned becomes new after INSERT ... ON CONFLICT
    /// DO NOTHING. MUST share `insert_chunked`'s transaction to be exact under
    /// concurrent jobs. Callers pass `&mut *tx` (`Transaction<'_, sqlx::Any>`).
    pub async fn snapshot_existing(
        &self,
        executor: &mut sqlx::AnyConnection,
        job_id: &str,
        keys: &[String],
    ) -> Result<HashSet<String>, sqlx::Error> {
        let mut found = HashSet::new();
        for chunk in keys.chunks(IN_CHUNK_SIZE) {
            let placeholders: Vec<String> =
                (0..chunk.len()).map(|i| format!("${}", i + 2)).collect();
            let sql = format!(
                "SELECT combo_key FROM combo_dedup \
                 WHERE job_id = $1 AND combo_key IN ({})",
                placeholders.join(",")
            );
            let mut q = sqlx::query(&sql).bind(job_id);
            for k in chunk {
                q = q.bind(k.as_str());
            }
            let rows = q.fetch_all(&mut *executor).await?;
            for r in rows {
                found.insert(r.get::<String, _>("combo_key"));
            }
        }
        Ok(found)
    }

    /// Chunked INSERT ... ON CONFLICT DO NOTHING — safe with already-existing
    /// keys (duplicates silently skipped). Callers pass `&mut *tx`.
    pub async fn insert_chunked(
        &self,
        executor: &mut sqlx::AnyConnection,
        job_id: &str,
        batch_idx: i64,
        keys: &[String],
    ) -> Result<(), sqlx::Error> {
        for chunk in keys.chunks(INSERT_CHUNK_SIZE) {
            if chunk.is_empty() {
                continue;
            }

            let values = crate::db::values_placeholders(chunk.len(), 3);
            let sql = format!(
                "INSERT INTO combo_dedup (job_id, batch_idx, combo_key) VALUES {} ON CONFLICT DO NOTHING",
                values
            );
            let mut q = sqlx::query(&sql);
            for k in chunk {
                q = q.bind(job_id).bind(batch_idx).bind(k.as_str());
            }
            q.execute(&mut *executor).await?;
        }
        Ok(())
    }

    pub async fn delete_for_batch(&self, job_id: &str, batch_idx: i64) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM combo_dedup WHERE job_id = $1 AND batch_idx = $2")
            .bind(job_id)
            .bind(batch_idx)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_for_job(&self, job_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM combo_dedup WHERE job_id = $1")
            .bind(job_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
