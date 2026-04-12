use actix_files::NamedFile;
use actix_web::{web, HttpRequest};

use super::types::FrontendDir;

/// Serve the appropriate HTML file for client-side frontend routes.
pub(super) async fn spa_fallback(
    req: HttpRequest,
    frontend_dir: web::Data<FrontendDir>,
) -> actix_web::Result<NamedFile> {
    let path = req.path();

    let trimmed = path.trim_start_matches('/');
    let html_path = frontend_dir.0.join(format!("{}.html", trimmed));
    if html_path.exists() {
        return Ok(NamedFile::open(html_path)?);
    }

    if path.starts_with("/sim/") {
        let sim_html = frontend_dir.0.join("sim").join("_.html");
        if sim_html.exists() {
            return Ok(NamedFile::open(sim_html)?);
        }
    }

    Ok(NamedFile::open(frontend_dir.0.join("index.html"))?)
}
