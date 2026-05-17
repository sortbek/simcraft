-- Tie dedup keys to the triage batch that wrote them. This lets resume
-- cleanly replay a committed-but-not-completed batch instead of skipping it.
ALTER TABLE combo_dedup ADD COLUMN batch_idx BIGINT;
CREATE INDEX IF NOT EXISTS combo_dedup_job_batch_idx ON combo_dedup (job_id, batch_idx);
