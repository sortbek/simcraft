use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

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

pub struct RouteStore {
    conn: Mutex<Connection>,
}

impl RouteStore {
    pub fn new(db_path: &str) -> Self {
        let conn = Connection::open(db_path).expect("Failed to open route store database");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS saved_routes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                mdt_string TEXT NOT NULL,
                created_at TEXT NOT NULL
            );",
        )
        .expect("Failed to create saved_routes table");
        Self {
            conn: Mutex::new(conn),
        }
    }

    pub fn list(&self) -> Vec<SavedRoute> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, name, mdt_string, created_at FROM saved_routes ORDER BY created_at DESC")
            .unwrap();
        stmt.query_map([], |row| {
            Ok(SavedRoute {
                id: row.get(0)?,
                name: row.get(1)?,
                mdt_string: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }

    pub fn insert(&self, name: &str, mdt_string: &str) -> SavedRoute {
        let id = uuid::Uuid::new_v4().to_string();
        let created_at = chrono::Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO saved_routes (id, name, mdt_string, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, mdt_string, created_at],
        )
        .expect("Failed to insert route");
        SavedRoute {
            id,
            name: name.to_string(),
            mdt_string: mdt_string.to_string(),
            created_at,
        }
    }

    pub fn delete(&self, id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let affected = conn
            .execute("DELETE FROM saved_routes WHERE id = ?1", params![id])
            .unwrap_or(0);
        affected > 0
    }
}
