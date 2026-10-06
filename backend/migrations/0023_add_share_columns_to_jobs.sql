-- client_request: the original POST body, so a shared result can be re-run.
-- share_*: set while the result is shared on simhammer.com. rerun_of: share id this job re-runs.
ALTER TABLE jobs ADD COLUMN client_request     TEXT;
ALTER TABLE jobs ADD COLUMN share_id           TEXT;
ALTER TABLE jobs ADD COLUMN share_delete_token TEXT;
ALTER TABLE jobs ADD COLUMN rerun_of           TEXT;
