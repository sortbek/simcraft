-- Per-job identity-key set, used by the streaming Triage path to detect
-- duplicate profileset candidates. Rows are written in the pre-simc DB
-- phase of each batch and deleted on job completion or cancellation.
CREATE TABLE IF NOT EXISTS combo_dedup (
    job_id    TEXT NOT NULL,
    combo_key TEXT NOT NULL,
    PRIMARY KEY (job_id, combo_key)
);
CREATE INDEX IF NOT EXISTS combo_dedup_job_id_idx ON combo_dedup (job_id);
