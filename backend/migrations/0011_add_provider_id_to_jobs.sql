-- Identifies which compute provider ran the job. Determines which capabilities
-- the result page surfaces (cancel/pause buttons) and how cancel is dispatched.
ALTER TABLE jobs ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'local';
