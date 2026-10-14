-- game: 'retail' (SimC) or 'forever' (WoW Forever engine).
ALTER TABLE jobs ADD COLUMN game TEXT NOT NULL DEFAULT 'retail';
