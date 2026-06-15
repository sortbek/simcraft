CREATE TABLE IF NOT EXISTS rosters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    region TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roster_members (
    id TEXT PRIMARY KEY,
    roster_id TEXT NOT NULL,
    name TEXT NOT NULL,
    realm TEXT NOT NULL,
    class TEXT NOT NULL DEFAULT '',
    spec TEXT NOT NULL DEFAULT '',
    source_simc TEXT NOT NULL DEFAULT '',
    armory_status TEXT NOT NULL DEFAULT 'pending',
    updated_at TEXT NOT NULL,
    UNIQUE(roster_id, name, realm)
);
