use sqlx::{AnyPool, Row};

#[derive(Clone)]
pub struct ComboMetadataRepo {
    pool: AnyPool,
}

#[derive(Debug, Clone)]
pub struct ComboMetadataRow {
    pub combo_id: i64,
    pub combo_name: String,
    pub combo_key: String,
    pub batch_idx: Option<i64>,
    pub cursor_json: String,
    pub profileset_simc: String,
    pub metadata_json: String,
}

#[derive(Debug, Clone)]
pub struct ComboMetadataInsert<'a> {
    pub combo_id: i64,
    pub combo_name: &'a str,
    pub combo_key: &'a str,
    pub batch_idx: Option<i64>,
    pub cursor_json: &'a str,
    pub profileset_simc: &'a str,
    pub metadata_json: &'a str,
}

const INSERT_CHUNK_SIZE: usize = 100;
const IN_CHUNK_SIZE: usize = 500;

impl ComboMetadataRepo {
    pub fn new(pool: AnyPool) -> Self {
        Self { pool }
    }

    /// Insert a batch of survivor metadata rows inside the caller's transaction.
    pub async fn insert_batch(
        &self,
        executor: &mut sqlx::AnyConnection,
        job_id: &str,
        rows: &[ComboMetadataInsert<'_>],
    ) -> Result<(), sqlx::Error> {
        for chunk in rows.chunks(INSERT_CHUNK_SIZE) {
            if chunk.is_empty() {
                continue;
            }
            let values = (0..chunk.len())
                .map(|i| {
                    let base = i * 8;
                    format!(
                        "(${}, ${}, ${}, ${}, ${}, ${}, ${}, ${})",
                        base + 1,
                        base + 2,
                        base + 3,
                        base + 4,
                        base + 5,
                        base + 6,
                        base + 7,
                        base + 8
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "INSERT INTO combo_metadata
                 (job_id, combo_id, combo_name, combo_key, batch_idx,
                  cursor_json, profileset_simc, metadata_json)
                 VALUES {}",
                values
            );
            let mut q = sqlx::query(&sql);
            for row in chunk {
                q = q
                    .bind(job_id)
                    .bind(row.combo_id)
                    .bind(row.combo_name)
                    .bind(row.combo_key)
                    .bind(row.batch_idx)
                    .bind(row.cursor_json)
                    .bind(row.profileset_simc)
                    .bind(row.metadata_json);
            }
            q.execute(&mut *executor).await?;
        }
        Ok(())
    }

    /// Query a single combo row by name. Used when result parsing needs the
    /// metadata for a specific surviving profileset.
    pub async fn get_by_name(
        &self,
        job_id: &str,
        combo_name: &str,
    ) -> Result<Option<ComboMetadataRow>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT combo_id, combo_name, combo_key, batch_idx,
                    cursor_json, profileset_simc, metadata_json
             FROM combo_metadata
             WHERE job_id = $1 AND combo_name = $2",
        )
        .bind(job_id)
        .bind(combo_name)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| ComboMetadataRow {
            combo_id: r.get("combo_id"),
            combo_name: r.get("combo_name"),
            combo_key: r.get("combo_key"),
            batch_idx: r.get("batch_idx"),
            cursor_json: r.get("cursor_json"),
            profileset_simc: r.get("profileset_simc"),
            metadata_json: r.get("metadata_json"),
        }))
    }

    /// Query all survivors for a job, ordered by combo_id. Used by:
    /// - the input preview endpoint (with LIMIT)
    /// - Phase 2 staged resume (reads profileset_simc fragments)
    pub async fn list_for_job(
        &self,
        job_id: &str,
        limit: Option<i64>,
    ) -> Result<Vec<ComboMetadataRow>, sqlx::Error> {
        let rows = if let Some(n) = limit {
            sqlx::query(
                "SELECT combo_id, combo_name, combo_key, batch_idx,
                        cursor_json, profileset_simc, metadata_json
                 FROM combo_metadata
                 WHERE job_id = $1
                 ORDER BY combo_id
                 LIMIT $2",
            )
            .bind(job_id)
            .bind(n)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(
                "SELECT combo_id, combo_name, combo_key, batch_idx,
                        cursor_json, profileset_simc, metadata_json
                 FROM combo_metadata
                 WHERE job_id = $1
                 ORDER BY combo_id",
            )
            .bind(job_id)
            .fetch_all(&self.pool)
            .await?
        };

        Ok(rows
            .into_iter()
            .map(|r| ComboMetadataRow {
                combo_id: r.get("combo_id"),
                combo_name: r.get("combo_name"),
                combo_key: r.get("combo_key"),
                batch_idx: r.get("batch_idx"),
                cursor_json: r.get("cursor_json"),
                profileset_simc: r.get("profileset_simc"),
                metadata_json: r.get("metadata_json"),
            })
            .collect())
    }

    /// Query specific survivor rows by combo_id, ordered by combo_id. Used by
    /// streamed handoff/resume to avoid loading every survivor profileset when
    /// staged pruning has already reduced the active set.
    pub async fn list_for_combo_ids(
        &self,
        job_id: &str,
        combo_ids: &[i64],
    ) -> Result<Vec<ComboMetadataRow>, sqlx::Error> {
        let mut out = Vec::new();
        for chunk in combo_ids.chunks(IN_CHUNK_SIZE) {
            if chunk.is_empty() {
                continue;
            }
            let placeholders: Vec<String> =
                (0..chunk.len()).map(|i| format!("${}", i + 2)).collect();
            let sql = format!(
                "SELECT combo_id, combo_name, combo_key, batch_idx,
                        cursor_json, profileset_simc, metadata_json
                 FROM combo_metadata
                 WHERE job_id = $1 AND combo_id IN ({})
                 ORDER BY combo_id",
                placeholders.join(",")
            );
            let mut q = sqlx::query(&sql).bind(job_id);
            for id in chunk {
                q = q.bind(*id);
            }
            let rows = q.fetch_all(&self.pool).await?;
            out.extend(rows.into_iter().map(|r| ComboMetadataRow {
                combo_id: r.get("combo_id"),
                combo_name: r.get("combo_name"),
                combo_key: r.get("combo_key"),
                batch_idx: r.get("batch_idx"),
                cursor_json: r.get("cursor_json"),
                profileset_simc: r.get("profileset_simc"),
                metadata_json: r.get("metadata_json"),
            }));
        }
        out.sort_by_key(|r| r.combo_id);
        Ok(out)
    }

    /// Fetch only combo_ids for a job — used by resume_triage to seed
    /// `already_collected_survivors` without loading profileset_simc payloads.
    pub async fn list_combo_ids_for_job(&self, job_id: &str) -> Result<Vec<i64>, sqlx::Error> {
        let rows =
            sqlx::query("SELECT combo_id FROM combo_metadata WHERE job_id = $1 ORDER BY combo_id")
                .bind(job_id)
                .fetch_all(&self.pool)
                .await?;
        Ok(rows.into_iter().map(|r| r.get("combo_id")).collect())
    }

    pub async fn count_for_job(&self, job_id: &str) -> Result<i64, sqlx::Error> {
        let row = sqlx::query("SELECT COUNT(*) AS n FROM combo_metadata WHERE job_id = $1")
            .bind(job_id)
            .fetch_one(&self.pool)
            .await?;
        Ok(row.get::<i64, _>("n"))
    }

    pub async fn delete_for_job(&self, job_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM combo_metadata WHERE job_id = $1")
            .bind(job_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
