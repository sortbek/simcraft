//! Per-pull travel-time delays, ported from keystone.guru's
//! KillZonePathService + RaidEventPull::calculateDelay.

use super::enemy_db::Dungeon;

#[allow(dead_code)]
const MOVE_SPEED_YPS: f64 = 7.0;

/// Convert an MDT map coordinate to in-game world yards using the dungeon's
/// `yards_per_unit` scale, or `None` if the dungeon has no calibration.
#[allow(dead_code)]
pub fn to_world_yards(x: f64, y: f64, _sublevel: i64, dungeon: &Dungeon) -> Option<(f64, f64)> {
    let scale = dungeon.yards_per_unit?;
    Some((x * scale, y * scale))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mdt::enemy_db::Dungeon;
    use std::collections::HashMap;

    fn bounds_dungeon() -> Dungeon {
        Dungeon {
            name: "T".into(), total_count: 0, sublevels: vec![], enemies: HashMap::new(),
            map_id: None, timer_max_seconds: None, entrance: None,
            sublevel_links: vec![], yards_per_unit: Some(2.0),
        }
    }

    // Superseded by R3 delay engine — kept as a minimal smoke-test for to_world_yards.
    #[test]
    fn transforms_mdt_to_world_yards() {
        let d = bounds_dungeon();
        let (wx, wy) = to_world_yards(50.0, -25.0, 1, &d).unwrap();
        assert!((wx - 100.0).abs() < 1e-6, "wx={wx}");
        assert!((wy - (-50.0)).abs() < 1e-6, "wy={wy}");
    }

    #[test]
    fn returns_none_without_scale() {
        let d = Dungeon {
            name: "T".into(), total_count: 0, sublevels: vec![], enemies: HashMap::new(),
            map_id: None, timer_max_seconds: None, entrance: None,
            sublevel_links: vec![], yards_per_unit: None,
        };
        assert!(to_world_yards(0.0, 0.0, 1, &d).is_none());
    }
}
