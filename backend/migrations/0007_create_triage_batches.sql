-- Per-batch state for the streaming Triage path. The crash-recovery oracle:
-- rows with status='committed' but no 'completed' transition need replay.
CREATE TABLE IF NOT EXISTS triage_batches (
    job_id              TEXT    NOT NULL,
    batch_idx           BIGINT  NOT NULL,
    start_cursor_json   TEXT    NOT NULL,
    end_cursor_json     TEXT,
    candidate_count     INTEGER,
    accepted_count      INTEGER,
    survivors_count     INTEGER,
    status              TEXT    NOT NULL,
    PRIMARY KEY (job_id, batch_idx)
);
CREATE INDEX IF NOT EXISTS triage_batches_job_status_idx ON triage_batches (job_id, status);
