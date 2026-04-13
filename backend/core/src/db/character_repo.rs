use serde::{Deserialize, Serialize};
use sqlx::{AnyPool, Row};

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

pub struct CharacterRepo {
    pool: AnyPool,
}

impl CharacterRepo {
    pub fn new(pool: AnyPool) -> Self {
        Self { pool }
    }

    pub async fn list(&self) -> Result<Vec<SavedCharacter>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, name, realm, class, spec, simc_input, updated_at FROM characters ORDER BY updated_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|r| SavedCharacter {
                id: r.get("id"),
                name: r.get("name"),
                realm: r.get("realm"),
                class: r.get("class"),
                spec: r.get("spec"),
                simc_input: r.get("simc_input"),
                updated_at: r.get("updated_at"),
            })
            .collect())
    }

    pub async fn upsert(&self, simc_input: &str) -> Result<Option<SavedCharacter>, sqlx::Error> {
        let Some((name, realm, class, spec)) = parse_simc_character(simc_input) else {
            return Ok(None);
        };
        let talent_loadouts = parse_talent_loadouts(simc_input);
        let now = chrono::Utc::now().to_rfc3339();

        let existing_id: Option<String> = sqlx::query(
            "SELECT id FROM characters WHERE name = $1 AND realm = $2",
        )
        .bind(&name)
        .bind(&realm)
        .fetch_optional(&self.pool)
        .await?
        .map(|row| row.get("id"));

        let id = if let Some(existing) = existing_id {
            sqlx::query(
                "UPDATE characters SET class = $1, spec = $2, simc_input = $3, updated_at = $4 WHERE id = $5",
            )
            .bind(&class)
            .bind(&spec)
            .bind(simc_input)
            .bind(&now)
            .bind(&existing)
            .execute(&self.pool)
            .await?;
            existing
        } else {
            let new_id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO characters (id, name, realm, class, spec, simc_input, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            )
            .bind(&new_id)
            .bind(&name)
            .bind(&realm)
            .bind(&class)
            .bind(&spec)
            .bind(simc_input)
            .bind(&now)
            .execute(&self.pool)
            .await?;
            new_id
        };

        for loadout in &talent_loadouts {
            let build_id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO talent_builds (id, character_id, spec, name, talent_string)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT(character_id, talent_string) DO UPDATE SET name = excluded.name, spec = excluded.spec",
            )
            .bind(&build_id)
            .bind(&id)
            .bind(&spec)
            .bind(&loadout.0)
            .bind(&loadout.1)
            .execute(&self.pool)
            .await?;
        }

        Ok(Some(SavedCharacter {
            id,
            name,
            realm,
            class,
            spec,
            simc_input: simc_input.to_string(),
            updated_at: now,
        }))
    }

    pub async fn get_talent_builds(
        &self,
        character_id: &str,
    ) -> Result<Vec<SavedTalentBuild>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, character_id, spec, name, talent_string
             FROM talent_builds WHERE character_id = $1 ORDER BY spec, name",
        )
        .bind(character_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|r| SavedTalentBuild {
                id: r.get("id"),
                character_id: r.get("character_id"),
                spec: r.get("spec"),
                name: r.get("name"),
                talent_string: r.get("talent_string"),
            })
            .collect())
    }

    pub async fn delete_talent_build(&self, id: &str) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("DELETE FROM talent_builds WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn delete(&self, id: &str) -> Result<bool, sqlx::Error> {
        sqlx::query("DELETE FROM talent_builds WHERE character_id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        let result = sqlx::query("DELETE FROM characters WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
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
            if let Some(ts) = comment.strip_prefix("talents=") {
                let name = last_comment_name
                    .take()
                    .unwrap_or_else(|| format!("Loadout {}", counter));
                counter += 1;
                loadouts.push((name, ts.to_string()));
            } else if !comment.is_empty() {
                let clean = comment
                    .trim_end_matches(|c: char| {
                        c.is_ascii_digit() || c == '(' || c == ')' || c == ' '
                    })
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
        "warrior",
        "paladin",
        "hunter",
        "rogue",
        "priest",
        "death_knight",
        "deathknight",
        "shaman",
        "mage",
        "warlock",
        "monk",
        "druid",
        "demon_hunter",
        "demonhunter",
        "evoker",
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
