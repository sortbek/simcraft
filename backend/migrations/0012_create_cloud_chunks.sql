-- Per-chunk state for the cloud-streaming Top Gear path. The crash-recovery
-- oracle: rows with status='submitted' but no completed_at need re-polling on
-- resume; rows with status='completed' carry the merged-result envelope so a
-- finished chunk is never re-billed.
CREATE TABLE IF NOT EXISTS cloud_chunks (
    job_id           TEXT    NOT NULL,
    chunk_idx        BIGINT  NOT NULL,
    remote_job_id    TEXT,
    status           TEXT    NOT NULL,
    profileset_count INTEGER NOT NULL,
    results_json     TEXT,
    submitted_at     TEXT,
    completed_at     TEXT,
    PRIMARY KEY (job_id, chunk_idx)
);
CREATE INDEX IF NOT EXISTS cloud_chunks_job_id_idx ON cloud_chunks (job_id);
