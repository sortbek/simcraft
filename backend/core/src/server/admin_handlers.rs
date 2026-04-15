use actix_web::{web, HttpRequest, HttpResponse};
use flate2::read::GzDecoder;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs::File;
use std::io::{self, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tar::Archive;
use zip::ZipArchive;

use super::SimcBinaries;
use crate::db;
use crate::db::SettingsRepo;

pub(super) struct AdminSecret(pub String);

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: usize,
}

#[derive(Deserialize)]
pub(super) struct LoginRequest {
    password: String,
}

fn validate_token(req: &HttpRequest, secret: &AdminSecret) -> Result<(), HttpResponse> {
    let header = req
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| HttpResponse::Unauthorized().json(json!({"detail": "Missing token"})))?;

    let token = header
        .strip_prefix("Bearer ")
        .ok_or_else(|| HttpResponse::Unauthorized().json(json!({"detail": "Invalid header"})))?;

    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.0.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| {
        HttpResponse::Unauthorized().json(json!({"detail": "Invalid or expired token"}))
    })?;

    Ok(())
}

pub(super) async fn login(
    body: web::Json<LoginRequest>,
    secret: web::Data<AdminSecret>,
) -> HttpResponse {
    let admin_pw =
        match std::env::var("ADMIN_PASSWORD") {
            Ok(pw) if !pw.is_empty() => pw,
            _ => return HttpResponse::Forbidden().json(json!({
                "detail": "Admin panel is not configured. Set ADMIN_PASSWORD environment variable."
            })),
        };

    if body.password != admin_pw {
        return HttpResponse::Unauthorized().json(json!({"detail": "Invalid password"}));
    }

    let exp = chrono::Utc::now().timestamp() as usize + 86400; // 24h
    let claims = Claims {
        sub: "admin".to_string(),
        exp,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.0.as_bytes()),
    )
    .unwrap();

    HttpResponse::Ok().json(json!({"token": token}))
}

pub(super) async fn check_auth(req: HttpRequest, secret: web::Data<AdminSecret>) -> HttpResponse {
    match validate_token(&req, &secret) {
        Ok(_) => HttpResponse::Ok().json(json!({"valid": true})),
        Err(resp) => resp,
    }
}

pub(super) async fn get_settings(
    req: HttpRequest,
    secret: web::Data<AdminSecret>,
    settings: web::Data<SettingsRepo>,
) -> HttpResponse {
    if let Err(resp) = validate_token(&req, &secret) {
        return resp;
    }

    let stored = match settings.get_all().await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to read admin settings: {}", e);
            return HttpResponse::InternalServerError()
                .json(json!({"detail": "Failed to read settings from database"}));
        }
    };

    HttpResponse::Ok().json(json!({
        "settings": {
            "max_combinations": stored.get("max_combinations")
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(db::MAX_COMBINATIONS.load(Ordering::Relaxed)),
            "max_scenarios": stored.get("max_scenarios")
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(db::MAX_SCENARIOS.load(Ordering::Relaxed)),
        },
        "env": {
            "simc_enabled_branches": std::env::var("SIMC_ENABLED_BRANCHES").unwrap_or_else(|_| "weekly".into()),
            "simc_check_interval": std::env::var("SIMC_CHECK_INTERVAL").unwrap_or_else(|_| "3600".into()),
        }
    }))
}

#[derive(Deserialize)]
pub(super) struct UpdateSettingsRequest {
    max_combinations: Option<usize>,
    max_scenarios: Option<usize>,
}

pub(super) async fn update_settings(
    req: HttpRequest,
    secret: web::Data<AdminSecret>,
    settings: web::Data<SettingsRepo>,
    body: web::Json<UpdateSettingsRequest>,
) -> HttpResponse {
    if let Err(resp) = validate_token(&req, &secret) {
        return resp;
    }

    let mut updated = Vec::new();

    if let Some(val) = body.max_combinations {
        if let Err(e) = settings.set("max_combinations", &val.to_string()).await {
            eprintln!("Failed to persist max_combinations: {}", e);
            return HttpResponse::InternalServerError()
                .json(json!({"detail": "Failed to save max_combinations"}));
        }
        db::MAX_COMBINATIONS.store(val, Ordering::Relaxed);
        updated.push("max_combinations");
    }
    if let Some(val) = body.max_scenarios {
        if let Err(e) = settings.set("max_scenarios", &val.to_string()).await {
            eprintln!("Failed to persist max_scenarios: {}", e);
            return HttpResponse::InternalServerError()
                .json(json!({"detail": "Failed to save max_scenarios"}));
        }
        db::MAX_SCENARIOS.store(val, Ordering::Relaxed);
        updated.push("max_scenarios");
    }

    HttpResponse::Ok().json(json!({
        "updated": updated,
    }))
}

