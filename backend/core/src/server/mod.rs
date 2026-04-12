#[cfg(not(feature = "desktop"))]
mod admin_handlers;
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
    source_dir: Option<PathBuf>,
}

impl SimcBinaries {
    fn resolve_from_source_dir(&self, branch: &str) -> Option<PathBuf> {
        let dir = self.source_dir.as_ref()?;
        let binary_name = if cfg!(windows) { "simc.exe" } else { "simc" };

        let mut newest_by_branch: HashMap<String, (String, PathBuf)> = HashMap::new();
        let mut exact_matches: HashMap<String, PathBuf> = HashMap::new();

        let entries = std::fs::read_dir(dir).ok()?;
        for entry in entries.flatten() {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_dir() {
                continue;
            }

            let tag = entry.file_name().to_string_lossy().to_string();
            let bin = entry.path().join(binary_name);
            if !bin.exists() {
                continue;
            }

            exact_matches.insert(tag.clone(), bin.clone());

            let branch_name = if tag.starts_with("weekly-") {
                Some("weekly")
            } else if tag.starts_with("nightly-") {
                Some("nightly")
            } else {
                None
            };

            if let Some(branch_name) = branch_name {
                let current = newest_by_branch
                    .entry(branch_name.to_string())
                    .or_insert_with(|| (tag.clone(), bin.clone()));
                if tag > current.0 {
                    *current = (tag, bin);
                }
            }
        }

        exact_matches.get(branch).cloned().or_else(|| {
            if let Some((prefix, _)) = branch.split_once('-') {
                newest_by_branch.get(prefix).map(|(_, bin)| bin.clone())
            } else {
                newest_by_branch.get(branch).map(|(_, bin)| bin.clone())
            }
        })
    }

    /// Resolve a simc binary path for the given branch.
    /// Empty string uses the default branch.
    pub fn resolve(&self, branch: &str) -> Result<PathBuf, String> {
        let key = if branch.is_empty() {
            &self.default_branch
        } else {
            branch
        };
        self.bins
            .get(key)
            .or_else(|| {
                if let Some((prefix, _)) = key.split_once('-') {
                    self.bins.get(prefix)
                } else {
                    None
                }
            })
            .cloned()
            .or_else(|| self.resolve_from_source_dir(key))
            .ok_or_else(|| format!("SimC branch '{}' not available", key))
    }

