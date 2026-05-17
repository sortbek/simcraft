-- Per-survivor metadata, replacing the jobs.combo_metadata_json blob.
-- batch_idx is NULL for below-threshold jobs (no Triage) and for survivors
-- emitted by the staged-pipeline stages.
CREATE TABLE IF NOT EXISTS combo_metadata (
    job_id          TEXT NOT NULL,
    combo_id        BIGINT NOT NULL,
    combo_name      TEXT NOT NULL,
    combo_key       TEXT NOT NULL,
    batch_idx       BIGINT,
    cursor_json     TEXT NOT NULL,
    profileset_simc TEXT NOT NULL,
    metadata_json   TEXT NOT NULL,
    PRIMARY KEY (job_id, combo_id)
);
CREATE INDEX IF NOT EXISTS combo_metadata_job_id_idx     ON combo_metadata (job_id);
CREATE INDEX IF NOT EXISTS combo_metadata_job_name_idx   ON combo_metadata (job_id, combo_name);
CREATE INDEX IF NOT EXISTS combo_metadata_job_batch_idx  ON combo_metadata (job_id, batch_idx);
