mod character_handlers;
mod game_data_handlers;
mod helpers;
mod job_handlers;
mod route_handlers;
mod sim_handlers;
mod types;
mod upgrade_compare;

use actix_cors::Cors;
use actix_files::NamedFile;
use actix_web::{web, App, HttpRequest, HttpResponse, HttpServer};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;
#[cfg(feature = "desktop")]
use std::sync::Mutex;

use crate::log_buffer::LogBuffer;
use crate::storage::{self, JobStorage};
use types::FrontendDir;

// ---------- System handlers ----------

#[cfg(feature = "desktop")]
/// Shared system info state, refreshed in background for live CPU readings.
struct SystemStats {
    sys: sysinfo::System,
}

#[cfg(feature = "desktop")]
impl SystemStats {
    fn new() -> Self {
        let mut sys = sysinfo::System::new();
        sys.refresh_cpu_all();
        Self { sys }
    }

    fn refresh(&mut self) {
        self.sys.refresh_cpu_all();
    }

    fn cpu_usage(&self) -> f32 {
        let cpus = self.sys.cpus();
        if cpus.is_empty() {
            return 0.0;
        }
        cpus.iter().map(|c| c.cpu_usage()).sum::<f32>() / cpus.len() as f32
    }
}

async fn get_config() -> HttpResponse {
    let max_combos = *storage::MAX_COMBINATIONS;
    let mut config = json!({
        "max_scenarios": *storage::MAX_SCENARIOS,
    });
    if max_combos > 0 {
        config["max_combinations"] = json!(max_combos);
    }
    HttpResponse::Ok().json(config)
}

async fn health_check() -> HttpResponse {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    HttpResponse::Ok().json(json!({
        "status": "ok",
        "threads": threads,
        "mode": "desktop",
    }))
}

#[cfg(feature = "desktop")]
async fn system_stats(stats: web::Data<Arc<Mutex<SystemStats>>>) -> HttpResponse {
    let mut s = stats.lock().unwrap();
    s.refresh();
    let cpu = s.cpu_usage();
    HttpResponse::Ok().json(json!({
        "cpu_usage": (cpu * 10.0).round() / 10.0,
    }))
}

/// SPA fallback: serve the appropriate HTML file for client-side routes
async fn spa_fallback(
    req: HttpRequest,
    frontend_dir: web::Data<FrontendDir>,
) -> actix_web::Result<NamedFile> {
    let path = req.path();

    // Try exact file match first (e.g., /quick-sim -> quick-sim.html)
    let trimmed = path.trim_start_matches('/');
    let html_path = frontend_dir.0.join(format!("{}.html", trimmed));
    if html_path.exists() {
        return Ok(NamedFile::open(html_path)?);
    }

    // /sim/{id} -> sim/_.html (the placeholder page)
    if path.starts_with("/sim/") {
        let sim_html = frontend_dir.0.join("sim").join("_.html");
        if sim_html.exists() {
            return Ok(NamedFile::open(sim_html)?);
        }
    }

    // Fallback to index.html
    Ok(NamedFile::open(frontend_dir.0.join("index.html"))?)
}

// ---------- Server startup ----------

/// Start the HTTP server with in-memory storage (desktop default).
pub async fn start(resource_dir: &Path, frontend_dir: Option<PathBuf>) -> u16 {
    let simc_path = if cfg!(windows) {
        resource_dir.join("simc").join("simc.exe")
    } else {
        resource_dir.join("simc").join("simc")
    };
    let data_dir = Some(resource_dir.join("data"));
    let storage: Arc<dyn JobStorage> = Arc::new(crate::storage::memory::MemoryStorage::new());
    start_with_storage(storage, simc_path, 17384, frontend_dir, data_dir).await
}