    /// Build from a SIMC_DIR: scans for installed version directories and exposes
    /// both exact version tags (e.g. `weekly-2026-04-12`) and logical aliases
    /// (`weekly`, `nightly`) for the newest installed version of each branch.
    pub fn from_dir(dir: &Path) -> Self {
        let binary_name = if cfg!(windows) { "simc.exe" } else { "simc" };
        let mut bins = HashMap::new();
        let mut newest_by_branch: HashMap<String, (String, PathBuf)> = HashMap::new();

        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if !file_type.is_dir() {
                    continue;
                }

                let tag = entry.file_name().to_string_lossy().to_string();
                let bin = entry.path().join(binary_name);
                if !bin.exists() {
                    continue;
                }

                bins.insert(tag.clone(), bin.clone());

                let branch = if tag.starts_with("weekly-") {
                    Some("weekly")
                } else if tag.starts_with("nightly-") {
                    Some("nightly")
                } else {
                    None
                };

                if let Some(branch) = branch {
                    let entry = newest_by_branch
                        .entry(branch.to_string())
                        .or_insert_with(|| (tag.clone(), bin.clone()));
                    if tag > entry.0 {
                        *entry = (tag, bin);
                    }
                }
            }
        }

        for (branch, (_, bin)) in newest_by_branch {
            bins.insert(branch, bin);
        }

        let default_branch = std::fs::read_to_string(dir.join(".active"))
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|_| "weekly".to_string());

        Self {
            bins,
            default_branch,
            source_dir: Some(dir.to_path_buf()),
        }
    }

    /// Build from a single SIMC_PATH (legacy/fallback mode).
    pub fn from_single_path(path: PathBuf) -> Self {
        let mut bins = HashMap::new();
        bins.insert("default".to_string(), path);
        Self {
            bins,
            default_branch: "default".to_string(),
            source_dir: None,
        }
    }

    /// List available branch names.
    pub fn available_branches(&self) -> Vec<&str> {
        let mut branches: Vec<&str> = self
            .bins
            .keys()
            .filter_map(|key| match key.as_str() {
                "weekly" | "nightly" | "default" => Some(key.as_str()),
                _ => None,
            })
            .collect();
        branches.sort_unstable();
        branches
    }

    pub fn source_dir(&self) -> &Option<PathBuf> {
        &self.source_dir
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
    #[cfg(not(feature = "desktop"))]
    let settings_store = Arc::new(crate::settings_store::SettingsStore::new(&db_url));
    #[cfg(not(feature = "desktop"))]
    {
        // Apply persisted admin settings on startup
        if let Some(val) = settings_store.get("max_combinations").and_then(|v| v.parse::<usize>().ok()) {
            crate::storage::MAX_COMBINATIONS.store(val, std::sync::atomic::Ordering::Relaxed);
        }
        if let Some(val) = settings_store.get("max_scenarios").and_then(|v| v.parse::<usize>().ok()) {
            crate::storage::MAX_SCENARIOS.store(val, std::sync::atomic::Ordering::Relaxed);
        }
    }
    #[cfg(not(feature = "desktop"))]
    let settings_data = web::Data::new(settings_store);
    #[cfg(not(feature = "desktop"))]
    let admin_secret = web::Data::new(admin_handlers::AdminSecret(
        uuid::Uuid::new_v4().to_string(),
    ));
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
        #[cfg(not(feature = "desktop"))]
        let app = app
            .app_data(settings_data.clone())
            .app_data(admin_secret.clone());
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

#[cfg(test)]
mod tests {
    use super::SimcBinaries;
    use std::fs;
    use tempfile::tempdir;

    fn binary_name() -> &'static str {
        if cfg!(windows) { "simc.exe" } else { "simc" }
    }

    fn install_fake_version(base: &std::path::Path, tag: &str) -> std::path::PathBuf {
        let dir = base.join(tag);
        fs::create_dir_all(&dir).unwrap();
        let binary = dir.join(binary_name());
        fs::write(&binary, b"fake-simc").unwrap();
        binary
    }

    #[test]
    fn resolves_exact_tags_and_branch_aliases() {
        let temp = tempdir().unwrap();
        let weekly = install_fake_version(temp.path(), "weekly-2026-04-12");
        let nightly = install_fake_version(temp.path(), "nightly-2026-04-11");
        fs::write(temp.path().join(".active"), "weekly-2026-04-12").unwrap();

        let bins = SimcBinaries::from_dir(temp.path());

        assert_eq!(bins.available_branches(), vec!["nightly", "weekly"]);
        assert_eq!(bins.resolve("").unwrap(), weekly);
        assert_eq!(bins.resolve("weekly").unwrap(), weekly);
        assert_eq!(bins.resolve("weekly-2026-04-12").unwrap(), weekly);
        assert_eq!(bins.resolve("nightly").unwrap(), nightly);
        assert_eq!(bins.resolve("nightly-2026-04-11").unwrap(), nightly);
    }

    #[test]
    fn resolve_refreshes_new_versions_from_source_dir() {
        let temp = tempdir().unwrap();
        install_fake_version(temp.path(), "weekly-2026-04-12");
        fs::write(temp.path().join(".active"), "weekly-2026-04-12").unwrap();

        let bins = SimcBinaries::from_dir(temp.path());
        let nightly = install_fake_version(temp.path(), "nightly-2026-04-12");

        assert_eq!(bins.resolve("nightly").unwrap(), nightly);
    }
}
