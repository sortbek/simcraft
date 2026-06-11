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
    #[serde(default)]
    pub map_id: Option<i64>,
    #[serde(default)]
    pub timer_max_seconds: Option<i64>,
    #[serde(default)]
    pub entrance: Option<MapPoint>,
    #[serde(default)]
    pub sublevel_links: Vec<SublevelLink>,
    /// Scale factor: MDT map units to in-game world yards.
    #[serde(default)]
    pub yards_per_unit: Option<f64>,
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

#[derive(Debug, Clone, Deserialize)]
pub struct MapPoint {
    pub x: f64,
    pub y: f64,
    pub sublevel: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SublevelLink {
    pub a: MapPoint,
    pub b: MapPoint,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_geometry_fields() {
        let json = r#"{
          "mdtVersion": "6.1.16",
          "dungeons": {
            "151": {
              "name": "Skyreach", "totalCount": 431, "sublevels": [{"index":1,"name":"Skyreach"}],
              "mapId": 161, "timerMaxSeconds": 1680,
              "entrance": {"x": 307.6, "y": -120.5, "sublevel": 1},
              "sublevelLinks": [{"a":{"x":1,"y":2,"sublevel":1},"b":{"x":3,"y":4,"sublevel":2}}],
              "yardsPerUnit": 0.55,
              "enemies": {}
            }
          }
        }"#;
        let db = DungeonDb::from_json(json).unwrap();
        let d = db.dungeon(151).unwrap();
        assert_eq!(d.map_id, Some(161));
        assert_eq!(d.timer_max_seconds, Some(1680));
        assert_eq!(d.entrance.as_ref().unwrap().sublevel, 1);
        assert_eq!(d.sublevel_links.len(), 1);
        assert_eq!(d.yards_per_unit, Some(0.55));
    }

    #[test]
    fn geometry_fields_default_when_absent() {
        // The existing Seat fixture has none of the new fields and must still load.
        let db = DungeonDb::from_json(include_str!("testdata/mdt_dungeons.json")).unwrap();
        let d = db.dungeon(11).unwrap();
        assert_eq!(d.map_id, None);
        assert!(d.sublevel_links.is_empty());
        assert_eq!(d.yards_per_unit, None);
    }
}
