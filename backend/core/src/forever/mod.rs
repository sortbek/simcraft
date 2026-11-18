//! WoW Forever: a second game, simmed by the `simhammer-forever` CLI (forever-builds), which
//! runs the MythicSim Forever engine.

pub mod data;
pub mod detect;
pub mod drops;
pub mod import;
pub mod report;
pub mod request;
pub mod result;
pub mod runner;
pub mod spec;
pub mod talents;

use std::path::{Path, PathBuf};
use std::sync::Arc;

pub use data::ForeverData;
pub use detect::{detect_game, Game};

const BINARY: &str = if cfg!(windows) {
    "simhammer-forever.exe"
} else {
    "simhammer-forever"
};

pub struct ForeverEngine {
    pub binary: PathBuf,
    pub data: ForeverData,
    /// The engine's `options` answers by request, so the same paste starts no new process.
    pub options: std::sync::Mutex<std::collections::HashMap<String, serde_json::Value>>,
}

impl ForeverEngine {
    /// `dir/.active` names the installed tag folder; without it `dir` is the install.
    pub fn locate(dir: &Path) -> Result<Self, String> {
        let base = match std::fs::read_to_string(dir.join(".active")) {
            Ok(tag) if !tag.trim().is_empty() => dir.join(tag.trim()),
            _ => dir.to_path_buf(),
        };
        let binary = base.join(BINARY);
        if !binary.is_file() {
            return Err(format!("{} not found", binary.display()));
        }
        Ok(Self {
            binary,
            data: ForeverData::load(&base.join("data"))?,
            options: Default::default(),
        })
    }
}

/// The engine install the server sims with. It is read again whenever the install changes (the
/// app or the container downloads a new release, or switches Forever off), so nothing restarts.
pub struct ForeverInstall {
    dir: Option<PathBuf>,
    /// The `.active` tag last loaded, and the engine, or None when that tag failed to load (so a
    /// broken release is not parsed again on every request).
    loaded: std::sync::Mutex<Option<(String, Option<Arc<ForeverEngine>>)>>,
}

impl ForeverInstall {
    pub fn new(dir: Option<PathBuf>) -> Self {
        Self {
            dir,
            loaded: std::sync::Mutex::new(None),
        }
    }

    pub fn from_env() -> Self {
        let install = Self::new(std::env::var("FOREVER_DIR").ok().map(PathBuf::from));
        install.get();
        install
    }

    /// The installed engine, or None without one or with Forever switched off (`.disabled`).
    pub fn get(&self) -> Option<Arc<ForeverEngine>> {
        let dir = self.dir.as_ref()?;
        if dir.join(".disabled").exists() {
            return None;
        }
        let tag = std::fs::read_to_string(dir.join(".active"))
            .map(|t| t.trim().to_string())
            .unwrap_or_default();
        let mut loaded = self.loaded.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((current, engine)) = loaded.as_ref() {
            if *current == tag {
                return engine.clone();
            }
        }
        match ForeverEngine::locate(dir) {
            Ok(engine) => {
                println!(
                    "Forever engine {} (client {}) from {}",
                    engine.data.version.engine_commit,
                    engine.data.version.client_build,
                    dir.display()
                );
                let engine = Arc::new(engine);
                *loaded = Some((tag, Some(engine.clone())));
                Some(engine)
            }
            Err(e) => {
                eprintln!("Forever engine unavailable: {e}");
                // Remembered only when the binary is there and its data would not parse: the
                // installer puts a missing binary back under the same tag.
                let parsed = !tag.is_empty() && dir.join(&tag).join(BINARY).is_file();
                *loaded = parsed.then_some((tag, None));
                None
            }
        }
    }
}

#[cfg(test)]
pub(crate) fn test_data() -> &'static ForeverData {
    use once_cell::sync::Lazy;
    static DATA: Lazy<ForeverData> = Lazy::new(|| {
        ForeverData::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src/forever/testdata/data"))
            .expect("forever test bundle")
    });
    &DATA
}

#[cfg(test)]
mod install_tests {
    use super::*;

    fn install_at(root: &Path, tag: &str) {
        let dir = root.join(tag);
        std::fs::create_dir_all(dir.join("data")).unwrap();
        let name = if cfg!(windows) {
            "simhammer-forever.exe"
        } else {
            "simhammer-forever"
        };
        std::fs::write(dir.join(name), "").unwrap();
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/forever/testdata/data");
        for entry in std::fs::read_dir(source).unwrap() {
            let entry = entry.unwrap();
            std::fs::copy(entry.path(), dir.join("data").join(entry.file_name())).unwrap();
        }
        std::fs::write(root.join(".active"), tag).unwrap();
    }

    #[test]
    fn the_install_follows_what_is_on_disk() {
        let root = tempfile::tempdir().unwrap();
        let install = ForeverInstall::new(Some(root.path().to_path_buf()));
        assert!(install.get().is_none(), "nothing installed yet");

        install_at(root.path(), "forever-20261101-aaaaaaa");
        let first = install.get().expect("picked up without a restart");
        assert!(
            Arc::ptr_eq(&first, &install.get().unwrap()),
            "kept while nothing changes"
        );

        install_at(root.path(), "forever-20261102-bbbbbbb");
        assert!(
            !Arc::ptr_eq(&first, &install.get().unwrap()),
            "a new release is loaded"
        );

        std::fs::write(root.path().join(".disabled"), "").unwrap();
        assert!(install.get().is_none(), "switched off");
        std::fs::remove_file(root.path().join(".disabled")).unwrap();
        assert!(install.get().is_some());

        std::fs::write(root.path().join(".active"), "forever-20261103-missing").unwrap();
        assert!(install.get().is_none(), "an install that is not there");
    }

    #[test]
    fn a_release_that_fails_to_load_is_not_read_again() {
        let root = tempfile::tempdir().unwrap();
        let install = ForeverInstall::new(Some(root.path().to_path_buf()));
        install_at(root.path(), "forever-20261101-broken");
        let items = root.path().join("forever-20261101-broken/data/items.json");
        let good = std::fs::read(&items).unwrap();
        std::fs::write(&items, "not json").unwrap();
        assert!(install.get().is_none());
        // Repaired in place, same tag: still the failure it remembered, no second parse.
        std::fs::write(&items, good).unwrap();
        assert!(install.get().is_none());
        install_at(root.path(), "forever-20261102-fixed");
        assert!(install.get().is_some(), "the next release loads");

        // A binary missing is retried: the installer puts it back under the same tag.
        install_at(root.path(), "forever-20261103-gone");
        std::fs::remove_file(root.path().join("forever-20261103-gone").join(BINARY)).unwrap();
        assert!(install.get().is_none());
        std::fs::write(root.path().join("forever-20261103-gone").join(BINARY), "").unwrap();
        assert!(install.get().is_some(), "picked up once the binary is back");
    }

    #[test]
    fn no_folder_configured_means_no_engine() {
        assert!(ForeverInstall::new(None).get().is_none());
    }
}
