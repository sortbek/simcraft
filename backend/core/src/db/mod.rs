pub mod character_repo;
pub mod cloud_chunks_repo;
pub mod combo_dedup_repo;
pub mod combo_metadata_repo;
pub mod job_repo;
pub mod route_repo;
pub mod settings_repo;
pub mod stage_batches_repo;
pub mod stage_results_repo;
pub mod triage_batches_repo;

pub use character_repo::CharacterRepo;
pub use cloud_chunks_repo::{ChunkResultEnvelope, CloudChunkRow, CloudChunksRepo};
pub use combo_dedup_repo::ComboDedupRepo;
pub use combo_metadata_repo::{ComboMetadataInsert, ComboMetadataRepo, ComboMetadataRow};
pub use job_repo::{JobRepo, JobStatusFilter, ListJobsFilter};
pub use route_repo::RouteRepo;
pub use settings_repo::SettingsRepo;
pub use stage_batches_repo::{StageBatchRow, StageBatchesRepo, StageTotals};
pub use stage_results_repo::{StageResultInsert, StageResultRow, StageResultsRepo};
pub use triage_batches_repo::{TriageBatchRow, TriageBatchesRepo};

use sqlx::any::AnyPoolOptions;
use sqlx::AnyPool;
use std::sync::atomic::{AtomicUsize, Ordering};

pub static MAX_JOBS: AtomicUsize = AtomicUsize::new(200);
pub static MAX_SCENARIOS: AtomicUsize = AtomicUsize::new(10);
pub static MAX_COMBINATIONS: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DatabaseBackend {
    Sqlite,
    Postgres,
}

impl DatabaseBackend {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sqlite => "sqlite",
            Self::Postgres => "postgres",
        }
    }
}

