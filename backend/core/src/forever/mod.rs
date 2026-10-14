//! WoW Forever: a second game, simmed by the wowsims-based `simhammer-forever` CLI.

pub mod data;
pub mod detect;

use std::path::{Path, PathBuf};
use std::sync::Arc;

pub use data::ForeverData;
pub use detect::{detect_game, Game};

pub struct ForeverEngine {
    pub binary: PathBuf,
    pub data: ForeverData,
}

impl ForeverEngine {
    /// `dir/.active` names the installed tag folder; without it `dir` is the install.
    pub fn locate(dir: &Path) -> Result<Self, String> {
        let base = match std::fs::read_to_string(dir.join(".active")) {
            Ok(tag) if !tag.trim().is_empty() => dir.join(tag.trim()),
            _ => dir.to_path_buf(),
        };
        let name = if cfg!(windows) { "simhammer-forever.exe" } else { "simhammer-forever" };
        let binary = base.join(name);
        if !binary.is_file() {
            return Err(format!("{} not found", binary.display()));
        }
        Ok(Self {
            binary,
            data: ForeverData::load(&base.join("data"))?,
        })
    }

    pub fn from_env() -> Option<Arc<Self>> {
        let dir = std::env::var("FOREVER_DIR").ok()?;
        match Self::locate(Path::new(&dir)) {
            Ok(engine) => {
                println!(
                    "Forever engine {} (client {}) from {}",
                    engine.data.version.engine_commit, engine.data.version.client_build, dir
                );
                Some(Arc::new(engine))
            }
            Err(e) => {
                eprintln!("Forever engine unavailable: {e}");
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
