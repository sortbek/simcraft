//! Per-pull travel-time delays, ported from keystone.guru's
//! KillZonePathService + RaidEventPull::calculateDelay.

use super::enemy_db::Dungeon;
use super::model::{MdtLine, MdtPull, MdtRoute};

/// On-foot movement speed (yards/second), from keystone.guru's config.
const MOVE_SPEED_YPS: f64 = 7.0;

/// World-yard scale used when a dungeon's UiMap has no calibrated `yards_per_unit`
/// (its mapID resolves to a parent/zone map, so DBC bounds can't be trusted). The
/// mean of the calibrated current-season maps (~0.85). Gives ballpark per-pull
/// delays — approximate in absolute magnitude but correct in *relative* pattern,
/// which is far better for the DPS sim than zeroing all delays (zero delays chain
/// every pull back-to-back, starving cooldown/resource recovery between packs).
/// Hand-derived from `mdt_map_geometry.json`; re-check it when that file is
/// regenerated for a new season so it stays the mean of the current scales.
const DEFAULT_YARDS_PER_UNIT: f64 = 0.85;

/// Returns one delay (seconds, rounded) per pull in `route.pulls`, in order
/// (aligned by index — callers index by the pull's position). Pull 1 is measured
/// from the dungeon entrance; each subsequent pull is measured from the previous
/// resolvable centroid. When the route carries a drawn polyline, travel follows
/// the path (arc-length between consecutive pull projections); otherwise it is a
/// straight-line centroid estimate. Empty or fully-unresolved pulls get delay `0`
/// and do not advance the reference position. Coordinates are converted to world
/// yards per-axis (`x·yards_per_unit_x`, `y·yards_per_unit_y` — each axis falling
/// back to the legacy isotropic scale, then [`DEFAULT_YARDS_PER_UNIT`]) and the
/// delay is the yard distance ÷ 7 yd/s.
/// A drawn line is treated as a real traversal path (rather than a partial
/// annotation scribble) only when the route's projection onto it spans at least
/// this fraction of the straight-line tour. A genuine route line's projected
/// length is comparable to — or longer than, because it winds — the straight
/// tour; a short scribble collapses most pull projections onto the same point,
/// so its projected length is near zero.
const PATH_COVERAGE: f64 = 0.5;

pub fn calculate_delays(route: &MdtRoute, dungeon: &Dungeon) -> Vec<i64> {
    // Resolve a per-axis scale: the explicit per-axis value, else the legacy
    // isotropic value, else a typical default. Every dungeon has a physical scale,
    // so a missing calibration approximates rather than zeroing the whole route.
    let resolve = |axis: Option<f64>| {
        axis.or(dungeon.yards_per_unit)
            .filter(|s| *s > 0.0)
            .unwrap_or(DEFAULT_YARDS_PER_UNIT)
    };
    let sx = resolve(dungeon.yards_per_unit_x);
    let sy = resolve(dungeon.yards_per_unit_y);
    // Convert MDT coordinates to world yards up front, so all distance math runs in
    // yards and each axis scales independently (handles non-1.5:1 floors).
    let to_yd = |(x, y): (f64, f64)| (x * sx, y * sy);

    let centroids: Vec<Option<(f64, f64)>> = route
        .pulls
        .iter()
        .map(|p| pull_centroid(p, dungeon).map(to_yd))
        .collect();
    let entrance = dungeon.entrance.as_ref().map(|e| to_yd((e.x, e.y)));

    let straight = straight_distances(entrance, &centroids);
    let distances = match longest_line(&route.lines) {
        Some(path) => {
            let points: Vec<(f64, f64)> = path.points.iter().map(|&p| to_yd(p)).collect();
            let along = path_distances(&points, entrance, &centroids);
            let straight_total: f64 = straight.iter().sum();
            let path_total: f64 = along.iter().sum();
            if straight_total > 0.0 && path_total >= PATH_COVERAGE * straight_total {
                along
            } else {
                straight
            }
        }
        None => straight,
    };

    distances.iter().map(|d| seconds(*d)).collect()
}

/// Average MDT-coordinate position of a pull's resolved clones, or `None` if none
/// resolve.
fn pull_centroid(pull: &MdtPull, dungeon: &Dungeon) -> Option<(f64, f64)> {
    let mut sx = 0.0;
    let mut sy = 0.0;
    let mut n = 0.0;
    for entry in &pull.enemies {
        let Some(enemy) = dungeon.enemies.get(&entry.enemy_idx) else { continue };
        for clone_idx in &entry.clone_indices {
            if let Some(pos) = enemy.clones.get(clone_idx) {
                sx += pos.x;
                sy += pos.y;
                n += 1.0;
            }
        }
    }
    if n == 0.0 { None } else { Some((sx / n, sy / n)) }
}

fn dist(a: (f64, f64), b: (f64, f64)) -> f64 {
    ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt()
}

/// Whole-second delay for a yard distance at on-foot speed.
fn seconds(distance_yards: f64) -> i64 {
    (distance_yards / MOVE_SPEED_YPS).round() as i64
}

