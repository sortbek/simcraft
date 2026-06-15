use serde::{Deserialize, Serialize};
use sqlx::{AnyPool, Row};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Roster {
    pub id: String,
    pub name: String,
    pub region: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RosterMember {
    pub id: String,
    pub roster_id: String,
    pub name: String,
    pub realm: String,
    pub class: String,
    pub spec: String,
    pub source_simc: String,
    pub armory_status: String,
    pub updated_at: String,
}

#[derive(Clone)]
pub struct RosterRepo {
    backend: RosterBackend,
}

#[derive(Clone)]
enum RosterBackend {
    Database(AnyPool),
    Memory(Arc<Mutex<RosterMemory>>),
}

#[derive(Default)]
struct RosterMemory {
    rosters: Vec<Roster>,
    members: Vec<RosterMember>,
}

impl RosterRepo {
    pub fn new(pool: AnyPool) -> Self {
        Self {
            backend: RosterBackend::Database(pool),
        }
    }

    pub fn new_memory() -> Self {
        Self {
            backend: RosterBackend::Memory(Arc::new(Mutex::new(RosterMemory::default()))),
        }
    }

    pub async fn list(&self) -> Result<Vec<Roster>, sqlx::Error> {
        match &self.backend {
            RosterBackend::Database(pool) => {
                let rows = sqlx::query(
                    "SELECT id, name, region, created_at, updated_at FROM rosters ORDER BY updated_at DESC",
                )
                .fetch_all(pool)
                .await?;

                Ok(rows
                    .iter()
                    .map(|r| Roster {
                        id: r.get("id"),
                        name: r.get("name"),
                        region: r.get("region"),
                        created_at: r.get("created_at"),
                        updated_at: r.get("updated_at"),
                    })
                    .collect())
            }
            RosterBackend::Memory(memory) => {
                let mut rosters = memory.lock().unwrap().rosters.clone();
                rosters.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
                Ok(rosters)
            }
        }
    }

    pub async fn get(&self, id: &str) -> Result<Option<Roster>, sqlx::Error> {
        match &self.backend {
            RosterBackend::Database(pool) => {
                let row = sqlx::query(
                    "SELECT id, name, region, created_at, updated_at FROM rosters WHERE id = $1",
                )
                .bind(id)
                .fetch_optional(pool)
                .await?;

                Ok(row.map(|r| Roster {
                    id: r.get("id"),
                    name: r.get("name"),
                    region: r.get("region"),
                    created_at: r.get("created_at"),
                    updated_at: r.get("updated_at"),
                }))
            }
            RosterBackend::Memory(memory) => Ok(memory
                .lock()
                .unwrap()
                .rosters
                .iter()
                .find(|r| r.id == id)
                .cloned()),
        }
    }

    pub async fn create(&self, name: &str, region: &str) -> Result<Roster, sqlx::Error> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        match &self.backend {
            RosterBackend::Database(pool) => {
                sqlx::query(
                    "INSERT INTO rosters (id, name, region, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
                )
                .bind(&id)
                .bind(name)
                .bind(region)
                .bind(&now)
                .bind(&now)
                .execute(pool)
                .await?;
            }
            RosterBackend::Memory(memory) => {
                memory.lock().unwrap().rosters.push(Roster {
                    id: id.clone(),
                    name: name.to_string(),
                    region: region.to_string(),
                    created_at: now.clone(),
                    updated_at: now.clone(),
                });
            }
        }

        Ok(Roster {
            id,
            name: name.to_string(),
            region: region.to_string(),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn rename(&self, id: &str, name: &str) -> Result<bool, sqlx::Error> {
        let now = chrono::Utc::now().to_rfc3339();
        match &self.backend {
            RosterBackend::Database(pool) => {
                let result = sqlx::query("UPDATE rosters SET name = $1, updated_at = $2 WHERE id = $3")
                    .bind(name)
                    .bind(&now)
                    .bind(id)
                    .execute(pool)
                    .await?;
                Ok(result.rows_affected() > 0)
            }
            RosterBackend::Memory(memory) => {
                let mut memory = memory.lock().unwrap();
                if let Some(roster) = memory.rosters.iter_mut().find(|r| r.id == id) {
                    roster.name = name.to_string();
                    roster.updated_at = now;
                    Ok(true)
                } else {
                    Ok(false)
                }
            }
        }
    }

    pub async fn delete(&self, id: &str) -> Result<bool, sqlx::Error> {
        match &self.backend {
            RosterBackend::Database(pool) => {
                sqlx::query("DELETE FROM roster_members WHERE roster_id = $1")
                    .bind(id)
                    .execute(pool)
                    .await?;
                let result = sqlx::query("DELETE FROM rosters WHERE id = $1")
                    .bind(id)
                    .execute(pool)
                    .await?;
                Ok(result.rows_affected() > 0)
            }
            RosterBackend::Memory(memory) => {
                let mut memory = memory.lock().unwrap();
                memory.members.retain(|member| member.roster_id != id);
                let before = memory.rosters.len();
                memory.rosters.retain(|roster| roster.id != id);
                Ok(memory.rosters.len() != before)
            }
        }
    }

    pub async fn list_members(&self, roster_id: &str) -> Result<Vec<RosterMember>, sqlx::Error> {
        match &self.backend {
            RosterBackend::Database(pool) => {
                let rows = sqlx::query(
                    "SELECT id, roster_id, name, realm, class, spec, source_simc, armory_status, updated_at
                     FROM roster_members WHERE roster_id = $1 ORDER BY name, realm",
                )
                .bind(roster_id)
                .fetch_all(pool)
                .await?;

                Ok(rows
                    .iter()
                    .map(|r| RosterMember {
                        id: r.get("id"),
                        roster_id: r.get("roster_id"),
                        name: r.get("name"),
                        realm: r.get("realm"),
                        class: r.get("class"),
                        spec: r.get("spec"),
                        source_simc: r.get("source_simc"),
                        armory_status: r.get("armory_status"),
                        updated_at: r.get("updated_at"),
                    })
                    .collect())
            }
            RosterBackend::Memory(memory) => {
                let mut members: Vec<RosterMember> = memory
                    .lock()
                    .unwrap()
                    .members
                    .iter()
                    .filter(|member| member.roster_id == roster_id)
                    .cloned()
                    .collect();
                members.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.realm.cmp(&b.realm)));
                Ok(members)
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn upsert_member(
        &self,
        roster_id: &str,
        name: &str,
        realm: &str,
        class: &str,
        spec: &str,
        source_simc: &str,
        armory_status: &str,
    ) -> Result<RosterMember, sqlx::Error> {
        let now = chrono::Utc::now().to_rfc3339();
        match &self.backend {
            RosterBackend::Database(pool) => {
                let existing_id: Option<String> = sqlx::query(
                    "SELECT id FROM roster_members WHERE roster_id = $1 AND name = $2 AND realm = $3",
                )
                .bind(roster_id)
                .bind(name)
                .bind(realm)
                .fetch_optional(pool)
                .await?
                .map(|row| row.get("id"));

                let id = if let Some(existing) = existing_id {
                    sqlx::query(
                        "UPDATE roster_members SET class = $1, spec = $2, source_simc = $3, armory_status = $4, updated_at = $5 WHERE id = $6",
                    )
                    .bind(class)
                    .bind(spec)
                    .bind(source_simc)
                    .bind(armory_status)
                    .bind(&now)
                    .bind(&existing)
                    .execute(pool)
                    .await?;
                    existing
                } else {
                    let new_id = uuid::Uuid::new_v4().to_string();
                    sqlx::query(
                        "INSERT INTO roster_members (id, roster_id, name, realm, class, spec, source_simc, armory_status, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
                    )
                    .bind(&new_id)
                    .bind(roster_id)
                    .bind(name)
                    .bind(realm)
                    .bind(class)
                    .bind(spec)
                    .bind(source_simc)
                    .bind(armory_status)
                    .bind(&now)
                    .execute(pool)
                    .await?;
                    new_id
                };

                Ok(RosterMember {
                    id,
                    roster_id: roster_id.to_string(),
                    name: name.to_string(),
                    realm: realm.to_string(),
                    class: class.to_string(),
                    spec: spec.to_string(),
                    source_simc: source_simc.to_string(),
                    armory_status: armory_status.to_string(),
                    updated_at: now,
                })
            }
            RosterBackend::Memory(memory) => {
                let mut memory = memory.lock().unwrap();
                let id = if let Some(existing) = memory
                    .members
                    .iter_mut()
                    .find(|m| m.roster_id == roster_id && m.name == name && m.realm == realm)
                {
                    existing.class = class.to_string();
                    existing.spec = spec.to_string();
                    existing.source_simc = source_simc.to_string();
                    existing.armory_status = armory_status.to_string();
                    existing.updated_at = now.clone();
                    existing.id.clone()
                } else {
                    let new_id = uuid::Uuid::new_v4().to_string();
                    memory.members.push(RosterMember {
                        id: new_id.clone(),
                        roster_id: roster_id.to_string(),
                        name: name.to_string(),
                        realm: realm.to_string(),
                        class: class.to_string(),
                        spec: spec.to_string(),
                        source_simc: source_simc.to_string(),
                        armory_status: armory_status.to_string(),
                        updated_at: now.clone(),
                    });
                    new_id
                };

                Ok(RosterMember {
                    id,
                    roster_id: roster_id.to_string(),
                    name: name.to_string(),
                    realm: realm.to_string(),
                    class: class.to_string(),
                    spec: spec.to_string(),
                    source_simc: source_simc.to_string(),
                    armory_status: armory_status.to_string(),
                    updated_at: now,
                })
            }
        }
    }

    pub async fn delete_member(&self, member_id: &str) -> Result<bool, sqlx::Error> {
        match &self.backend {
            RosterBackend::Database(pool) => {
                let result = sqlx::query("DELETE FROM roster_members WHERE id = $1")
                    .bind(member_id)
                    .execute(pool)
                    .await?;
                Ok(result.rows_affected() > 0)
            }
            RosterBackend::Memory(memory) => {
                let mut memory = memory.lock().unwrap();
                let before = memory.members.len();
                memory.members.retain(|member| member.id != member_id);
                Ok(memory.members.len() != before)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn create_then_list_returns_roster() {
        let repo = RosterRepo::new_memory();
        let r = repo.create("Mythic Team", "eu").await.unwrap();
        assert_eq!(r.name, "Mythic Team");
        assert_eq!(r.region, "eu");
        let all = repo.list().await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, r.id);
    }

    #[tokio::test]
    async fn upsert_member_is_idempotent_on_name_realm() {
        let repo = RosterRepo::new_memory();
        let r = repo.create("T", "eu").await.unwrap();
        repo.upsert_member(&r.id, "Thrall", "Draenor", "shaman", "enhancement", "sim1", "ok").await.unwrap();
        repo.upsert_member(&r.id, "Thrall", "Draenor", "shaman", "enhancement", "sim2", "ok").await.unwrap();
        let members = repo.list_members(&r.id).await.unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].source_simc, "sim2");
    }

    #[tokio::test]
    async fn delete_roster_removes_members() {
        let repo = RosterRepo::new_memory();
        let r = repo.create("T", "us").await.unwrap();
        repo.upsert_member(&r.id, "A", "R", "mage", "frost", "s", "ok").await.unwrap();
        assert!(repo.delete(&r.id).await.unwrap());
        assert!(repo.list_members(&r.id).await.unwrap().is_empty());
    }
}
