use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedCharacter {
    pub id: String,
    pub name: String,
    pub realm: String,
    pub class: String,
    pub spec: String,
    pub simc_input: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedTalentBuild {
    pub id: String,
    pub character_id: String,
    pub spec: String,
    pub name: String,
    pub talent_string: String,
}

#[derive(Debug, Deserialize)]
pub struct UpsertCharacterRequest {
    pub simc_input: String,
}

pub struct CharacterStore {
    conn: Mutex<Connection>,
}

impl CharacterStore {
    pub fn new(db_path: &str) -> Self {
        let conn = Connection::open(db_path).expect("Failed to open character store database");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS characters (
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
            );",
        )
        .expect("Failed to create character tables");
        Self {
            conn: Mutex::new(conn),
        }
    }

    pub fn list(&self) -> Vec<SavedCharacter> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, name, realm, class, spec, simc_input, updated_at FROM characters ORDER BY updated_at DESC")
            .unwrap();
        stmt.query_map([], |row| {
            Ok(SavedCharacter {
                id: row.get(0)?,
                name: row.get(1)?,
                realm: row.get(2)?,
                class: row.get(3)?,
                spec: row.get(4)?,
                simc_input: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }

    /// Insert or update a character based on name+realm extracted from simc_input.
    /// Also extracts and saves talent loadouts for the character's current spec.
    /// Returns None if the input can't be parsed.
    pub fn upsert(&self, simc_input: &str) -> Option<SavedCharacter> {
        let (name, realm, class, spec) = parse_simc_character(simc_input)?;
        let talent_loadouts = parse_talent_loadouts(simc_input);
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();

        // Find or create character
        let existing_id: Option<String> = conn
            .query_row(
                "SELECT id FROM characters WHERE name = ?1 AND realm = ?2",
                params![name, realm],
                |row| row.get(0),
            )
            .ok();

        let id = if let Some(existing) = existing_id {
            conn.execute(
                "UPDATE characters SET class = ?1, spec = ?2, simc_input = ?3, updated_at = ?4 WHERE id = ?5",
                params![class, spec, simc_input, now, existing],
            )
            .ok();
            existing
        } else {
            let new_id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO characters (id, name, realm, class, spec, simc_input, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![new_id, name, realm, class, spec, simc_input, now],
            )
            .ok();
            new_id
        };

        // Save talent builds for this spec (upsert by character_id + talent_string)
        for loadout in &talent_loadouts {
            let build_id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO talent_builds (id, character_id, spec, name, talent_string)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(character_id, talent_string) DO UPDATE SET name = ?4, spec = ?3",
                params![build_id, id, spec, loadout.0, loadout.1],
            )
            .ok();
        }

        Some(SavedCharacter {
            id,
            name,
            realm,
            class,
            spec,
            simc_input: simc_input.to_string(),
            updated_at: now,
        })
    }

    /// Get all talent builds for a character, across all specs.
    pub fn get_talent_builds(&self, character_id: &str) -> Vec<SavedTalentBuild> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, character_id, spec, name, talent_string
                 FROM talent_builds WHERE character_id = ?1 ORDER BY spec, name",
            )
            .unwrap();
        stmt.query_map(params![character_id], |row| {
            Ok(SavedTalentBuild {
                id: row.get(0)?,
                character_id: row.get(1)?,
                spec: row.get(2)?,
                name: row.get(3)?,
                talent_string: row.get(4)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }

    pub fn delete_talent_build(&self, id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM talent_builds WHERE id = ?1", params![id])
            .unwrap_or(0)
            > 0
    }

    pub fn delete(&self, id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM talent_builds WHERE character_id = ?1", params![id])
            .ok();
        conn.execute("DELETE FROM characters WHERE id = ?1", params![id])
            .unwrap_or(0)
            > 0
    }
}

/// Extract character name, realm, class, and spec from SimC addon input.
fn parse_simc_character(input: &str) -> Option<(String, String, String, String)> {
    let mut name = None;
    let mut realm = None;
    let mut class = None;
    let mut spec = None;

    for line in input.lines() {
        let trimmed = line.trim();
        if name.is_none() {
            if let Some((cls, n)) = parse_class_line(trimmed) {
                class = Some(cls);
                name = Some(n);
            }
        }
        if let Some(val) = trimmed.strip_prefix("server=") {
            realm = Some(val.to_string());
        }
        if let Some(val) = trimmed.strip_prefix("spec=") {
            spec = Some(val.to_string());
        }
    }

    Some((
        name?,
        realm.unwrap_or_else(|| "Unknown".to_string()),
        class?,
        spec.unwrap_or_else(|| "unknown".to_string()),
    ))
}

/// Extract talent loadout names and strings from SimC input.
/// Returns Vec of (name, talent_string).
fn parse_talent_loadouts(input: &str) -> Vec<(String, String)> {
    let mut loadouts = Vec::new();
    let mut last_comment_name: Option<String> = None;
    let mut counter = 1;

    for line in input.lines() {
        let trimmed = line.trim();

        if let Some(comment) = trimmed.strip_prefix('#') {
            let comment = comment.trim();
            // Check for commented-out talent line: # talents=...
            if let Some(ts) = comment.strip_prefix("talents=") {
                let name = last_comment_name
                    .take()
                    .unwrap_or_else(|| format!("Loadout {}", counter));
                counter += 1;
                loadouts.push((name, ts.to_string()));
            } else if !comment.is_empty() {
                // Potential loadout name — clean it up (strip trailing numbers in parens)
                let clean = comment
                    .trim_end_matches(|c: char| c.is_ascii_digit() || c == '(' || c == ')' || c == ' ')
                    .trim()
                    .to_string();
                if !clean.is_empty() {
                    last_comment_name = Some(clean);
                }
            }
        } else if let Some(ts) = trimmed.strip_prefix("talents=") {
            let name = last_comment_name
                .take()
                .unwrap_or_else(|| "Active".to_string());
            loadouts.push((name, ts.to_string()));
        } else {
            last_comment_name = None;
        }
    }

    loadouts
}

fn parse_class_line(line: &str) -> Option<(String, String)> {
    let classes = [
        "warrior", "paladin", "hunter", "rogue", "priest",
        "death_knight", "deathknight", "shaman", "mage", "warlock",
        "monk", "druid", "demon_hunter", "demonhunter", "evoker",
    ];
    for cls in classes {
        if let Some(rest) = line.strip_prefix(cls) {
            if let Some(rest) = rest.strip_prefix("=\"") {
                if let Some(name) = rest.strip_suffix('"') {
                    return Some((cls.to_string(), name.to_string()));
                }
            }
            if let Some(rest) = rest.strip_prefix('=') {
                let name = rest.trim_matches('"');
                if !name.is_empty() {
                    return Some((cls.to_string(), name.to_string()));
                }
            }
        }
    }
    None
}
