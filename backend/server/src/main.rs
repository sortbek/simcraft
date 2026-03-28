use std::path::PathBuf;
use std::sync::Arc;

use simhammer_core::game_data;
use simhammer_core::server;
use simhammer_core::storage::JobStorage;

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

#[tokio::main]
async fn main() {
    let desktop_mode = std::env::args().any(|a| a == "--desktop");

    let data_dir = PathBuf::from(env_or("DATA_DIR", "./resources/data"));
    let simc_path = PathBuf::from(env_or("SIMC_PATH", "/usr/local/bin/simc"));
    let frontend_dir = std::env::var("FRONTEND_DIR").ok().map(PathBuf::from);

    let bind_host = if desktop_mode {
        env_or("BIND_HOST", "127.0.0.1")
    } else {
        env_or("BIND_HOST", "0.0.0.0")
    };

    let port: u16 = if desktop_mode {
        env_or("PORT", "17384")
    } else {
        env_or("PORT", "8000")
    }
    .parse()
    .expect("PORT must be a number");

    println!("Loading game data from {:?}", data_dir);
    game_data::load(&data_dir);

    let storage: Arc<dyn JobStorage> = if desktop_mode {
        println!(
            "Starting SimHammer in desktop mode on {}:{}",
            bind_host, port
        );
        Arc::new(simhammer_core::storage::memory::MemoryStorage::new())
    } else {
        let db_url = env_or("DATABASE_URL", "simhammer.db");
        println!("Starting SimHammer server on {}:{}", bind_host, port);

        #[cfg(feature = "postgres")]
        if db_url.starts_with("postgres://") || db_url.starts_with("postgresql://") {
            println!("Using PostgreSQL storage");
            Arc::new(simhammer_core::storage::postgres::PostgresStorage::new(&db_url).await)
        } else {
            println!("Using SQLite storage: {}", db_url);
            Arc::new(simhammer_core::storage::sqlite::SqliteStorage::new(&db_url))
        }

        #[cfg(not(feature = "postgres"))]
        {
            println!("Using SQLite storage: {}", db_url);
            Arc::new(simhammer_core::storage::sqlite::SqliteStorage::new(&db_url))
        }
    };

    server::start_with_storage_bind(
        storage,
        simc_path,
        &bind_host,
        port,
        frontend_dir,
        Some(data_dir),
    )
    .await;

    // Keep the server running
    tokio::signal::ctrl_c().await.ok();
}
