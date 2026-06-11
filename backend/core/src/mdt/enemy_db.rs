//! Static MDT enemy database, produced by
//! `backend/scripts/extract_mdt_dungeons.py` from the MythicDungeonTools addon.
//!
//! Keyed by MDT dungeon index, then enemy index. Supplies the NPC id, base
//! health, forces count and creature type that the export string does not carry.

use once_cell::sync::OnceCell;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

/// Process-wide database, populated once at startup by [`load`].
static DUNGEON_DB: OnceCell<DungeonDb> = OnceCell::new();

#[derive(Debug, Clone, Default)]
pub struct DungeonDb {
    /// MDT addon version the data was extracted from (`""` if unknown).
    mdt_version: String,
    dungeons: HashMap<i64, Dungeon>,
}

/// On-disk shape of `mdt_dungeons.json`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DbFile {
    #[serde(default)]
    mdt_version: String,
    dungeons: HashMap<i64, Dungeon>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dungeon {
    pub name: String,
    pub total_count: i64,
    pub sublevels: Vec<Sublevel>,
    pub enemies: HashMap<i64, Enemy>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Sublevel {
    pub index: i64,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Enemy {
    pub id: i64,
    pub name: String,
    pub count: i64,
    pub health: i64,
    pub creature_type: String,
    pub is_boss: bool,
    pub ignore_fortified: bool,
    pub scale: f64,
    /// Per-clone map positions, keyed by clone index (matches the route's clone refs).
    pub clones: HashMap<i64, ClonePos>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClonePos {
    pub x: f64,
    pub y: f64,
    pub sublevel: i64,
    /// Patrol waypoints (MDT base coords), in order. Empty for stationary mobs.
    #[serde(default)]
    pub patrol: Vec<Point>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl DungeonDb {
    pub fn from_json(json: &str) -> Result<Self, String> {
        let file: DbFile = serde_json::from_str(json)
            .map_err(|e| format!("invalid MDT dungeon database: {e}"))?;
        Ok(Self {
            mdt_version: file.mdt_version,
            dungeons: file.dungeons,
        })
    }

    /// MDT addon version the data was extracted from (`""` if unknown).
    pub fn mdt_version(&self) -> &str {
        &self.mdt_version
    }

    pub fn dungeon(&self, idx: i64) -> Option<&Dungeon> {
        self.dungeons.get(&idx)
    }

    pub fn is_empty(&self) -> bool {
        self.dungeons.is_empty()
    }
}

/// Load `mdt_dungeons.json` from the data directory into the process-wide
/// database. The file is optional — if it is absent the database stays empty
/// and conversions report the dungeon as unknown rather than failing startup.
pub fn load(data_dir: &Path) -> Result<(), String> {
    let path = data_dir.join("mdt_dungeons.json");
    let db = match std::fs::read_to_string(&path) {
        Ok(json) => DungeonDb::from_json(&json)?,
        Err(_) => DungeonDb::default(),
    };
    let _ = DUNGEON_DB.set(db);
    Ok(())
}

/// The process-wide database, if [`load`] has run.
pub fn global() -> Option<&'static DungeonDb> {
    DUNGEON_DB.get()
}