/// Initialize limits from environment variables. Call once at startup.
pub fn init_limits() {
    let max_jobs = std::env::var("MAX_JOBS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(if cfg!(feature = "desktop") { 50 } else { 200 });
    let max_scenarios = std::env::var("MAX_SCENARIOS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);
    let max_combos = std::env::var("MAX_COMBINATIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    MAX_JOBS.store(max_jobs, Ordering::Relaxed);
    MAX_SCENARIOS.store(max_scenarios, Ordering::Relaxed);
    MAX_COMBINATIONS.store(max_combos, Ordering::Relaxed);
}

/// Build a multi-row `VALUES` placeholder string like `($1, $2),($3, $4)` for
/// `rows` rows of `cols` contiguous 1-based bind parameters each. Used by the
/// chunked bulk-insert repos (combo_dedup, combo_metadata, stage_results) so the
/// placeholder arithmetic lives in one place.
pub(crate) fn values_placeholders(rows: usize, cols: usize) -> String {
    (0..rows)
        .map(|r| {
            let base = r * cols;
            let cells = (1..=cols)
                .map(|c| format!("${}", base + c))
                .collect::<Vec<_>>()
                .join(", ");
            format!("({cells})")
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn is_sqlite_url(url: &str) -> bool {
    url.starts_with("sqlite:") || !url.contains("://")
}

fn is_postgres_url(url: &str) -> bool {
    url.starts_with("postgres://") || url.starts_with("postgresql://")
}

fn resolve_backend(url: &str, configured: Option<&str>) -> Result<DatabaseBackend, String> {
    if let Some(raw_backend) = configured {
        let backend = match raw_backend.trim().to_ascii_lowercase().as_str() {
            "sqlite" => DatabaseBackend::Sqlite,
            "postgres" | "postgresql" => {
                if !cfg!(feature = "postgres") {
                    return Err(
                        "DB_BACKEND=postgres requires a build with the `postgres` feature enabled"
                            .to_string(),
                    );
                }
                DatabaseBackend::Postgres
            }
            other => {
                return Err(format!(
                    "Unsupported DB_BACKEND value '{other}'. Expected 'sqlite' or 'postgres'."
                ));
            }
        };

        return match backend {
            DatabaseBackend::Sqlite if is_sqlite_url(url) => Ok(DatabaseBackend::Sqlite),
            DatabaseBackend::Sqlite => Err(
                "DB_BACKEND=sqlite requires a SQLite DATABASE_URL or plain SQLite file path"
                    .to_string(),
            ),
            DatabaseBackend::Postgres if is_postgres_url(url) => Ok(DatabaseBackend::Postgres),
            DatabaseBackend::Postgres => Err(
                "DB_BACKEND=postgres requires a postgres:// or postgresql:// DATABASE_URL"
                    .to_string(),
            ),
        };
    }

    if is_sqlite_url(url) {
        return Ok(DatabaseBackend::Sqlite);
    }

    if is_postgres_url(url) {
        if !cfg!(feature = "postgres") {
            return Err(
                "PostgreSQL DATABASE_URL provided, but this build does not enable the `postgres` feature"
                    .to_string(),
            );
        }
        return Ok(DatabaseBackend::Postgres);
    }

    Err(format!(
        "Unsupported DATABASE_URL scheme for '{url}'. Set DB_BACKEND explicitly if needed."
    ))
}

pub fn configured_backend(url: &str) -> Result<DatabaseBackend, String> {
    let configured = std::env::var("DB_BACKEND").ok();
    resolve_backend(url, configured.as_deref())
}

pub struct Database {
    pub pool: AnyPool,
}

impl Database {
    pub async fn connect(url: &str) -> Result<Self, sqlx::Error> {
        sqlx::any::install_default_drivers();

        let backend = configured_backend(url).map_err(|message| {
            sqlx::Error::Configuration(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                message,
            )))
        })?;
        let is_sqlite = matches!(backend, DatabaseBackend::Sqlite);

        let connect_url = if is_sqlite && !url.contains("mode=") {
            if url.contains('?') {
                format!("{}&mode=rwc", url)
            } else {
                format!("{}?mode=rwc", url)
            }
        } else {
            url.to_string()
        };

        // SQLite: single writer, busy timeout to handle brief lock contention
        // PostgreSQL: standard pool with multiple connections
        let pool = if is_sqlite {
            AnyPoolOptions::new()
                .max_connections(1)
                .connect(&connect_url)
                .await?
        } else {
            AnyPoolOptions::new()
                .max_connections(5)
                .connect(&connect_url)
                .await?
        };

        // Enable WAL mode for SQLite — allows concurrent reads while writing
        if is_sqlite {
            if let Err(e) = sqlx::query("PRAGMA journal_mode=WAL").execute(&pool).await {
                eprintln!("Failed to enable SQLite WAL mode: {}", e);
            }
            if let Err(e) = sqlx::query("PRAGMA busy_timeout=5000").execute(&pool).await {
                eprintln!("Failed to set SQLite busy_timeout: {}", e);
            }
        }

        sqlx::migrate!("../migrations").run(&pool).await?;

        Ok(Self { pool })
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_backend, DatabaseBackend};

    #[test]
    fn infers_sqlite_from_plain_path() {
        assert_eq!(
            resolve_backend("simhammer.db", None).unwrap(),
            DatabaseBackend::Sqlite
        );
    }

    #[test]
    fn enforces_sqlite_runtime_selection() {
        let err =
            resolve_backend("postgresql://db.example.com/simhammer", Some("sqlite")).unwrap_err();
        assert!(err.contains("DB_BACKEND=sqlite"));
    }

    #[test]
    fn rejects_unknown_runtime_backend() {
        let err = resolve_backend("simhammer.db", Some("mysql")).unwrap_err();
        assert!(err.contains("Unsupported DB_BACKEND"));
    }

    #[test]
    fn handles_postgres_runtime_selection() {
        let result = resolve_backend(
            "postgresql://db.example.com:5432/simhammer",
            Some("postgres"),
        );
        if cfg!(feature = "postgres") {
            assert_eq!(result.unwrap(), DatabaseBackend::Postgres);
        } else {
            let err = result.unwrap_err();
            assert!(err.contains("DB_BACKEND=postgres"));
            assert!(err.contains("postgres"));
        }
    }
}
