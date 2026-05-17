-- Phase 1: streaming Triage support + Phase 2: pause/resume support.
-- pause_requested ships in Phase 1 to avoid an extra migration in Phase 2.
-- pause_requested values: 0 = false, 1 = true. Boolean semantics handled in Rust.
ALTER TABLE jobs ADD COLUMN request_json     TEXT;
ALTER TABLE jobs ADD COLUMN simc_input_mode  TEXT NOT NULL DEFAULT 'inline';
ALTER TABLE jobs ADD COLUMN checkpoint       TEXT;
ALTER TABLE jobs ADD COLUMN pause_requested  INTEGER NOT NULL DEFAULT 0;
