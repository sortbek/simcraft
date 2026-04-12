mod api_routes;
mod character_handlers;
mod droptimizer_handlers;
mod enchant_gem_handlers;
mod frontend;
mod game_data_handlers;
mod helpers;
mod job_handlers;
mod route_handlers;
mod sim_handlers;
mod system_handlers;
mod top_gear_handlers;
mod types;
mod upgrade_compare;

use actix_cors::Cors;
use actix_web::{web, App, HttpServer};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
#[cfg(feature = "desktop")]
use std::sync::Mutex;

use crate::log_buffer::LogBuffer;
use crate::storage::JobStorage;
use types::FrontendDir;

/// Holds all available simc binaries keyed by branch name ("weekly", "nightly").
pub struct SimcBinaries {
    pub bins: HashMap<String, PathBuf>,
    pub default_branch: String,
}

impl SimcBinaries {
    /// Resolve a simc binary path for the given branch.
    /// Empty string uses the default branch.
    pub fn resolve(&self, branch: &str) -> Result<&Path, String> {
        let key = if branch.is_empty() {
            &self.default_branch
        } else {
            branch
        };
        self.bins
            .get(key)
            .map(|p| p.as_path())
            .ok_or_else(|| format!("SimC branch '{}' not available", key))
    }

    /// Build from a SIMC_DIR: scans for `weekly/simc[.exe]` and `nightly/simc[.exe]` subdirs.
    /// Reads `.active` file for the default branch.
    pub fn from_dir(dir: &Path) -> Self {
        let binary_name = if cfg!(windows) { "simc.exe" } else { "simc" };
        let mut bins = HashMap::new();

        for branch in &["weekly", "nightly"] {
            let bin = dir.join(branch).join(binary_name);
            if bin.exists() {
                bins.insert(branch.to_string(), bin);
            }
        }

        let default_branch = std::fs::read_to_string(dir.join(".active"))
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|_| "weekly".to_string());

        Self {
            bins,
            default_branch,
        }
    }

    /// Build from a single SIMC_PATH (legacy/fallback mode).
    pub fn from_single_path(path: PathBuf) -> Self {
        let mut bins = HashMap::new();
        bins.insert("default".to_string(), path);
        Self {
            bins,
            default_branch: "default".to_string(),
        }
    }

    /// List available branch names.
    pub fn available_branches(&self) -> Vec<&str> {
        self.bins.keys().map(|s| s.as_str()).collect()
    }
}

// ---------- Server startup ----------

/// Start the HTTP server with in-memory storage (desktop default).
pub async fn start(resource_dir: &Path, frontend_dir: Option<PathBuf>) -> u16 {
    let simc_bins = Arc::new(SimcBinaries::from_dir(&resource_dir.join("simc")));
    let data_dir = Some(resource_dir.join("data"));
    let storage: Arc<dyn JobStorage> = Arc::new(crate::storage::memory::MemoryStorage::new());
    start_with_storage(storage, simc_bins, 17384, frontend_dir, data_dir).await
}

/// Start the actix-web HTTP server with a given storage backend.
/// Returns the port number.
pub async fn start_with_storage(
    storage: Arc<dyn JobStorage>,
    simc_bins: Arc<SimcBinaries>,
    port: u16,
    frontend_dir: Option<PathBuf>,
    data_dir: Option<PathBuf>,
) -> u16 {
    start_with_storage_bind(
        storage,
        simc_bins,
        "127.0.0.1",
        port,
        frontend_dir,
        data_dir,
    )
    .await
}

/// Start the actix-web HTTP server with a given storage backend and bind address.
/// Returns the port number.
pub async fn start_with_storage_bind(
    storage: Arc<dyn JobStorage>,
    simc_bins: Arc<SimcBinaries>,
    bind_host: &str,
    port: u16,
    frontend_dir: Option<PathBuf>,
    data_dir: Option<PathBuf>,
) -> u16 {
    let store_data = web::Data::new(storage);
    let simc_data = web::Data::new(simc_bins);
    let log_data = web::Data::new(Arc::new(LogBuffer::new()));
    #[cfg(feature = "desktop")]
    let stats_data = web::Data::new(Arc::new(Mutex::new(system_handlers::SystemStats::new())));
    let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "simhammer.db".to_string());
    let route_store_data = web::Data::new(Arc::new(crate::route_store::RouteStore::new(&db_url)));
    let char_store_data = web::Data::new(Arc::new(crate::character_store::CharacterStore::new(
        &db_url,
    )));
    let frontend = frontend_dir.clone();
    let data = data_dir.clone();

    let bind_addr = format!("{}:{}", bind_host, port);

    let server = HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        let app = App::new()
            .wrap(cors)
            .app_data(store_data.clone())
            .app_data(simc_data.clone())
            .app_data(log_data.clone())
            .app_data(route_store_data.clone())
            .app_data(char_store_data.clone())
            .configure(api_routes::configure);
        #[cfg(feature = "desktop")]
        let app = app.app_data(stats_data.clone());
        let mut app = app;

        // Serve cached assets from data directory
        if let Some(ref dir) = data {
            let images_dir = dir.join("instance-images");
            if images_dir.exists() {
                app = app.service(
                    actix_files::Files::new("/api/data/instance-images", images_dir)
                        .prefer_utf8(true),
                );
            }
            let static_dir = dir.join("static");
            if static_dir.exists() {
                app = app.service(
                    actix_files::Files::new("/api/data/static", static_dir).prefer_utf8(true),
                );
            }
        }

        // Serve static frontend files in production (not in dev mode)
        if let Some(ref dir) = frontend {
            app = app
                .app_data(web::Data::new(FrontendDir(dir.clone())))
                .service(actix_files::Files::new("/_next", dir.join("_next")).prefer_utf8(true))
                .default_service(web::get().to(frontend::spa_fallback));
        }

        app
    })
    .bind(&bind_addr)
    .unwrap_or_else(|_| panic!("Failed to bind to {}", bind_addr))
    .run();

    tokio::spawn(server);

    println!("HTTP server started on port {}", port);
    port
}
