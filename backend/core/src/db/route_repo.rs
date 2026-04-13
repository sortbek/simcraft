use serde::{Deserialize, Serialize};
use sqlx::{AnyPool, Row};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedRoute {
    pub id: String,
    pub name: String,
    pub mdt_string: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateRouteRequest {
    pub name: String,
    pub mdt_string: String,
}

pub struct RouteRepo {
    pool: AnyPool,
}

impl RouteRepo {
    pub fn new(pool: AnyPool) -> Self {
        Self { pool }
    }

    pub async fn list(&self) -> Result<Vec<SavedRoute>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id, name, mdt_string, created_at FROM saved_routes ORDER BY created_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|r| SavedRoute {
                id: r.get("id"),
                name: r.get("name"),
                mdt_string: r.get("mdt_string"),
                created_at: r.get("created_at"),
            })
            .collect())
    }

    pub async fn insert(&self, name: &str, mdt_string: &str) -> Result<SavedRoute, sqlx::Error> {
        let id = uuid::Uuid::new_v4().to_string();
        let created_at = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO saved_routes (id, name, mdt_string, created_at) VALUES ($1, $2, $3, $4)",
        )
        .bind(&id)
        .bind(name)
        .bind(mdt_string)
        .bind(&created_at)
        .execute(&self.pool)
        .await?;

        Ok(SavedRoute {
            id,
            name: name.to_string(),
            mdt_string: mdt_string.to_string(),
            created_at,
        })
    }

    pub async fn delete(&self, id: &str) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("DELETE FROM saved_routes WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }
}
