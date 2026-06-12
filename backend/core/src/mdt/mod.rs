//! Decode Mythic Dungeon Tools (MDT) export strings.
//!
//! Pipeline (reverse of MDT's `TableToString`):
//!   strip leading "!" -> DecodeForPrint -> raw DEFLATE inflate
//!   -> AceSerializer deserialize -> typed [`MdtRoute`]
//!
//! Only modern (`!`-prefixed) strings are supported; the legacy WeakAuras-B64 +
//! LibCompress format is intentionally not implemented.

mod ace;
pub mod enemy_db;
mod generate;
mod health_scaling;
mod model;
mod print_decode;
mod travel;

pub use enemy_db::DungeonDb;
pub use generate::MdtSimc;
pub use model::{MdtPull, MdtPullEnemy, MdtRoute};

use std::io::Read;

/// Decode an MDT export string into a typed route.
pub fn decode(import: &str) -> Result<MdtRoute, String> {
    let trimmed = import.trim();
    let body = trimmed
        .strip_prefix('!')
        .ok_or("not a modern MDT string (expected leading '!')")?;

    let compressed = print_decode::decode_for_print(body);
    let serialized = inflate_raw(&compressed)?;
    let serialized = String::from_utf8(serialized)
        .map_err(|_| "decompressed payload is not valid UTF-8".to_string())?;
    let value = ace::deserialize(&serialized)?;
    model::parse_route(&value)
}

/// Caller-supplied conversion parameters.
pub struct ConvertOptions {
    /// Keystone level to scale health to. `None` uses the string's `difficulty`.
    pub keystone_level: Option<i64>,
    /// Percentage of full enemy HP to sim (1–100). keystone.guru default: 20.
    pub hp_percent: i64,
}

impl Default for ConvertOptions {
    fn default() -> Self {
        Self { keystone_level: None, hp_percent: 20 }
    }
}

/// Decode an MDT export string and convert it to a SimC `DungeonRoute` fight
/// definition using the static enemy database.
pub fn convert(import: &str, db: &DungeonDb, opts: &ConvertOptions) -> Result<MdtSimc, String> {
    let route = decode(import)?;
    generate::generate(&route, db, opts)
}

/// Build a dungeon overview — the full mob layer with no pulls — for browsing a
/// dungeon's map and enemies without an imported route.
pub fn overview(dungeon_idx: i64, db: &DungeonDb, opts: &ConvertOptions) -> Result<MdtSimc, String> {
    let route = MdtRoute {
        dungeon_idx,
        week: 0,
        keystone_level: opts.keystone_level.unwrap_or(0),
        text: String::new(),
        lines: Vec::new(),
        pulls: Vec::new(),
    };
    generate::generate(&route, db, opts)
}

/// Re-serialize an edited pull assignment — clone `(enemy_idx, clone_idx)`
/// references grouped per pull — into a SimC `DungeonRoute` with travel-time
/// delays. Used to save/sim routes built or edited on the map (no MDT string).
/// No drawn line is involved, so delays use the straight-line estimate.
pub fn serialize(
    dungeon_idx: i64,
    pulls: Vec<Vec<(i64, i64)>>,
    db: &DungeonDb,
    opts: &ConvertOptions,
) -> Result<MdtSimc, String> {
    let pulls = pulls
        .into_iter()
        .map(|clones| {
            // Group clone indices by enemy index, preserving first-seen order.
            let mut by_enemy: Vec<(i64, Vec<i64>)> = Vec::new();
            for (enemy_idx, clone_idx) in clones {
                match by_enemy.iter_mut().find(|(e, _)| *e == enemy_idx) {
                    Some((_, cis)) => cis.push(clone_idx),
                    None => by_enemy.push((enemy_idx, vec![clone_idx])),
                }
            }
            MdtPull {
                enemies: by_enemy
                    .into_iter()
                    .map(|(enemy_idx, clone_indices)| MdtPullEnemy { enemy_idx, clone_indices })
                    .collect(),
                color: None,
            }
        })
        .collect();
    let route = MdtRoute {
        dungeon_idx,
        week: 0,
        keystone_level: opts.keystone_level.unwrap_or(0),
        text: String::new(),
        lines: Vec::new(),
        pulls,
    };
    generate::generate(&route, db, opts)
}

