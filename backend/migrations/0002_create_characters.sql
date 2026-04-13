CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    realm TEXT NOT NULL,
    class TEXT NOT NULL,
    spec TEXT NOT NULL,
    simc_input TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(name, realm)
);

CREATE TABLE IF NOT EXISTS talent_builds (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    spec TEXT NOT NULL,
    name TEXT NOT NULL,
    talent_string TEXT NOT NULL,
    UNIQUE(character_id, talent_string)
);
