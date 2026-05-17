-- Drop the legacy combo_metadata_json column. All current writers populate
-- the dedicated combo_metadata table in parallel, and load_combo_metadata
-- now reads exclusively from that table — see Phase 1.5 of the
-- batched-sims-and-pause-resume design doc.
--
-- Requires SQLite >= 3.35 or PostgreSQL.
ALTER TABLE jobs DROP COLUMN combo_metadata_json;
