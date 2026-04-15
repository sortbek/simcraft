use actix_web::web;
use actix_web::HttpResponse;
use serde_json::json;
use std::collections::BTreeSet;
use std::sync::Arc;
#[cfg(feature = "desktop")]
use std::sync::Mutex;

use super::SimcBinaries;

use crate::db;

#[cfg(feature = "desktop")]
pub(super) struct SystemStats {
    sys: sysinfo::System,
}

#[cfg(feature = "desktop")]
impl SystemStats {
    pub(super) fn new() -> Self {
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

pub(super) async fn get_config() -> HttpResponse {
    let max_combos = db::MAX_COMBINATIONS.load(std::sync::atomic::Ordering::Relaxed);
    let mut config = json!({
        "max_scenarios": db::MAX_SCENARIOS.load(std::sync::atomic::Ordering::Relaxed),
    });
    if max_combos > 0 {
        config["max_combinations"] = json!(max_combos);
    }
    HttpResponse::Ok().json(config)
}

pub(super) async fn health_check() -> HttpResponse {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    HttpResponse::Ok().json(json!({
        "status": "ok",
        "threads": threads,
        "mode": "desktop",
    }))
}

pub(super) async fn get_branches(simc: web::Data<Arc<SimcBinaries>>) -> HttpResponse {
    HttpResponse::Ok().json(json!({
        "branches": simc.available_branches(),
        "default": normalized_branch_name(&simc.default_branch),
    }))
}

pub(super) async fn get_simc_versions(simc: web::Data<Arc<SimcBinaries>>) -> HttpResponse {
    let branches = configured_simc_branches(&simc);
    let mut versions = serde_json::Map::new();

    for branch in &branches {
        let tag = installed_tag_for_branch(&simc, branch);
        versions.insert(branch.to_string(), json!({ "tag": tag }));
    }

    HttpResponse::Ok().json(json!({
        "branches": branches,
        "default_branch": normalized_branch_name(&simc.default_branch),
        "versions": versions,
    }))
}

fn normalized_branch_name(branch: &str) -> String {
    match branch.split_once('-') {
        Some((prefix, _)) if matches!(prefix, "weekly" | "nightly" | "source") => {
            prefix.to_string()
        }
        _ => branch.to_string(),
    }
}

fn merge_simc_branches(simc: &SimcBinaries, enabled_branches: Option<&str>) -> Vec<String> {
    let mut branches = BTreeSet::new();

    for branch in simc.available_branches() {
        if branch != "default" {
            branches.insert(branch.to_string());
        }
    }

    if let Some(enabled) = enabled_branches {
        for branch in enabled.split(',').map(str::trim).filter(|b| !b.is_empty()) {
            if matches!(branch, "weekly" | "nightly" | "source") {
                branches.insert(branch.to_string());
            }
        }
    }

    if branches.is_empty() {
        branches.insert("weekly".to_string());
    }

    branches.into_iter().collect()
}

fn configured_simc_branches(simc: &SimcBinaries) -> Vec<String> {
    merge_simc_branches(simc, std::env::var("SIMC_ENABLED_BRANCHES").ok().as_deref())
}

/// Get the installed tag for a branch.
/// Tries .version file first, falls back to extracting the tag from the directory name.
fn installed_tag_for_branch(simc: &SimcBinaries, branch: &str) -> Option<String> {
    let bin_path = simc.resolve(branch).ok()?;
    // Verify the binary actually exists on disk (it may have been removed at runtime)
    if !bin_path.exists() {
        return None;
    }
    let parent = bin_path.parent()?;

    // Try .version file (Docker layout: weekly/.version)
    if let Some(tag) = std::fs::read_to_string(parent.join(".version"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        return Some(tag);
    }

    // Fall back to directory name (desktop layout: weekly-2026-04-12/)
    let dir_name = parent.file_name()?.to_str()?;
    if dir_name.starts_with(&format!("{}-", branch)) {
        return Some(dir_name.to_string());
    }

    None
}

fn platform_asset_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "simc-windows-x64.zip"
    } else if cfg!(target_os = "macos") {
        "simc-macos-arm64.tar.gz"
    } else {
        "simc-linux-x64.tar.gz"
    }
}

const SIMC_REPO: &str = "sortbek/simc-builds";

pub(super) async fn check_simc_updates(
    simc: web::Data<Arc<SimcBinaries>>,
) -> HttpResponse {
    let simc = simc.clone();
    let result = tokio::task::spawn_blocking(move || {
        check_updates_blocking(&simc)
    })
    .await;

    match result {
        Ok(Ok(updates)) => HttpResponse::Ok().json(updates),
        Ok(Err(e)) => HttpResponse::InternalServerError().json(json!({"detail": e})),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": format!("{}", e)})),
    }
}

fn check_updates_blocking(
    simc: &SimcBinaries,
) -> Result<serde_json::Value, String> {
    let asset_name = platform_asset_name();

    // Fetch tags from GitHub
    let tags_url = format!("https://api.github.com/repos/{}/tags?per_page=100", SIMC_REPO);
    let tags_resp: Vec<serde_json::Value> = ureq::get(&tags_url)
        .call()
        .map_err(|e| format!("Failed to fetch tags: {}", e))?
        .body_mut()
        .read_json()
        .map_err(|e| format!("Failed to parse tags: {}", e))?;

    let branches = configured_simc_branches(simc);
    let mut updates = Vec::new();

    for branch in &branches {
        let prefix = format!("{}-", branch);
        let latest_tag = match tags_resp.iter().find_map(|t| {
            let name = t["name"].as_str()?;
            if name.starts_with(&prefix) { Some(name.to_string()) } else { None }
        }) {
            Some(t) => t,
            None => continue,
        };

        // Get installed version
        let installed_tag = installed_tag_for_branch(simc, branch);
        let is_installed = installed_tag.as_deref() == Some(latest_tag.as_str());

        // Fetch release for asset URL
        let rel_url = format!(
            "https://api.github.com/repos/{}/releases/tags/{}",
            SIMC_REPO, latest_tag
        );
        let asset_url = ureq::get(&rel_url)
            .call()
            .ok()
            .and_then(|mut resp| resp.body_mut().read_json::<serde_json::Value>().ok())
            .and_then(|rel| {
                rel["assets"]
                    .as_array()?
                    .iter()
                    .find(|a| a["name"].as_str() == Some(asset_name))
                    .and_then(|a| a["browser_download_url"].as_str().map(String::from))
            })
            .unwrap_or_default();

        updates.push(json!({
            "branch": branch,
            "tag": latest_tag,
            "asset_url": asset_url,
            "installed": is_installed,
            "installed_tag": installed_tag,
        }));
    }

    Ok(json!({
        "updates": updates,
        "asset_name": asset_name,
    }))
}

#[cfg(test)]
mod tests {
    use super::{merge_simc_branches, normalized_branch_name};
    use crate::server::SimcBinaries;
    use std::collections::HashMap;
    use std::path::PathBuf;

    #[test]
    fn merges_enabled_and_installed_branches() {
        let mut bins = HashMap::new();
        bins.insert("weekly".to_string(), PathBuf::from("weekly/simc"));

        let simc = SimcBinaries {
            bins,
            default_branch: "weekly-2026-04-12".to_string(),
            source_dir: None,
        };

        let branches = merge_simc_branches(&simc, Some("weekly, nightly"));

        assert_eq!(branches, vec!["nightly".to_string(), "weekly".to_string()]);
    }

    #[test]
    fn normalizes_exact_default_branch_tags() {
        assert_eq!(normalized_branch_name("weekly-2026-04-12"), "weekly");
        assert_eq!(normalized_branch_name("nightly-2026-04-12"), "nightly");
        assert_eq!(normalized_branch_name("default"), "default");
    }
}

#[cfg(feature = "desktop")]
pub(super) async fn system_stats(stats: web::Data<Arc<Mutex<SystemStats>>>) -> HttpResponse {
    let mut s = stats.lock().unwrap();
    s.refresh();
    let cpu = s.cpu_usage();
    HttpResponse::Ok().json(json!({
        "cpu_usage": (cpu * 10.0).round() / 10.0,
    }))
}