/// Straight-line world-yard distance to each pull from the previous resolved
/// position (entrance for pull 1). `0.0` for an unresolvable pull, which also
/// does not advance the reference.
fn straight_distances(entrance: Option<(f64, f64)>, centroids: &[Option<(f64, f64)>]) -> Vec<f64> {
    let mut out = Vec::with_capacity(centroids.len());
    let mut prev = entrance;
    for c in centroids {
        let d = match (prev, c) {
            (Some(a), Some(b)) => dist(a, *b),
            _ => 0.0,
        };
        out.push(d);
        if c.is_some() {
            prev = *c;
        }
    }
    out
}

fn line_len(l: &MdtLine) -> f64 {
    l.points.windows(2).map(|w| dist(w[0], w[1])).sum()
}

/// The longest drawn polyline (with at least one segment), if any.
fn longest_line(lines: &[MdtLine]) -> Option<&MdtLine> {
    lines
        .iter()
        .filter(|l| l.points.len() >= 2)
        .max_by(|a, b| line_len(a).total_cmp(&line_len(b)))
}

/// Arc-length position (and perpendicular distance) of point `p`'s closest point
/// on segment `a`→`b`, where `cum_a` is the arc-length at `a`.
fn project_segment(p: (f64, f64), a: (f64, f64), b: (f64, f64), cum_a: f64) -> (f64, f64) {
    let abx = b.0 - a.0;
    let aby = b.1 - a.1;
    let len2 = abx * abx + aby * aby;
    let t = if len2 <= 0.0 {
        0.0
    } else {
        (((p.0 - a.0) * abx + (p.1 - a.1) * aby) / len2).clamp(0.0, 1.0)
    };
    let closest = (a.0 + t * abx, a.1 + t * aby);
    let s = cum_a + t * len2.sqrt();
    (s, dist(p, closest))
}

/// Arc-length position along `path` of the point closest to `p`.
fn project_onto(path: &[(f64, f64)], cum: &[f64], p: (f64, f64)) -> f64 {
    let mut best_d = f64::INFINITY;
    let mut best_s = 0.0;
    for i in 0..path.len() - 1 {
        let (s, d) = project_segment(p, path[i], path[i + 1], cum[i]);
        if d < best_d {
            best_d = d;
            best_s = s;
        }
    }
    best_s
}

