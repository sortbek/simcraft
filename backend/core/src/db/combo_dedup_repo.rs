use sqlx::{AnyPool, Row};
use std::collections::HashSet;

/// Per-job dedup-key storage backing the streaming Triage path.
/// Operations are designed to run inside short transactions; callers
/// must NOT hold a transaction across simc subprocess invocation
/// (see the transaction lifecycle notes in the streaming design).
#[derive(Clone)]
pub struct ComboDedupRepo {
    pool: AnyPool,
}

/// Conservative chunk size for IN-clauses. SQLite's
/// SQLITE_LIMIT_VARIABLE_NUMBER is historically 999, so 500 leaves
/// margin and works on every supported version.
const IN_CHUNK_SIZE: usize = 500;
const INSERT_CHUNK_SIZE: usize = 400;

impl ComboDedupRepo {
    pub fn new(pool: AnyPool) -> Self {
        Self { pool }
    }

    /// Return the subset of `keys` that already exist for this job.
    /// Used as the pre-INSERT snapshot — anything not returned here
    /// will be a new key after INSERT ... ON CONFLICT DO NOTHING.
    ///
    /// MUST be called inside the same transaction as `insert_chunked`
    /// to be exact under concurrent jobs. Callers pass `&mut *tx`
    /// where `tx: sqlx::Transaction<'_, sqlx::Any>`.
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

    /// Chunked INSERT ... ON CONFLICT DO NOTHING. Safe to call with
    /// keys that may already exist; duplicates are silently skipped.
    ///
    /// Callers pass `&mut *tx` where `tx: sqlx::Transaction<'_, sqlx::Any>`.
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

            let values = (0..chunk.len())
                .map(|i| {
                    let base = i * 3;
                    format!("(${}, ${}, ${})", base + 1, base + 2, base + 3)
                })
                .collect::<Vec<_>>()
                .join(",");
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
