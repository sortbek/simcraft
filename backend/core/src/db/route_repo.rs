use serde::{Deserialize, Serialize};
use sqlx::{AnyPool, Row};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedRoute {
    pub id: String,
    pub name: String,
    /// Source MDT string (empty for routes built on the map).
    pub mdt_string: String,
    /// Regenerated SimC fight definition (`None` for level-agnostic rows that
    /// regenerate from `dungeon_idx` + `pulls` at the chosen keystone level).
    pub simc: Option<String>,
    /// MDT dungeon index — the level-agnostic route's dungeon.
    pub dungeon_idx: Option<i64>,
    /// Pull assignment as JSON `[[{enemy_idx, clone_idx}, ...], ...]`, fed back
    /// to `/api/mdt/serialize` to regenerate the SimC at a chosen level.
    pub pulls: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateRouteRequest {
    pub name: String,
    #[serde(default)]
    pub mdt_string: String,
    #[serde(default)]
    pub simc: Option<String>,
    #[serde(default)]
    pub dungeon_idx: Option<i64>,
    #[serde(default)]
    pub pulls: Option<String>,
}

#[derive(Clone)]
pub struct RouteRepo {
    backend: RouteBackend,
}

#[derive(Clone)]
enum RouteBackend {
    Database(AnyPool),
    Memory(Arc<Mutex<Vec<SavedRoute>>>),
}

impl RouteRepo {
    pub fn new(pool: AnyPool) -> Self {
        Self {
            backend: RouteBackend::Database(pool),
        }
    }

    pub fn new_memory() -> Self {
        Self {
            backend: RouteBackend::Memory(Arc::new(Mutex::new(Vec::new()))),
        }
    }

    pub async fn list(&self) -> Result<Vec<SavedRoute>, sqlx::Error> {
        match &self.backend {
            RouteBackend::Database(pool) => {
                let rows = sqlx::query(
                    "SELECT id, name, mdt_string, simc, dungeon_idx, pulls, created_at FROM saved_routes ORDER BY created_at DESC",
                )
                .fetch_all(pool)
                .await?;

                Ok(rows
                    .iter()
                    .map(|r| SavedRoute {
                        id: r.get("id"),
                        name: r.get("name"),
                        mdt_string: r.get("mdt_string"),
                        simc: r.get("simc"),
                        dungeon_idx: r.get("dungeon_idx"),
                        pulls: r.get("pulls"),
                        created_at: r.get("created_at"),
                    })
                    .collect())
            }
            RouteBackend::Memory(routes) => {
                let mut routes = routes.lock().unwrap().clone();
                routes.sort_by(|a, b| b.created_at.cmp(&a.created_at));
                Ok(routes)
            }
        }
    }

    pub async fn insert(
        &self,
        name: &str,
        mdt_string: &str,
        simc: Option<&str>,
        dungeon_idx: Option<i64>,
        pulls: Option<&str>,
    ) -> Result<SavedRoute, sqlx::Error> {
        let id = uuid::Uuid::new_v4().to_string();
        let created_at = chrono::Utc::now().to_rfc3339();
        let route = SavedRoute {
            id,
            name: name.to_string(),
            mdt_string: mdt_string.to_string(),
            simc: simc.map(str::to_string),
            dungeon_idx,
            pulls: pulls.map(str::to_string),
            created_at,
        };

        match &self.backend {
            RouteBackend::Database(pool) => {
                sqlx::query(
                    "INSERT INTO saved_routes (id, name, mdt_string, simc, dungeon_idx, pulls, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                )
                .bind(&route.id)
                .bind(&route.name)
                .bind(&route.mdt_string)
                .bind(&route.simc)
                .bind(route.dungeon_idx)
                .bind(&route.pulls)
                .bind(&route.created_at)
                .execute(pool)
                .await?;
            }
            RouteBackend::Memory(routes) => {
                routes.lock().unwrap().push(route.clone());
            }
        }

        Ok(route)
    }

    pub async fn delete(&self, id: &str) -> Result<bool, sqlx::Error> {
        match &self.backend {
            RouteBackend::Database(pool) => {
                let result = sqlx::query("DELETE FROM saved_routes WHERE id = $1")
                    .bind(id)
                    .execute(pool)
                    .await?;
                Ok(result.rows_affected() > 0)
            }
            RouteBackend::Memory(routes) => {
                let mut routes = routes.lock().unwrap();
                let before = routes.len();
                routes.retain(|route| route.id != id);
                Ok(routes.len() != before)
            }
        }
    }
}
