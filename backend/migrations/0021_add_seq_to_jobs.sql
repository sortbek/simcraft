-- Monotonic insertion counter for the jobs GC. created_at can't order rows
-- reliably: a wrong client clock stamps rows far in the future, which made the
-- GC delete freshly inserted jobs. seq is GC-internal — never selected or
-- exposed. Existing rows are backfilled by created_at rank.
ALTER TABLE jobs ADD COLUMN seq BIGINT NOT NULL DEFAULT 0;

UPDATE jobs SET seq = (SELECT COUNT(*) FROM jobs j2 WHERE j2.created_at <= jobs.created_at);