/// Raw DEFLATE inflate (no zlib/gzip header), matching LibDeflate's
/// `CompressDeflate`.
fn inflate_raw(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = flate2::read::DeflateDecoder::new(data);
    let mut out = Vec::new();
    decoder
        .read_to_end(&mut out)
        .map_err(|e| format!("DEFLATE inflate failed: {e}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    // A real MDT export string (provided as the worked example).
    const EXAMPLE: &str = "!DAvYooUnq0pN5sAbtTRCljdsJobWtNrZG5MGOfPSzmTKHev72x03EkUOD6oibgGwSkwBVAHmdL9TS06d)nTq0cFUh5StsHm89Ep5IRCzAR6lFy5xZ2ha)LEWpbx4NTpuY4Py5AKITilLpOQuxVDoXALL(KNNRdsRVux3yjdFnd)DgTAihorostojBFSHyKty2(KrYODZPJmMf5ebBm2niYb8uK3Cw(lyPnUxO0)qgRh67ea7IMZkEblTtarfSXD3mwc4NkO)VJRKe0UIY)DCv5pUd2Cav9cCsgr1qj2RCfpTRubQzYFsrrbtjhFimsEKt9Tt0(8swtROp)AhN3NZQ6ZtPyypRTpVOUQLrOnusFUqE2t4gcvEArdU90CHuSjDvhP1WUR11CjnPsAP4wjnshCcr9GMO43UdeXxWhHThRzvh7ZR7aDxxnEkALG1iz3u3D1Pp)xieMGvxH587)eCgC1zPBIR(eixdvsUp)mtaICGwG7AHpQlnk7RuoOpoTfe51UM2ogiubesshqCsg0QZLEctQVDSdI1(8F7e(YvMgU9Tc3((7K1AA42n(ry9lGBCVURp)gUsObIl4Z0busJK03Oas1IlPnq4rgGbXn4RNBWvKbV7PFa4hTbeKJL5Jwwvbvg6CUcibXUaMIjvQbhuA6qTm6LgV9k(gylLoLgcdsxvxC(aU4SmhyeqH8QWhkujSYswrhxC3eV3O0ZMpFdZ7Os4PORPbW5pRRfEH8(q3BlG)fYShCkX45EfcCdskO0lG3NTx1Z1WkfFPSSLQgNbciHOzt2M)NcP19GsWwyMkmW1DCXBCXFCjyCj0iR))tz1lrkTKwuZRBYsll9OLLtdow42rwmyIHwWmAEgAHRCSjZinscDAOWcZylUITygxlMbT0mUbiuXuZGEo68ZAdWeMX5pqN0edcz8f3nhD)JZMRJlLZBghBGx7Pt0Q0u5bpf(fU1jCTGviB2oEs7jwWsVnPmTjJ2AsplM03Ik9TvYUBksrBHGGrUHBQu1LqXBlH82Qh0Sl(miKTA2fE2uFQBWgWqxeKSfm8TagrBlmI26ebwGS19NjMe)yjkYsA2snP7hvsp00pOSWh2MmL)xXCz1cgnuTm4lHFqoDHkd3cviBtE8MQB8qpyi2WC11L1AX83A8G1m9w3SABi2GFToVP1u8OvtgNeRYElRD)G5rZdmdQou2SOjFsd20VTgs0eiIE0CUbbsSuOf)bfkBgwnDnAA3bo86b(yLOG(oS(63F(PFVHrRi87)m8eiS85CoV8LpbVc4hWL3Y3l9v4vx0S0leM867Ygk9unN8hWlYOKSdtum3sFGESJXv3tBmvhJaVLSCN3F95ZV)(F(mql7Faa";

    #[test]
    fn decodes_example_string() {
        // Proves the full DecodeForPrint -> inflate -> AceSerializer -> model
        // pipeline against a real MDT export string.
        let route = decode(EXAMPLE).expect("decode example MDT string");
        assert_eq!(route.dungeon_idx, 11);
        assert_eq!(route.week, 2);
        assert_eq!(route.keystone_level, 2);
        assert_eq!(route.pulls.len(), 16);

        // First pull: enemy indices 1, 13, 14 (the "color" metadata key is
        // ignored), enemy 1 carrying two clone indices.
        let first = &route.pulls[0];
        let enemy_idxs: Vec<i64> = first.enemies.iter().map(|e| e.enemy_idx).collect();
        assert_eq!(enemy_idxs, vec![1, 13, 14]);
        assert_eq!(first.enemies[0].clone_indices.len(), 2);
    }

    fn load_db() -> DungeonDb {
        // Committed fixture (the runtime mdt_dungeons.json lives under the
        // gitignored resources/data and is produced by the extraction script).
        DungeonDb::from_json(include_str!("testdata/mdt_dungeons.json")).unwrap()
    }

    #[test]
    fn overview_has_all_enemies_no_pulls() {
        let db = load_db();
        let out = overview(11, &db, &ConvertOptions::default()).unwrap();
        assert_eq!(out.dungeon_name, "Seat of the Triumvirate");
        assert_eq!(out.pull_count, 0);
        assert!(out.map.pulls.is_empty());
        assert!(!out.map.enemies.is_empty(), "full mob layer present");
        assert!(
            out.map.enemies.iter().all(|e| e.pull.is_none()),
            "no enemy is pulled in an overview"
        );
    }

    #[test]
    fn serialize_builds_route_from_clone_refs() {
        // Seat enemy 1 (Merciless Subjugator) has clones 1 and 2; one pull of both.
        let opts = ConvertOptions { keystone_level: Some(10), hp_percent: 100 };
        let out = serialize(11, vec![vec![(1, 1), (1, 2)]], &load_db(), &opts).unwrap();
        assert_eq!(out.pull_count, 1);
        assert_eq!(out.keystone_level, 10);
        let pull1 = out
            .simc
            .lines()
            .find(|l| l.starts_with("raid_events+=/pull,pull=01,"))
            .unwrap();
        assert_eq!(pull1.matches("\"merciless-subjugator_").count(), 2);
    }

    #[test]
    fn season_dungeons_lists_timered_dungeons() {
        // The Seat fixture carries a keystone timer, so it is a season dungeon.
        let list = load_db().season_dungeons();
        assert!(list
            .iter()
            .any(|(idx, name)| *idx == 11 && name == "Seat of the Triumvirate"));
    }

    // A real keystone.guru Skyreach weekly-route MDT string, plus the matching
    // Skyreach (idx 151) fixture carrying the travel geometry (entrance,
    // yards_per_unit). Used to sanity-check the travel-time delay estimate.
    const SKYREACH_ROUTE: &str = include_str!("testdata/skyreach_route.txt");

    fn load_skyreach_db() -> DungeonDb {
        DungeonDb::from_json(include_str!("testdata/skyreach.json")).unwrap()
    }

    #[test]
    fn skyreach_delays_are_plausible() {
        // The route carries no drawn line, so delays are the straight-line
        // centroid estimate (yards_per_unit 0.55 / 7 yd/s). We assert plausibility,
        // NOT an exact match to keystone.guru's path-based reference (~114s total):
        // those per-pull values come from the drawn route line, which this string
        // does not contain.
        let route = decode(SKYREACH_ROUTE).expect("decode Skyreach route");
        let db = load_skyreach_db();
        let dungeon = db.dungeon(151).expect("Skyreach in fixture");
        let delays = travel::calculate_delays(&route, dungeon);

        assert_eq!(delays.len(), route.pulls.len(), "one delay per pull");
        assert_eq!(delays.len(), 13, "Skyreach weekly route has 13 pulls");
        assert!(delays.iter().all(|&d| d >= 0), "no negative delays");
        assert!(delays[0] > 0, "first pull travels from the entrance");
        let total: i64 = delays.iter().sum();
        assert!(
            (80..=160).contains(&total),
            "total pace {total}s should sit near the ~114s reference"
        );
    }

    #[test]
    fn converts_example_to_dungeonroute() {
        let out = convert(EXAMPLE, &load_db(), &ConvertOptions::default()).expect("convert example MDT string");

        assert_eq!(out.dungeon_name, "Seat of the Triumvirate");
        assert_eq!(out.keystone_level, 2);
        assert_eq!(out.pull_count, 16);
        assert_eq!(out.unresolved, 0, "all enemies should resolve in the DB");

        assert!(out.simc.starts_with("fight_style=DungeonRoute"));
        assert!(out.simc.contains("single_actor_batch=1"));

        let pull1 = out.simc.lines().find(|l| l.starts_with("raid_events+=/pull,pull=01,")).unwrap();
        assert!(pull1.contains("bloodlust=0,delay="));
        // hp_percent default 20 → fractioned health; slug name, no creatureType suffix.
        let occurrences = pull1.matches("\"merciless-subjugator_").count();
        assert_eq!(occurrences, 2, "two Merciless Subjugator clones, slug_N named");
        assert!(!pull1.contains(":humanoid"), "no creatureType suffix in new format");
    }

    #[test]
    fn builds_map_markers() {
        let out = convert(EXAMPLE, &load_db(), &ConvertOptions::default()).unwrap();
        let map = &out.map;
        assert_eq!(map.dungeon_idx, 11);
        assert_eq!(map.sublevels.len(), 1);
        assert_eq!(map.sublevels[0].index, 1);

        // Pull 1: color "ff3eff" (from the example), first marker is enemy 1
        // (Merciless Subjugator) on sublevel 1 within map bounds. The y-axis is
        // negative in MDT coordinate space — the key invariant the frontend flips.
        let p1 = &map.pulls[0];
        assert_eq!(p1.index, 1);
        assert_eq!(p1.color, "ff3eff");
        let m = &p1.enemies[0];
        assert_eq!(m.name, "Merciless Subjugator");
        assert_eq!(m.sublevel, 1);
        assert!(m.x > 0.0 && m.x < 840.0, "x {} should be in [0,840]", m.x);
        assert!(m.y < 0.0 && m.y > -560.0, "y {} should be in [-560,0]", m.y);
    }

    #[test]
    fn full_mob_layer_covers_all_clones() {
        let out = convert(EXAMPLE, &load_db(), &ConvertOptions::default()).unwrap();
        let enemies = &out.map.enemies;

        // Every clone of every enemy is present (186 for Seat), not just pulled ones.
        assert_eq!(enemies.len(), 186);

        // Pulled clones carry a pull number + color; with no unresolved enemies
        // their count matches the simmed enemy total.
        let pulled = enemies.iter().filter(|e| e.pull.is_some()).count();
        assert_eq!(out.unresolved, 0);
        assert_eq!(pulled, out.enemy_count);
        assert!(enemies.iter().any(|e| e.pull.is_none()), "unpulled trash shown");
        assert!(enemies.iter().all(|e| e.pull.is_some() == e.color.is_some()));

        // Patrols are surfaced (Seat has a handful of patrolling clones).
        assert!(
            enemies.iter().any(|e| !e.patrol.is_empty()),
            "at least one patrol path"
        );
    }

    #[test]
    fn missing_clone_counts_as_unresolved() {
        // A clone index the DB doesn't know (MDT version drift): the enemy is
        // still simmed (health is known), but no map marker can be placed —
        // that must surface in `unresolved` instead of vanishing silently.
        let route = MdtRoute {
            dungeon_idx: 11,
            week: 2,
            keystone_level: 2,
            text: String::new(),
            pulls: vec![MdtPull {
                enemies: vec![MdtPullEnemy {
                    enemy_idx: 1,
                    clone_indices: vec![1, 999],
                }],
                color: None,
            }],
            lines: vec![],
        };
        let out = generate::generate(&route, &load_db(), &ConvertOptions::default()).unwrap();
        assert_eq!(out.enemy_count, 2, "both clones are simmed");
        assert_eq!(out.unresolved, 1, "the unknown clone must be reported");
        assert_eq!(out.map.pulls[0].enemies.len(), 1, "only the known clone gets a marker");
    }

    #[test]
    fn emits_keystone_guru_format() {
        let opts = ConvertOptions { keystone_level: Some(14), hp_percent: 100 };
        let out = convert(SKYREACH_ROUTE, &load_skyreach_db(), &opts).unwrap();

        assert!(out.simc.starts_with("fight_style=DungeonRoute"));
        assert!(out.simc.contains("override.bloodlust=0"));
        assert!(out.simc.contains("single_actor_batch=1"));
        assert!(out.simc.contains("max_time=1680"));
        assert!(out.simc.contains("enemy=\"PUG-Friendly: Raider.IO's Weekly Route\""));
        assert!(out.simc.contains("enemy_health=999999"));
        assert!(out.simc.contains("keystone_level=14"));
        assert!(out.simc.contains("raid_events=/invulnerable,cooldown=5160,duration=5160,retarget=1"));

        let pull1 = out.simc.lines().find(|l| l.starts_with("raid_events+=/pull,pull=01,")).unwrap();
        assert!(pull1.contains("bloodlust=0,delay="));
        assert!(pull1.contains("\"soaring-chakram-master_1\":"));
        assert!(!pull1.contains(":humanoid"), "no creatureType suffix");
        assert_eq!(out.keystone_level, 14);
    }

    #[test]
    fn load_populates_global_and_converts() {
        // Exercises enemy_db::load + global() — the startup wiring the endpoint
        // relies on — by pointing it at a temp data dir holding the fixture.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("mdt_dungeons.json"),
            include_str!("testdata/mdt_dungeons.json"),
        )
        .unwrap();
        enemy_db::load(dir.path()).unwrap();

        let db = enemy_db::global().expect("global db loaded");
        assert!(db.dungeon(11).is_some());
        assert_eq!(convert(EXAMPLE, db, &ConvertOptions::default()).unwrap().pull_count, 16);
    }
}
