use std::path::PathBuf;
use std::sync::Arc;

use simhammer_core::db;
use simhammer_core::game_data;
use simhammer_core::server;
use simhammer_core::server::SimcBinaries;

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

/// Return a display-safe version of a database URL (credentials removed).
fn redact_database_url(url: &str) -> String {
    if url.starts_with("sqlite:") || !url.contains("://") {
        return url.to_string();
    }
    // postgres://user:pass@host:5432/db -> postgres://***@host:5432/db
    if let Some(at_pos) = url.find('@') {
        if let Some(scheme_end) = url.find("://") {
            return format!("{}://***{}", &url[..scheme_end], &url[at_pos..]);
        }
    }
    url.to_string()
}

#[tokio::main]
async fn main() {
    db::init_limits();
    let desktop_mode = std::env::args().any(|a| a == "--desktop");

    let data_dir = PathBuf::from(env_or("DATA_DIR", "./resources/data"));
    let frontend_dir = std::env::var("FRONTEND_DIR").ok().map(PathBuf::from);

    // Build SimcBinaries: prefer SIMC_DIR (multi-branch), fall back to SIMC_PATH (single binary)
    let simc_bins = if let Ok(simc_dir) = std::env::var("SIMC_DIR") {
        let bins = SimcBinaries::from_dir(&PathBuf::from(&simc_dir));
        println!(
            "SimC binaries from {}: {:?} (default: {})",
            simc_dir,
            bins.available_branches(),
            bins.default_branch
        );
        Arc::new(bins)
    } else {
        let simc_path = PathBuf::from(env_or("SIMC_PATH", "/usr/local/bin/simc"));
        println!("SimC binary: {:?}", simc_path);
        Arc::new(SimcBinaries::from_single_path(simc_path))
    };

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
    if let Err(e) = game_data::load(&data_dir) {
        eprintln!("FATAL: failed to load game data: {}", e);
        std::process::exit(1);
    }

    // Database URL: auto-prefix sqlite:// if no scheme is present
    let db_url = env_or("DATABASE_URL", "simhammer.db");
    let database_url = if db_url.contains("://") {
        db_url.clone()
    } else {
        format!("sqlite://{}", db_url)
    };
    let database_backend = db::configured_backend(&database_url)
        .unwrap_or_else(|e| panic!("Invalid database configuration: {}", e));

    if desktop_mode {
        println!(
            "Starting SimHammer in desktop mode on {}:{}",
            bind_host, port
        );
    } else {
        println!("Starting SimHammer server on {}:{}", bind_host, port);
    }
    println!("Database backend: {}", database_backend.as_str());
    println!("Database: {}", redact_database_url(&database_url));

    server::start_server(
        &database_url,
        simc_bins,
        &bind_host,
        port,
        frontend_dir,
        Some(data_dir),
    )
    .await;

    // Keep the server running
    tokio::signal::ctrl_c().await.ok();
}

#[cfg(test)]
mod tests {
    use super::redact_database_url;

    #[test]
    fn leaves_sqlite_urls_unchanged() {
        assert_eq!(
            redact_database_url("sqlite://simhammer.db"),
            "sqlite://simhammer.db"
        );
        assert_eq!(redact_database_url("simhammer.db"), "simhammer.db");
    }

    #[test]
    fn redacts_network_database_credentials() {
        assert_eq!(
            redact_database_url("postgresql://user:secret@db.example.com:5432/simhammer"),
            "postgresql://***@db.example.com:5432/simhammer"
        );
    }

    #[test]
    fn leaves_network_urls_without_credentials_unchanged() {
        assert_eq!(
            redact_database_url("postgresql://db.example.com:5432/simhammer"),
            "postgresql://db.example.com:5432/simhammer"
        );
    }
}
