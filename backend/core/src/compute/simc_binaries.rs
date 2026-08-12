//! On-disk registry of installed SimC binaries.
//!
//! Answers "which `simc` executable do I run for this branch?" — a compute
//! concern, not an HTTP one (nothing here touches actix). It lives under
//! `compute` so the providers that execute simulations don't have to reach up
//! into the `server` module for it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Holds all available simc binaries keyed by branch name ("weekly", "nightly").
pub struct SimcBinaries {
    pub bins: HashMap<String, PathBuf>,
    pub default_branch: String,
    /// Crate-visible so tests elsewhere can build a registry literal; the public
    /// read path is [`SimcBinaries::source_dir`].
    pub(crate) source_dir: Option<PathBuf>,
}

impl SimcBinaries {
    fn resolve_cached_or_live(&self, key: &str) -> Option<PathBuf> {
        self.bins
            .get(key)
            .or_else(|| {
                if let Some((prefix, _)) = key.split_once('-') {
                    self.bins.get(prefix)
                } else {
                    None
                }
            })
            .filter(|p| p.exists())
            .cloned()
            .or_else(|| self.resolve_from_source_dir(key))
    }

    fn read_runtime_default_key(&self) -> String {
        self.source_dir
            .as_ref()
            .and_then(|dir| {
                std::fs::read_to_string(dir.join(".active"))
                    .ok()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            })
            .unwrap_or_else(|| self.default_branch.clone())
    }

    fn fallback_default_binary(&self) -> Option<PathBuf> {
        self.resolve_cached_or_live("weekly")
            .or_else(|| self.resolve_cached_or_live("nightly"))
            .or_else(|| {
                let dir = self.source_dir.as_ref()?;
                let binary_name = if cfg!(windows) { "simc.exe" } else { "simc" };
                let mut newest: Option<(String, PathBuf)> = None;

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

                    match &newest {
                        Some((current_tag, _)) if tag <= *current_tag => {}
                        _ => newest = Some((tag, bin)),
                    }
                }

                newest.map(|(_, bin)| bin)
            })
            .or_else(|| self.bins.values().find(|p| p.exists()).cloned())
    }

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
    /// Falls back to live filesystem scan if the cached path is stale.
    pub fn resolve(&self, branch: &str) -> Result<PathBuf, String> {
        if branch.is_empty() {
            let key = self.read_runtime_default_key();
            return self
                .resolve_cached_or_live(&key)
                .or_else(|| {
                    key.split_once('-')
                        .and_then(|(prefix, _)| self.resolve_cached_or_live(prefix))
                })
                .or_else(|| self.fallback_default_binary())
                .ok_or_else(|| format!("SimC branch '{}' not available", key));
        }

        self.resolve_cached_or_live(branch)
            .ok_or_else(|| format!("SimC branch '{}' not available", branch))
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
                } else if tag.starts_with("source-") {
                    Some("source")
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
                "weekly" | "nightly" | "source" | "default" => Some(key.as_str()),
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
