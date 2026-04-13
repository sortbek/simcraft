pub mod character_repo;
pub mod job_repo;
pub mod route_repo;
pub mod settings_repo;

pub use character_repo::CharacterRepo;
pub use job_repo::JobRepo;
pub use route_repo::RouteRepo;
pub use settings_repo::SettingsRepo;

use sqlx::any::AnyPoolOptions;
use sqlx::AnyPool;
use std::sync::atomic::{AtomicUsize, Ordering};

pub static MAX_JOBS: AtomicUsize = AtomicUsize::new(200);
pub static MAX_SCENARIOS: AtomicUsize = AtomicUsize::new(10);
pub static MAX_COMBINATIONS: AtomicUsize = AtomicUsize::new(0);

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

pub struct Database {
    pub pool: AnyPool,
}

impl Database {
    pub async fn connect(url: &str) -> Result<Self, sqlx::Error> {
        sqlx::any::install_default_drivers();

        // For SQLite: ensure the file is created if it doesn't exist
        let connect_url = if url.starts_with("sqlite:") && !url.contains("mode=") {
            if url.contains('?') {
                format!("{}&mode=rwc", url)
            } else {
                format!("{}?mode=rwc", url)
            }
        } else {
            url.to_string()
        };

        let pool = AnyPoolOptions::new()
            .max_connections(5)
            .connect(&connect_url)
            .await?;

        sqlx::migrate!("../migrations").run(&pool).await?;

        Ok(Self { pool })
    }
}
