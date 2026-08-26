use serde::{Deserialize, Serialize};
use sqlx::{AnyPool, Row};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedSimProfile {
    pub id: String,
    pub name: String,
    /// Versioned config blob `{"version": 1, "data": {...}}`. Opaque here —
    /// the frontend owns the schema.
    pub data: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct UpsertSimProfileRequest {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub data: String,
}

/// Column list shared by every statement and `row_to_profile`, so adding a
/// column can't leave a SELECT and the mapper out of step.
const COLUMNS: &str = "id, name, data, created_at, updated_at";

fn row_to_profile(row: &sqlx::any::AnyRow) -> SavedSimProfile {
    SavedSimProfile {
        id: row.get("id"),
        name: row.get("name"),
        data: row.get("data"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

#[derive(Clone)]
pub struct SimProfileRepo {
    backend: ProfileBackend,
}

#[derive(Clone)]
enum ProfileBackend {
    Database(AnyPool),
    Memory(Arc<Mutex<Vec<SavedSimProfile>>>),
}

impl SimProfileRepo {
    pub fn new(pool: AnyPool) -> Self {
        Self {
            backend: ProfileBackend::Database(pool),
        }
    }

    pub fn new_memory() -> Self {
        Self {
            backend: ProfileBackend::Memory(Arc::new(Mutex::new(Vec::new()))),
        }
    }

    pub async fn list(&self) -> Result<Vec<SavedSimProfile>, sqlx::Error> {
        match &self.backend {
            ProfileBackend::Database(pool) => {
                let rows = sqlx::query(&format!(
                    "SELECT {COLUMNS} FROM sim_profiles ORDER BY updated_at DESC"
                ))
                .fetch_all(pool)
                .await?;
                Ok(rows.iter().map(row_to_profile).collect())
            }
            ProfileBackend::Memory(profiles) => {
                let mut profiles = profiles.lock().unwrap().clone();
                profiles.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
                Ok(profiles)
            }
        }
    }

    /// Insert (no id) or overwrite name+data (existing id). `Ok(None)` when the
    /// id doesn't exist, so the handler can 404 instead of resurrecting rows.
    pub async fn upsert(
        &self,
        id: Option<&str>,
        name: &str,
        data: &str,
    ) -> Result<Option<SavedSimProfile>, sqlx::Error> {
        match id {
            Some(id) => self.update(id, name, data).await,
            None => self.insert(name, data).await.map(Some),
        }
    }

    async fn insert(&self, name: &str, data: &str) -> Result<SavedSimProfile, sqlx::Error> {
        let now = chrono::Utc::now().to_rfc3339();
        let profile = SavedSimProfile {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            data: data.to_string(),
            created_at: now.clone(),
            updated_at: now,
        };
        match &self.backend {
            ProfileBackend::Database(pool) => {
                sqlx::query(&format!(
                    "INSERT INTO sim_profiles ({COLUMNS}) VALUES ($1, $2, $3, $4, $5)"
                ))
                .bind(&profile.id)
                .bind(&profile.name)
                .bind(&profile.data)
                .bind(&profile.created_at)
                .bind(&profile.updated_at)
                .execute(pool)
                .await?;
            }
            ProfileBackend::Memory(profiles) => {
                profiles.lock().unwrap().push(profile.clone());
            }
        }
        Ok(profile)
    }

    /// `Ok(None)` when the id doesn't exist — the only path that can 404.
    async fn update(
        &self,
        id: &str,
        name: &str,
        data: &str,
    ) -> Result<Option<SavedSimProfile>, sqlx::Error> {
        let now = chrono::Utc::now().to_rfc3339();
        match &self.backend {
            ProfileBackend::Database(pool) => {
                let result = sqlx::query(
                    "UPDATE sim_profiles SET name = $1, data = $2, updated_at = $3 WHERE id = $4",
                )
                .bind(name)
                .bind(data)
                .bind(&now)
                .bind(id)
                .execute(pool)
                .await?;
                if result.rows_affected() == 0 {
                    return Ok(None);
                }
                let row = sqlx::query(&format!("SELECT {COLUMNS} FROM sim_profiles WHERE id = $1"))
                    .bind(id)
                    .fetch_one(pool)
                    .await?;
                Ok(Some(row_to_profile(&row)))
            }
            ProfileBackend::Memory(profiles) => {
                let mut profiles = profiles.lock().unwrap();
                match profiles.iter_mut().find(|p| p.id == id) {
                    Some(p) => {
                        p.name = name.to_string();
                        p.data = data.to_string();
                        p.updated_at = now;
                        Ok(Some(p.clone()))
                    }
                    None => Ok(None),
                }
            }
        }
    }

    pub async fn delete(&self, id: &str) -> Result<bool, sqlx::Error> {
        match &self.backend {
            ProfileBackend::Database(pool) => {
                let result = sqlx::query("DELETE FROM sim_profiles WHERE id = $1")
                    .bind(id)
                    .execute(pool)
                    .await?;
                Ok(result.rows_affected() > 0)
            }
            ProfileBackend::Memory(profiles) => {
                let mut profiles = profiles.lock().unwrap();
                let before = profiles.len();
                profiles.retain(|p| p.id != id);
                Ok(profiles.len() != before)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn insert_then_list() {
        let repo = SimProfileRepo::new_memory();
        let p = repo
            .upsert(None, "Raid ST", "{\"version\":1}")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(p.name, "Raid ST");
        assert!(!p.id.is_empty());
        let all = repo.list().await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, p.id);
    }

    #[tokio::test]
    async fn upsert_existing_id_overwrites_and_bumps_updated_at() {
        let repo = SimProfileRepo::new_memory();
        let p = repo.upsert(None, "A", "{}").await.unwrap().unwrap();
        let p2 = repo
            .upsert(Some(&p.id), "B", "{\"version\":1}")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(p2.id, p.id);
        assert_eq!(p2.name, "B");
        assert_eq!(p2.data, "{\"version\":1}");
        assert_eq!(p2.created_at, p.created_at);
        assert!(p2.updated_at >= p.updated_at);
        assert_eq!(repo.list().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn upsert_unknown_id_returns_none() {
        let repo = SimProfileRepo::new_memory();
        let res = repo.upsert(Some("nope"), "A", "{}").await.unwrap();
        assert!(res.is_none());
    }

    #[tokio::test]
    async fn list_orders_newest_updated_first() {
        let repo = SimProfileRepo::new_memory();
        let a = repo.upsert(None, "A", "{}").await.unwrap().unwrap();
        let _b = repo.upsert(None, "B", "{}").await.unwrap().unwrap();
        // Touch A so it has the newest updated_at.
        repo.upsert(Some(&a.id), "A", "{}").await.unwrap().unwrap();
        let all = repo.list().await.unwrap();
        assert_eq!(all[0].id, a.id);
    }

    #[tokio::test]
    async fn delete_removes_and_reports() {
        let repo = SimProfileRepo::new_memory();
        let p = repo.upsert(None, "A", "{}").await.unwrap().unwrap();
        assert!(repo.delete(&p.id).await.unwrap());
        assert!(!repo.delete(&p.id).await.unwrap());
        assert!(repo.list().await.unwrap().is_empty());
    }

    /// One in-memory SQLite DB for the whole pool, built through the production
    /// connector so pool/pragma/migration setup can't drift from it.
    async fn sqlite_test_pool() -> AnyPool {
        crate::db::Database::connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite")
            .pool
    }

    // Exercises the real SQL (INSERT/UPDATE/SELECT/DELETE + migration) that the
    // memory backend can't.
    #[tokio::test]
    async fn sqlite_crud_round_trip() {
        let repo = SimProfileRepo::new(sqlite_test_pool().await);
        let p = repo.upsert(None, "A", "{}").await.unwrap().unwrap();
        let p2 = repo
            .upsert(Some(&p.id), "B", "{\"version\":1}")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(p2.name, "B");
        assert_eq!(p2.created_at, p.created_at);
        assert!(repo
            .upsert(Some("nope"), "X", "{}")
            .await
            .unwrap()
            .is_none());
        let all = repo.list().await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].data, "{\"version\":1}");
        assert!(repo.delete(&p.id).await.unwrap());
        assert!(!repo.delete(&p.id).await.unwrap());
    }
}