/// Start the actix-web HTTP server with a given storage backend.
/// Returns the port number.
pub async fn start_with_storage(
    storage: Arc<dyn JobStorage>,
    simc_path: PathBuf,
    port: u16,
    frontend_dir: Option<PathBuf>,
    data_dir: Option<PathBuf>,
) -> u16 {
    start_with_storage_bind(
        storage,
        simc_path,
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
    simc_path: PathBuf,
    bind_host: &str,
    port: u16,
    frontend_dir: Option<PathBuf>,
    data_dir: Option<PathBuf>,
) -> u16 {
    let store_data = web::Data::new(storage);
    let simc_data = web::Data::new(simc_path);
    let log_data = web::Data::new(Arc::new(LogBuffer::new()));
    #[cfg(feature = "desktop")]
    let stats_data = web::Data::new(Arc::new(Mutex::new(SystemStats::new())));
    let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "simhammer.db".to_string());
    let route_store_data = web::Data::new(Arc::new(crate::route_store::RouteStore::new(&db_url)));
    let char_store_data =
        web::Data::new(Arc::new(crate::character_store::CharacterStore::new(&db_url)));
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
            .app_data(log_data.clone());
        #[cfg(feature = "desktop")]
        let app = app.app_data(stats_data.clone());

        // Simulation routes
        let mut app = app
            .route("/api/sim", web::post().to(sim_handlers::create_sim))
            .route(
                "/api/top-gear/sim",
                web::post().to(sim_handlers::create_top_gear_sim),
            )
            .route(
                "/api/top-gear/combo-count",
                web::post().to(sim_handlers::get_top_gear_combo_count),
            )
            .route(
                "/api/droptimizer/sim",
                web::post().to(sim_handlers::create_droptimizer_sim),
            )
            // Enchant & Gem routes
            .route(
                "/api/enchant-gem/sim",
                web::post().to(sim_handlers::create_enchant_gem_sim),
            )
            .route(
                "/api/enchant-gem/combo-count",
                web::post().to(sim_handlers::get_enchant_gem_combo_count),
            )
            .route(
                "/api/enchants",
                web::get().to(game_data_handlers::list_enchants),
            )
            .route(
                "/api/gems",
                web::get().to(game_data_handlers::list_gems),
            )
            .route(
                "/api/consumables",
                web::get().to(game_data_handlers::list_consumables),
            )
            // Upgrade compare routes
            .route(
                "/api/upgrade-compare/prepare",
                web::post().to(upgrade_compare::get_upgrade_compare_prepare),
            )
            .route(
                "/api/upgrade-compare/sim",
                web::post().to(upgrade_compare::create_upgrade_compare_sim),
            )
            .route(
                "/api/upgrade-compare/combo-count",
                web::post().to(upgrade_compare::get_upgrade_compare_combo_count),
            )
            .route(
                "/api/upgrade-options",
                web::get().to(upgrade_compare::get_upgrade_options_handler),
            )
            // Job management routes
            .route("/api/sim/{id}", web::get().to(job_handlers::get_sim_status))
            .route(
                "/api/sim/{id}/logs",
                web::get().to(job_handlers::get_sim_logs),
            )
            .route(
                "/api/sim/{id}/cancel",
                web::post().to(job_handlers::cancel_sim),
            )
            .route(
                "/api/sim/{id}/input",
                web::get().to(job_handlers::get_sim_input),
            )
            .route(
                "/api/sim/{id}/raw",
                web::get().to(job_handlers::get_sim_raw),
            )
            .route(
                "/api/sim/{id}/html",
                web::get().to(job_handlers::get_sim_html),
            )
            .route(
                "/api/sim/{id}/output.txt",
                web::get().to(job_handlers::get_sim_text_output),
            )
            .route(
                "/api/sim/{id}/data.csv",
                web::get().to(job_handlers::get_sim_csv),
            )
            // Game data routes
            .route(
                "/api/item-names",
                web::get().to(game_data_handlers::get_item_names),
            )
            .route(
                "/api/item-info/{id}",
                web::get().to(game_data_handlers::get_item_info),
            )
            .route(
                "/api/item-info/batch",
                web::post().to(game_data_handlers::get_item_info_batch),
            )
            .route(
                "/api/enchant-info/{id}",
                web::get().to(game_data_handlers::get_enchant_info),
            )
            .route(
                "/api/gem-info/{id}",
                web::get().to(game_data_handlers::get_gem_info),
            )
            .route(
                "/api/max-upgrade-ilevels",
                web::post().to(game_data_handlers::get_max_upgrade_ilevels),
            )
            .route(
                "/api/upgrade-tracks",
                web::get().to(game_data_handlers::list_upgrade_tracks),
            )
            .route(
                "/api/gear/resolve",
                web::post().to(game_data_handlers::resolve_gear),
            )
            .route(
                "/api/gear/catalyst-convert",
                web::post().to(game_data_handlers::catalyst_convert),
            )
            .route(
                "/api/season-config",
                web::get().to(game_data_handlers::get_season_config),
            )
            .route(
                "/api/instances",
                web::get().to(game_data_handlers::list_instances),
            )
            .route(
                "/api/instances/type/{type}/drops",
                web::get().to(game_data_handlers::get_drops_by_type),
            )
            .route(
                "/api/instances/{id}/drops",
                web::get().to(game_data_handlers::get_instance_drops),
            )
            .route(
                "/api/talent-tree/{specId}",
                web::get().to(game_data_handlers::get_talent_tree),
            )
            // System routes
            .route("/api/config", web::get().to(get_config))
            .route("/health", web::get().to(health_check));

        #[cfg(feature = "desktop")]
        {
            app = app
                .route("/api/sims", web::get().to(job_handlers::list_sims))
                .route("/api/system-stats", web::get().to(system_stats));
        }
        #[cfg(not(feature = "desktop"))]
        {
            app = app.route("/api/sims", web::get().to(job_handlers::list_sims_filtered));
        }

        // Saved dungeon routes
        app = app
            .app_data(route_store_data.clone())
            .route("/api/routes", web::get().to(route_handlers::list_routes))
            .route("/api/routes", web::post().to(route_handlers::create_route))
            .route(
                "/api/routes/{id}",
                web::delete().to(route_handlers::delete_route),
            );

        // Saved characters and talent builds
        app = app
            .app_data(char_store_data.clone())
            .route(
                "/api/characters",
                web::get().to(character_handlers::list_characters),
            )
            .route(
                "/api/characters",
                web::post().to(character_handlers::upsert_character),
            )
            .route(
                "/api/characters/{id}",
                web::delete().to(character_handlers::delete_character),
            )
            .route(
                "/api/characters/{id}/talents",
                web::get().to(character_handlers::get_talent_builds),
            )
            .route(
                "/api/talent-builds/{id}",
                web::delete().to(character_handlers::delete_talent_build),
            );

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
                .default_service(web::get().to(spa_fallback));
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
