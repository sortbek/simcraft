CREATE TABLE IF NOT EXISTS roster_runs (
    id TEXT PRIMARY KEY,
    roster_id TEXT NOT NULL,
    instance_id INTEGER NOT NULL,
    difficulty TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    report_json TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roster_run_jobs (
    run_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    PRIMARY KEY (run_id, member_id)
);
