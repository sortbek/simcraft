//! Per-pull travel-time delays, ported from keystone.guru's
//! KillZonePathService + RaidEventPull::calculateDelay.

use super::enemy_db::Dungeon;
use super::model::{MdtLine, MdtPull, MdtRoute};

/// On-foot movement speed (yards/second), from keystone.guru's config.
const MOVE_SPEED_YPS: f64 = 7.0;

/// Returns one delay (seconds, rounded) per pull in `route.pulls`, in order
/// (aligned by index — callers index by the pull's position). Pull 1 is measured
/// from the dungeon entrance; each subsequent pull is measured from the previous
/// resolvable centroid. When the route carries a drawn polyline, travel follows
/// the path (arc-length between consecutive pull projections); otherwise it is a
/// straight-line centroid estimate. Empty or fully-unresolved pulls get delay `0`
/// and do not advance the reference position. Distance = MDT-coordinate distance
/// × `yards_per_unit` ÷ 7 yd/s.
#[allow(dead_code)] // wired in by generate.rs (Task 6)
pub fn calculate_delays(route: &MdtRoute, dungeon: &Dungeon) -> Vec<i64> {
    let centroids: Vec<Option<(f64, f64)>> = route
        .pulls
        .iter()
        .map(|p| pull_centroid(p, dungeon))
        .collect();

    let scale = dungeon.yards_per_unit.unwrap_or(0.0);
    if scale <= 0.0 {
        return vec![0; centroids.len()];
    }

    let entrance = dungeon.entrance.as_ref().map(|e| (e.x, e.y));

    match longest_line(&route.lines) {
        Some(path) => delays_along_path(&path.points, entrance, &centroids, scale),
        None => delays_straight(entrance, &centroids, scale),
    }
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

fn seconds(distance_units: f64, scale: f64) -> i64 {
    ((distance_units * scale) / MOVE_SPEED_YPS).round() as i64
}

fn delays_straight(
    entrance: Option<(f64, f64)>,
    centroids: &[Option<(f64, f64)>],
    scale: f64,
) -> Vec<i64> {
    let mut delays = Vec::with_capacity(centroids.len());
    let mut prev = entrance;
    for c in centroids {
        let delay = match (prev, c) {
            (Some(a), Some(b)) => seconds(dist(a, *b), scale),
            _ => 0,
        };
        delays.push(delay);
        if c.is_some() {
            prev = *c;
        }
    }
    delays
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

fn delays_along_path(
    path: &[(f64, f64)],
    entrance: Option<(f64, f64)>,
    centroids: &[Option<(f64, f64)>],
    scale: f64,
) -> Vec<i64> {
    debug_assert!(path.len() >= 2);
    let mut cum = vec![0.0; path.len()];
    for i in 1..path.len() {
        cum[i] = cum[i - 1] + dist(path[i - 1], path[i]);
    }
    let mut delays = Vec::with_capacity(centroids.len());
    let mut prev_s = entrance.map(|e| project_onto(path, &cum, e));
    for c in centroids {
        let delay = match (prev_s, c) {
            (Some(ps), Some(b)) => {
                let s = project_onto(path, &cum, *b);
                prev_s = Some(s);
                seconds((s - ps).abs(), scale)
            }
            _ => 0,
        };
        delays.push(delay);
    }
    delays
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

    fn dungeon(enemies: HashMap<i64, Enemy>, scale: Option<f64>) -> Dungeon {
        Dungeon {
            name: "T".into(), total_count: 0, sublevels: vec![], enemies,
            map_id: None, timer_max_seconds: None,
            entrance: Some(MapPoint { x: 0.0, y: 0.0, sublevel: 1 }),
            yards_per_unit: scale, sublevel_links: vec![],
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
        let d = dungeon(enemies, Some(7.0));
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
        let d = dungeon(enemies, Some(7.0));
        let line = MdtLine { sublevel: 1, points: vec![(0.0, 0.0), (0.0, 100.0)] };
        let r = route(vec![line]);
        assert_eq!(calculate_delays(&r, &d), vec![10, 30]);
    }

    #[test]
    fn no_scale_yields_zero_delays() {
        let mut enemies = HashMap::new();
        enemies.insert(1, enemy_at(3.0, 4.0));
        enemies.insert(2, enemy_at(3.0, 11.0));
        let d = dungeon(enemies, None);
        assert_eq!(calculate_delays(&route(vec![]), &d), vec![0, 0]);
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
        let d = dungeon(enemies, Some(7.0));
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
