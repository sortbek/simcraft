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

/// Decode an MDT export string and convert it to a SimC `DungeonRoute` fight
/// definition using the static enemy database.
pub fn convert(import: &str, db: &DungeonDb) -> Result<MdtSimc, String> {
    let route = decode(import)?;
    generate::generate(&route, db)
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
    fn converts_example_to_dungeonroute() {
        let out = convert(EXAMPLE, &load_db()).expect("convert example MDT string");

        assert_eq!(out.dungeon_name, "Seat of the Triumvirate");
        assert_eq!(out.keystone_level, 2);
        assert_eq!(out.pull_count, 16);
        assert_eq!(out.unresolved, 0, "all enemies should resolve in the DB");

        // First line is the fight style; one pull line per pull follows.
        let lines: Vec<&str> = out.simc.lines().collect();
        assert_eq!(lines[0], "fight_style=DungeonRoute");
        assert_eq!(lines.len(), 1 + out.pull_count);

        // Pull 1 has enemy 1 (Merciless Subjugator) with 2 clones at level-2
        // scaled health 2112714, listed twice.
        assert!(lines[1].starts_with("raid_events+=/pull,pull=1,bloodlust=0,delay=0,enemies="));
        let occurrences = lines[1].matches("\"Merciless_Subjugator\":2112714:humanoid").count();
        assert_eq!(occurrences, 2);
    }

    #[test]
    fn builds_map_markers() {
        let out = convert(EXAMPLE, &load_db()).unwrap();
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
        assert_eq!(convert(EXAMPLE, db).unwrap().pull_count, 16);
    }
}
