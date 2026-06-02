-- Generic local stage execution tables. These supersede triage_batches for
-- local Top Gear's unified streamed-stage pipeline while keeping combo_metadata
-- as the canonical profileset metadata store.

CREATE TABLE IF NOT EXISTS stage_batches (
    job_id TEXT NOT NULL,
    stage_idx BIGINT NOT NULL,
    batch_idx BIGINT NOT NULL,
    source_kind TEXT NOT NULL,
    start_cursor_json TEXT,
    end_cursor_json TEXT,
    candidate_count BIGINT,
    accepted_count BIGINT,
    local_survivor_count BIGINT,
    status TEXT NOT NULL,
    PRIMARY KEY (job_id, stage_idx, batch_idx)
);

CREATE INDEX IF NOT EXISTS stage_batches_job_status_idx
    ON stage_batches (job_id, status);

CREATE TABLE IF NOT EXISTS stage_results (
    job_id TEXT NOT NULL,
    stage_idx BIGINT NOT NULL,
    combo_id BIGINT NOT NULL,
    combo_name TEXT NOT NULL,
    combo_key TEXT NOT NULL,
    mean DOUBLE PRECISION NOT NULL,
    mean_error DOUBLE PRECISION NOT NULL,
    result_json TEXT,
    PRIMARY KEY (job_id, stage_idx, combo_id)
);

CREATE INDEX IF NOT EXISTS stage_results_job_stage_idx
    ON stage_results (job_id, stage_idx);

CREATE INDEX IF NOT EXISTS stage_results_job_combo_idx
    ON stage_results (job_id, combo_id);
