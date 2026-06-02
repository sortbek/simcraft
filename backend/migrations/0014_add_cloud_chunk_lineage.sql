-- Lineage + combo-name range for cloud chunks, so resume can prove which combos
-- a chunk covers and whether a failed retry-parent is fully superseded.
-- ADD COLUMN is nullable so it is safe on existing rows; both SQLite and Postgres
-- support ALTER TABLE ADD COLUMN.
ALTER TABLE cloud_chunks ADD COLUMN parent_chunk_idx BIGINT;        -- NULL = generated chunk; else the retry parent's chunk_idx
ALTER TABLE cloud_chunks ADD COLUMN first_combo_name_idx BIGINT;    -- first `Combo N` index this chunk covers (NULL = legacy row)
