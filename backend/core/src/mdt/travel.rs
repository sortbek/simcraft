//! Per-pull travel-time delays, ported from keystone.guru's
//! KillZonePathService + RaidEventPull::calculateDelay.

use super::enemy_db::Dungeon;

/// MDT canvas extent — the coordinate range MDT enemy x/y live in. Provisional
/// values; CALIBRATED against the Skyreach reference in Task 4. The test in this
/// task uses 100 / -50 to exercise the math independent of the real constants.
#[cfg(test)]
const CANVAS_MAX_X: f64 = 100.0;
#[cfg(test)]
const CANVAS_MAX_Y: f64 = -50.0;
#[cfg(not(test))]
#[allow(dead_code)]
const CANVAS_MAX_X: f64 = 100.0; // TODO(task-4): replace with calibrated value
#[cfg(not(test))]
#[allow(dead_code)]
const CANVAS_MAX_Y: f64 = -50.0; // TODO(task-4): replace with calibrated value

#[allow(dead_code)]
const MOVE_SPEED_YPS: f64 = 7.0;

/// Convert an MDT map coordinate on `sublevel` to in-game world yards, or `None`
/// if the dungeon has no calibration for that sublevel.
#[allow(dead_code)]
pub fn to_world_yards(x: f64, y: f64, sublevel: i64, dungeon: &Dungeon) -> Option<(f64, f64)> {
    let b = dungeon.ingame_bounds.get(&sublevel)?;
    let nx = x / CANVAS_MAX_X;
    let ny = y / CANVAS_MAX_Y;
    Some((
        b.min_x + nx * (b.max_x - b.min_x),
        b.min_y + ny * (b.max_y - b.min_y),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mdt::enemy_db::{Dungeon, IngameBounds};
    use std::collections::HashMap;

    fn bounds_dungeon() -> Dungeon {
        let mut ingame_bounds = HashMap::new();
        // sublevel 1: MDT [0,100]x[-50,0] maps to world [0,200]x[0,100]
        ingame_bounds.insert(1, IngameBounds { min_x: 0.0, max_x: 200.0, min_y: 0.0, max_y: 100.0 });
        Dungeon {
            name: "T".into(), total_count: 0, sublevels: vec![], enemies: HashMap::new(),
            map_id: None, timer_max_seconds: None, entrance: None,
            sublevel_links: vec![], ingame_bounds,
        }
    }

    #[test]
    fn transforms_mdt_to_world_yards() {
        // With CANVAS_MAX_X=100, CANVAS_MAX_Y=-50 (calibrated in Task 4 to real values),
        // MDT (50, -25) normalizes to (0.5, 0.5) → world (100, 50).
        let d = bounds_dungeon();
        let (wx, wy) = to_world_yards(50.0, -25.0, 1, &d).unwrap();
        assert!((wx - 100.0).abs() < 1e-6, "wx={wx}");
        assert!((wy - 50.0).abs() < 1e-6, "wy={wy}");
    }

    #[test]
    fn returns_none_without_bounds() {
        let d = bounds_dungeon();
        assert!(to_world_yards(0.0, 0.0, 9, &d).is_none());
    }
}