/// Arc-length distance along `path` between consecutive pull projections
/// (entrance for pull 1). `0.0` for an unresolvable pull, which also does not
/// advance the reference.
fn path_distances(
    path: &[(f64, f64)],
    entrance: Option<(f64, f64)>,
    centroids: &[Option<(f64, f64)>],
) -> Vec<f64> {
    debug_assert!(path.len() >= 2);
    let mut cum = vec![0.0; path.len()];
    for i in 1..path.len() {
        cum[i] = cum[i - 1] + dist(path[i - 1], path[i]);
    }
    let mut out = Vec::with_capacity(centroids.len());
    let mut prev_s = entrance.map(|e| project_onto(path, &cum, e));
    for c in centroids {
        let d = match (prev_s, c) {
            (Some(ps), Some(b)) => {
                let s = project_onto(path, &cum, *b);
                prev_s = Some(s);
                (s - ps).abs()
            }
            _ => 0.0,
        };
        out.push(d);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mdt::enemy_db::{ClonePos, Dungeon, Enemy, MapPoint};
    use crate::mdt::model::{MdtLine, MdtPull, MdtPullEnemy, MdtRoute};
    use std::collections::HashMap;

    fn clone_at(x: f64, y: f64) -> ClonePos {
        ClonePos { x, y, sublevel: 1, patrol: vec![] }
    }

    fn enemy_at(x: f64, y: f64) -> Enemy {
        let mut clones = HashMap::new();
        clones.insert(1, clone_at(x, y));
        Enemy {
            id: 0, name: "E".into(), count: 1, health: 100,
            creature_type: "Humanoid".into(), is_boss: false, ignore_fortified: false,
            scale: 1.0, clones,
        }
    }

    fn dungeon(enemies: HashMap<i64, Enemy>, sx: Option<f64>, sy: Option<f64>) -> Dungeon {
        Dungeon {
            name: "T".into(), total_count: 0, sublevels: vec![], enemies,
            map_id: None, timer_max_seconds: None,
            entrance: Some(MapPoint { x: 0.0, y: 0.0, sublevel: 1 }),
            yards_per_unit: None, yards_per_unit_x: sx, yards_per_unit_y: sy,
            sublevel_links: vec![],
        }
    }

    fn pull(enemy_idx: i64) -> MdtPull {
        MdtPull {
            enemies: vec![MdtPullEnemy { enemy_idx, clone_indices: vec![1] }],
            color: None,
        }
    }

    fn route(lines: Vec<MdtLine>) -> MdtRoute {
        MdtRoute {
            dungeon_idx: 1, week: 1, keystone_level: 2, text: String::new(),
            lines, pulls: vec![pull(1), pull(2)],
        }
    }

    #[test]
    fn straight_line_fallback_uses_centroid_distance() {
        // scale 7 yd/unit → delay == straight MDT distance. entrance (0,0).
        // pull1 at (3,4) → dist 5 from entrance → 5s. pull2 at (3,11) → dist 7 → 7s.
        let mut enemies = HashMap::new();
        enemies.insert(1, enemy_at(3.0, 4.0));
        enemies.insert(2, enemy_at(3.0, 11.0));
        let d = dungeon(enemies, Some(7.0), Some(7.0));
        let r = route(vec![]); // no drawn line → straight-line estimate
        assert_eq!(calculate_delays(&r, &d), vec![5, 7]);
    }

    #[test]
    fn path_based_uses_arclength_projection() {
        // vertical line (0,0)→(0,100), scale 7. entrance (0,0) projects to s=0.
        // pull1 (5,10) projects to s=10 → 10s; pull2 (5,40) → s=40 → |40-10|=30s.
        let mut enemies = HashMap::new();
        enemies.insert(1, enemy_at(5.0, 10.0));
        enemies.insert(2, enemy_at(5.0, 40.0));
        let d = dungeon(enemies, Some(7.0), Some(7.0));
        let line = MdtLine { sublevel: 1, points: vec![(0.0, 0.0), (0.0, 100.0)] };
        let r = route(vec![line]);
        assert_eq!(calculate_delays(&r, &d), vec![10, 30]);
    }

    #[test]
    fn partial_line_falls_back_to_straight() {
        // A short scribble line (0,0)→(1,0) while the pulls are spread far along y.
        // Every pull centroid projects onto ~the same spot (s≈0), so the projected
        // length ≈ 0 << the straight tour → the gate rejects the line and uses the
        // straight-line estimate: entrance(0,0)→(0,10)=10, (0,10)→(0,40)=30.
        let mut enemies = HashMap::new();
        enemies.insert(1, enemy_at(0.0, 10.0));
        enemies.insert(2, enemy_at(0.0, 40.0));
        let d = dungeon(enemies, Some(7.0), Some(7.0));
        let line = MdtLine { sublevel: 1, points: vec![(0.0, 0.0), (1.0, 0.0)] };
        let r = route(vec![line]);
        assert_eq!(calculate_delays(&r, &d), vec![10, 30]);
    }

    #[test]
    fn missing_scale_falls_back_to_default() {
        // No calibrated yards_per_unit → the default scale is used (non-zero
        // delays), not the old all-zero fallback. entrance(0,0)→(3,4)=5 units,
        // (3,4)→(3,11)=7 units, converted at the default scale.
        let mut enemies = HashMap::new();
        enemies.insert(1, enemy_at(3.0, 4.0));
        enemies.insert(2, enemy_at(3.0, 11.0));
        let d = dungeon(enemies, None, None);
        assert_eq!(
            calculate_delays(&route(vec![]), &d),
            vec![
                seconds(5.0 * DEFAULT_YARDS_PER_UNIT),
                seconds(7.0 * DEFAULT_YARDS_PER_UNIT)
            ]
        );
    }

    #[test]
    fn anisotropic_scales_apply_per_axis() {
        // sx=1, sy=2: an x-move and an equal-magnitude y-move give different delays.
        // entrance(0,0)→(7,0): 7 units on x → 7·1 = 7 yd → 1s.
        // (7,0)→(7,7): 7 units on y → 7·2 = 14 yd → 2s.
        let mut enemies = HashMap::new();
        enemies.insert(1, enemy_at(7.0, 0.0));
        enemies.insert(2, enemy_at(7.0, 7.0));
        let d = dungeon(enemies, Some(1.0), Some(2.0));
        assert_eq!(calculate_delays(&route(vec![]), &d), vec![1, 2]);
    }

    #[test]
    fn unresolvable_middle_pull_gets_zero_and_does_not_advance_reference() {
        // 3 pulls; the middle pull references an enemy_idx absent from the DB.
        // Expect: one delay per pull (len 3); middle = 0; pull 3 measured from pull 1
        // (reference did not advance across the gap). scale 7 → delay == MDT distance.
        let mut enemies = HashMap::new();
        enemies.insert(1, enemy_at(0.0, 10.0)); // pull 1 centroid, dist 10 from entrance (0,0)
        enemies.insert(3, enemy_at(0.0, 40.0)); // pull 3 centroid
        // note: enemy_idx 2 is intentionally NOT inserted -> pull 2 is unresolvable
        let d = dungeon(enemies, Some(7.0), Some(7.0));
        let r = MdtRoute {
            dungeon_idx: 1, week: 1, keystone_level: 2, text: String::new(),
            lines: vec![],
            pulls: vec![pull(1), pull(2), pull(3)],
        };
        let delays = calculate_delays(&r, &d);
        assert_eq!(delays.len(), 3, "one delay per pull");
        assert_eq!(delays[0], 10, "pull 1 from entrance (0,0) to (0,10)");
        assert_eq!(delays[1], 0, "unresolvable middle pull");
        assert_eq!(delays[2], 30, "pull 3 from pull 1 (0,10) to (0,40), not from the gap");
    }
}
