//! Combo-metadata persistence: the `combo_metadata` table holds the per-combo
//! gear deltas that the result parser folds back into a finished report. Writes
//! are best-effort — a failure is logged but never fails the job.

use serde_json::Value;
use std::collections::HashMap;

use crate::db::{ComboMetadataInsert, ComboMetadataRepo, JobRepo};

/// Write combo_metadata rows to the `combo_metadata` table.
/// This is a best-effort write — failures are logged but don't block the job.
///
/// `metadata_strs`: pre-serialized `(combo_name, metadata_json)` pairs ordered by combo_id.
pub(crate) async fn write_combo_metadata_table_raw(
    repo: &JobRepo,
    job_id: &str,
    metadata_strs: &[(String, String)],
    profileset_simc_lines: &[String],
) {
    write_combo_metadata_table_raw_offset(repo, job_id, metadata_strs, profileset_simc_lines, 0)
        .await;
}

/// As [`write_combo_metadata_table_raw`], but assigns `combo_id = base + i + 1`.
/// The cloud-streaming path writes one slice per chunk; passing the running combo
/// count as `combo_id_base` keeps combo_ids unique across chunks (PK is `(job_id, combo_id)`).
pub(crate) async fn write_combo_metadata_table_raw_offset(
    repo: &JobRepo,
    job_id: &str,
    metadata_strs: &[(String, String)],
    // Per-combo simc override lines (parallel to `metadata_strs`), persisted so
    // `sim_row` can reconstruct the row's gear. Pass `&[]` when unavailable (the
    // row then stores `""` — fine for non-streamed jobs, which never sim-row).
    profileset_simc_lines: &[String],
    combo_id_base: i64,
) {
    if metadata_strs.is_empty() {
        return;
    }
    let pool = match repo.pool() {
        Some(p) => p.clone(),
        None => return, // in-memory backend, no table to write to
    };
    let metadata_repo = ComboMetadataRepo::new(pool.clone());

    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            eprintln!(
                "[{}] combo_metadata table write: failed to begin tx: {}",
                job_id, e
            );
            return;
        }
    };
    let inserts: Vec<ComboMetadataInsert> = metadata_strs
        .iter()
        .enumerate()
        .map(|(i, (name, meta_json))| ComboMetadataInsert {
            combo_id: combo_id_base + (i as i64) + 1,
            combo_name: name.as_str(),
            combo_key: "",
            batch_idx: None,
            cursor_json: "[]",
            profileset_simc: profileset_simc_lines
                .get(i)
                .map(String::as_str)
                .unwrap_or(""),
            metadata_json: meta_json.as_str(),
        })
        .collect();
    if let Err(e) = metadata_repo.insert_batch(&mut tx, job_id, &inserts).await {
        eprintln!(
            "[{}] combo_metadata table write failed (non-fatal): {}",
            job_id, e
        );
        return;
    }
    if let Err(e) = tx.commit().await {
        eprintln!(
            "[{}] combo_metadata table write: commit failed (non-fatal): {}",
            job_id, e
        );
    }
}

// `write_combo_metadata_table`/`_value` removed — they wrapped handlers holding
// `HashMap<String, Vec<Value>>` combo_metadata (top_gear, upgrade_compare).
// Handlers now pre-serialize into `ProfilesetSubmission::combo_metadata_serialized`
// and write via the `_raw` variant.

/// Load combo_metadata for a job from the `combo_metadata` table.
/// Returns an empty map for in-memory repos or when no rows exist.
pub(crate) async fn load_combo_metadata(
    repo: &JobRepo,
    job_id: &str,
) -> HashMap<String, Vec<Value>> {
    let Some(pool) = repo.pool() else {
        return HashMap::new();
    };
    let meta_repo = ComboMetadataRepo::new(pool.clone());
    match meta_repo.list_for_job(job_id, None).await {
        Ok(rows) => rows
            .into_iter()
            .filter_map(|r| {
                let deltas: Vec<Value> = serde_json::from_str(&r.metadata_json).ok()?;
                Some((r.combo_name, deltas))
            })
            .collect(),
        Err(_) => HashMap::new(),
    }
}