#[derive(Deserialize)]
pub(super) struct InstallSimcRequest {
    tag: String,
    asset_url: String,
}

pub(super) async fn install_simc_version(
    req: HttpRequest,
    secret: web::Data<AdminSecret>,
    simc: web::Data<Arc<SimcBinaries>>,
    body: web::Json<InstallSimcRequest>,
) -> HttpResponse {
    if let Err(resp) = validate_token(&req, &secret) {
        return resp;
    }

    let simc_dir = match simc.source_dir() {
        Some(dir) => dir.clone(),
        None => {
            return HttpResponse::BadRequest().json(json!({"detail": "SIMC_DIR not configured"}))
        }
    };

    // Determine branch from tag (e.g., "weekly-2026-04-12" -> "weekly")
    let branch = match body.tag.split_once('-') {
        Some((prefix, _)) if matches!(prefix, "weekly" | "nightly") => prefix.to_string(),
        _ => return HttpResponse::BadRequest().json(json!({"detail": "Invalid tag format"})),
    };

    let branch_dir = simc_dir.join(&branch);
    let tag = body.tag.clone();
    let asset_url = body.asset_url.clone();

    // Run download in a blocking task to avoid tying up the async runtime
    let result =
        tokio::task::spawn_blocking(move || download_simc(&branch_dir, &tag, &asset_url)).await;

    match result {
        Ok(Ok(())) => HttpResponse::Ok().json(json!({
            "success": true,
            "branch": branch,
            "tag": body.tag,
        })),
        Ok(Err(e)) => HttpResponse::InternalServerError().json(json!({
            "success": false,
            "detail": e,
        })),
        Err(e) => HttpResponse::InternalServerError().json(json!({
            "success": false,
            "detail": format!("Task failed: {}", e),
        })),
    }
}

pub(super) async fn remove_simc_version(
    req: HttpRequest,
    secret: web::Data<AdminSecret>,
    simc: web::Data<Arc<SimcBinaries>>,
    path: web::Path<String>,
) -> HttpResponse {
    if let Err(resp) = validate_token(&req, &secret) {
        return resp;
    }

    let branch = path.into_inner();
    if !matches!(branch.as_str(), "weekly" | "nightly") {
        return HttpResponse::BadRequest().json(json!({"detail": "Invalid branch"}));
    }

    let simc_dir = match simc.source_dir() {
        Some(dir) => dir.clone(),
        None => {
            return HttpResponse::BadRequest().json(json!({"detail": "SIMC_DIR not configured"}))
        }
    };

    // Find the actual directory (could be "weekly/" or "weekly-2026-04-12/")
    let bin_path = match simc.resolve(&branch) {
        Ok(p) => p,
        Err(_) => return HttpResponse::NotFound().json(json!({"detail": "Branch not installed"})),
    };

    let branch_dir = match bin_path.parent() {
        Some(dir) if dir.starts_with(&simc_dir) => dir.to_path_buf(),
        _ => return HttpResponse::BadRequest().json(json!({"detail": "Invalid binary path"})),
    };

    match std::fs::remove_dir_all(&branch_dir) {
        Ok(_) => HttpResponse::Ok().json(json!({"success": true, "branch": branch})),
        Err(e) => HttpResponse::InternalServerError().json(json!({
            "success": false,
            "detail": format!("Failed to remove: {}", e),
        })),
    }
}

fn download_simc(branch_dir: &PathBuf, tag: &str, asset_url: &str) -> Result<(), String> {
    if branch_dir.exists() {
        std::fs::remove_dir_all(branch_dir)
            .map_err(|e| format!("Failed to clear existing installation: {}", e))?;
    }
    std::fs::create_dir_all(branch_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let tmp =
        tempfile::NamedTempFile::new().map_err(|e| format!("Failed to create temp file: {}", e))?;
    let tmp_path = tmp.path().to_path_buf();

    download_to_file(&tmp_path, asset_url)?;

    extract_archive(&tmp_path, branch_dir, asset_url)?;

    // chmod +x
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let bin = branch_dir.join("simc");
        if bin.exists() {
            let _ = std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755));
        }
    }

    // Write version
    std::fs::write(branch_dir.join(".version"), tag)
        .map_err(|e| format!("Failed to write version: {}", e))?;

    Ok(())
}

