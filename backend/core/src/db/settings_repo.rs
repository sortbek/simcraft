use sqlx::{AnyPool, Row};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct SettingsRepo {
    backend: SettingsBackend,
}

#[derive(Clone)]
enum SettingsBackend {
    Database(AnyPool),
    Memory(Arc<Mutex<HashMap<String, String>>>),
}

impl SettingsRepo {
    pub fn new(pool: AnyPool) -> Self {
        Self {
            backend: SettingsBackend::Database(pool),
        }
    }

    pub fn new_memory() -> Self {
        Self {
            backend: SettingsBackend::Memory(Arc::new(Mutex::new(HashMap::new()))),
        }
    }

    pub async fn get(&self, key: &str) -> Result<Option<String>, sqlx::Error> {
        match &self.backend {
            SettingsBackend::Database(pool) => {
                let row = sqlx::query("SELECT value FROM admin_settings WHERE key = $1")
                    .bind(key)
                    .fetch_optional(pool)
                    .await?;
                Ok(row.map(|r| r.get("value")))
            }
            SettingsBackend::Memory(settings) => Ok(settings.lock().unwrap().get(key).cloned()),
        }
    }

    pub async fn set(&self, key: &str, value: &str) -> Result<(), sqlx::Error> {
        match &self.backend {
            SettingsBackend::Database(pool) => {
                sqlx::query(
                    "INSERT INTO admin_settings (key, value) VALUES ($1, $2)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                )
                .bind(key)
                .bind(value)
                .execute(pool)
                .await?;
            }
            SettingsBackend::Memory(settings) => {
                settings
                    .lock()
                    .unwrap()
                    .insert(key.to_string(), value.to_string());
            }
        }
        Ok(())
    }

    pub async fn get_all(&self) -> Result<HashMap<String, String>, sqlx::Error> {
        match &self.backend {
            SettingsBackend::Database(pool) => {
                let rows = sqlx::query("SELECT key, value FROM admin_settings")
                    .fetch_all(pool)
                    .await?;
                Ok(rows
                    .iter()
                    .map(|r| (r.get("key"), r.get("value")))
                    .collect())
            }
            SettingsBackend::Memory(settings) => Ok(settings.lock().unwrap().clone()),
        }
    }
}