fn download_to_file(path: &Path, asset_url: &str) -> Result<(), String> {
    let mut response = ureq::get(asset_url)
        .call()
        .map_err(|e| format!("Download failed: {}", e))?;

    let mut reader = response.body_mut().as_reader();
    let file = File::create(path).map_err(|e| format!("Failed to create archive file: {}", e))?;
    let mut writer = BufWriter::new(file);

    io::copy(&mut reader, &mut writer).map_err(|e| format!("Failed to write archive: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("Failed to flush archive: {}", e))?;
    Ok(())
}

fn extract_archive(path: &Path, dest_dir: &Path, asset_url: &str) -> Result<(), String> {
    if asset_url.ends_with(".zip") {
        extract_zip(path, dest_dir)
    } else if asset_url.ends_with(".tar.gz") || asset_url.ends_with(".tgz") {
        extract_tar_gz(path, dest_dir)
    } else {
        Err(format!("Unsupported archive type for '{}'", asset_url))
    }
}

fn extract_tar_gz(path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = File::open(path).map_err(|e| format!("Failed to open archive: {}", e))?;
    let reader = BufReader::new(file);
    let decoder = GzDecoder::new(reader);
    let mut archive = Archive::new(decoder);
    archive
        .unpack(dest_dir)
        .map_err(|e| format!("Extract failed: {}", e))
}

fn extract_zip(path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = File::open(path).map_err(|e| format!("Failed to open archive: {}", e))?;
    let reader = BufReader::new(file);
    let mut archive = ZipArchive::new(reader).map_err(|e| format!("Invalid zip archive: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;
        let Some(relative_path) = entry.enclosed_name().map(|p| p.to_owned()) else {
            continue;
        };
        let out_path = dest_dir.join(relative_path);

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        let out_file = File::create(&out_path)
            .map_err(|e| format!("Failed to create extracted file: {}", e))?;
        let mut writer = BufWriter::new(out_file);
        io::copy(&mut entry, &mut writer)
            .map_err(|e| format!("Failed to extract zip entry: {}", e))?;
        writer
            .flush()
            .map_err(|e| format!("Failed to flush extracted file: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{extract_archive, extract_tar_gz, extract_zip};
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::fs;
    use std::io::Write;
    use tar::Builder;
    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;

    #[test]
    fn extracts_zip_archives() {
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("simc.zip");
        let out_dir = temp.path().join("out");

        {
            let file = std::fs::File::create(&archive_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            zip.start_file("simc.exe", SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"fake-windows-binary").unwrap();
            zip.finish().unwrap();
        }

        extract_zip(&archive_path, &out_dir).unwrap();

        assert_eq!(
            fs::read(out_dir.join("simc.exe")).unwrap(),
            b"fake-windows-binary"
        );
    }

    #[test]
    fn extracts_tar_gz_archives() {
        let temp = tempdir().unwrap();
        let archive_path = temp.path().join("simc.tar.gz");
        let out_dir = temp.path().join("out");

        {
            let file = std::fs::File::create(&archive_path).unwrap();
            let encoder = GzEncoder::new(file, Compression::default());
            let mut builder = Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            let payload = b"fake-linux-binary";
            header.set_size(payload.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            builder
                .append_data(&mut header, "simc", &payload[..])
                .unwrap();
            builder.finish().unwrap();
        }

        extract_tar_gz(&archive_path, &out_dir).unwrap();

        assert_eq!(
            fs::read(out_dir.join("simc")).unwrap(),
            b"fake-linux-binary"
        );
    }

    #[test]
    fn routes_archive_extraction_by_extension() {
        let temp = tempdir().unwrap();
        let zip_path = temp.path().join("simc.zip");
        let zip_out = temp.path().join("zip-out");

        {
            let file = std::fs::File::create(&zip_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            zip.start_file("simc.exe", SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"zip-binary").unwrap();
            zip.finish().unwrap();
        }

        extract_archive(
            &zip_path,
            &zip_out,
            "https://example.com/simc-windows-x64.zip",
        )
        .unwrap();
        assert_eq!(fs::read(zip_out.join("simc.exe")).unwrap(), b"zip-binary");
    }
}
