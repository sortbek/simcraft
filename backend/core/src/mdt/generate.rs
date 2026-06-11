//! Generate a SimulationCraft `DungeonRoute` fight definition from a decoded MDT
//! route plus the static enemy database.
//!
//! Output: a `fight_style=DungeonRoute` line followed by one
//! `raid_events+=/pull,...` line per pull, each listing its enemies as
//! `"name":health:creatureType` specifiers (one per clone, bosses prefixed
//! `BOSS_`). SimC has no NPC-id concept, so health is resolved and scaled here.

use super::enemy_db::DungeonDb;
use super::health_scaling::calculate_enemy_health;
use super::model::MdtRoute;
use serde::Serialize;

/// Travel time between pulls. MDT stores no per-pull travel time, so a fixed
/// default is used (configurable later).
const DEFAULT_DELAY_SECONDS: i64 = 0;

/// MDT's default pull color (forest green) when a pull set none.
const DEFAULT_PULL_COLOR: &str = "228b22";

#[derive(Debug, Clone, Serialize)]
pub struct MdtSimc {
    /// MDT addon version the enemy DB was extracted from (`""` if unknown).
    /// Mob positions shift between MDT releases, so the UI shows this to make
    /// route-vs-map discrepancies explainable.
    pub mdt_version: String,
    pub dungeon_name: String,
    pub week: i64,
    pub keystone_level: i64,
    pub pull_count: usize,
    /// Total enemy instances (clones) across all pulls that resolved.
    pub enemy_count: usize,
    /// Sum of scaled health across all resolved enemy instances.
    pub total_health: i64,
    /// Enemy instances referenced by the route but missing from the database
    /// (e.g. MDT version drift). Zero for a clean conversion.
    pub unresolved: usize,
    /// The `raid_events+=/pull,...` lines only (no `fight_style`), for injecting
    /// alongside a `DungeonRoute` fight-style selection.
    pub raid_events: String,
    /// The complete SimC fight definition (`fight_style=DungeonRoute` + pulls).
    pub simc: String,
    /// Map-render data: per-pull colored mob markers positioned on the dungeon map.
    pub map: MdtMap,
}

/// Everything the frontend needs to draw the route on the dungeon map.
#[derive(Debug, Clone, Serialize)]
pub struct MdtMap {
    pub dungeon_idx: i64,
    /// Total enemy-forces required for the dungeon (MDT `dungeonTotalCount.normal`),
    /// the 100% threshold pull forces are measured against.
    pub total_count: i64,
    pub sublevels: Vec<MapSublevel>,
    pub pulls: Vec<MapPull>,
    /// Every clone of every enemy in the dungeon — the full mob layer the map
    /// draws. Clones not in any pull have `pull`/`color` unset (drawn dimmed);
    /// pulled clones carry their pull number and color.
    pub enemies: Vec<MapEnemy>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MapSublevel {
    pub index: i64,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MapPull {
    /// 1-based pull number in route order.
    pub index: usize,
    /// 6-char hex color (no `#`).
    pub color: String,
    pub enemies: Vec<MapMarker>,
}

/// One mob instance positioned on the map. `(x, y)` are MDT map coordinates;
/// the frontend plots the marker center at `(x * s, -y * s)` from the map's
/// top-left (note the y-axis sign flip).
#[derive(Debug, Clone, Serialize)]
pub struct MapMarker {
    pub x: f64,
    pub y: f64,
    pub sublevel: i64,
    pub name: String,
    pub is_boss: bool,
    pub scale: f64,
    pub count: i64,
}

/// One clone in the full mob layer. Like [`MapMarker`] but tagged with its pull
/// membership (`None` = not pulled, drawn dimmed) and its patrol path.
#[derive(Debug, Clone, Serialize)]
pub struct MapEnemy {
    pub x: f64,
    pub y: f64,
    pub sublevel: i64,
    pub name: String,
    pub is_boss: bool,
    pub scale: f64,
    pub count: i64,
    /// Keystone-scaled health for this mob (same value used in the sim).
    pub health: i64,
    /// Lowercased creature type (the SimC enemy `race`), so the route can be
    /// re-serialized to a `DungeonRoute` after client-side pull edits.
    pub race: String,
    /// Patrol waypoints (same coord space as `x`/`y`), in order. Empty if none.
    pub patrol: Vec<MapPoint>,
    /// 1-based pull number this clone belongs to, or `None` if unpulled.
    pub pull: Option<usize>,
    /// The pull's 6-char hex color (no `#`), or `None` if unpulled.
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MapPoint {
    pub x: f64,
    pub y: f64,
}

pub fn generate(route: &MdtRoute, db: &DungeonDb) -> Result<MdtSimc, String> {
    let dungeon = db
        .dungeon(route.dungeon_idx)
        .ok_or_else(|| format!("dungeon index {} not in MDT database", route.dungeon_idx))?;

    let mut pull_lines = Vec::new();
    let mut map_pulls = Vec::new();
    let mut enemy_count = 0;
    let mut total_health = 0;
    let mut unresolved = 0;

    for (i, pull) in route.pulls.iter().enumerate() {
        let mut specifiers = Vec::new();
        let mut markers = Vec::new();
        for entry in &pull.enemies {
            let Some(enemy) = dungeon.enemies.get(&entry.enemy_idx) else {
                unresolved += entry.clone_indices.len();
                continue;
            };
            let health = calculate_enemy_health(
                enemy.is_boss,
                enemy.health,
                route.keystone_level,
                enemy.ignore_fortified,
            );
            let race = enemy.creature_type.to_lowercase();
            let name = sanitize_name(&enemy.name, enemy.is_boss);
            // One specifier + one map marker per clone in this pull — each clone
            // is its own mob.
            for &clone_idx in &entry.clone_indices {
                specifiers.push(format!("\"{name}\":{health}:{race}"));
                enemy_count += 1;
                total_health += health;
                if let Some(pos) = enemy.clones.get(&clone_idx) {
                    markers.push(MapMarker {
                        x: pos.x,
                        y: pos.y,
                        sublevel: pos.sublevel,
                        name: enemy.name.clone(),
                        is_boss: enemy.is_boss,
                        scale: enemy.scale,
                        count: enemy.count,
                    });
                } else {
                    // Clone index unknown to the DB (MDT version drift): the
                    // mob is still simmed but cannot be drawn on the map.
                    unresolved += 1;
                }
            }
        }
        if !markers.is_empty() {
            map_pulls.push(MapPull {
                index: i + 1,
                color: pull
                    .color
                    .clone()
                    .unwrap_or_else(|| DEFAULT_PULL_COLOR.to_string()),
                enemies: markers,
            });
        }
        if specifiers.is_empty() {
            continue;
        }
        pull_lines.push(format!(
            "raid_events+=/pull,pull={},bloodlust=0,delay={},enemies={}",
            i + 1,
            DEFAULT_DELAY_SECONDS,
            specifiers.join("|")
        ));
    }

    // Full mob layer: every clone of every enemy, tagged with pull membership.
    // First map (enemy_idx, clone_idx) -> (pull number, color) from the route.
    let mut pull_of: std::collections::HashMap<(i64, i64), (usize, String)> =
        std::collections::HashMap::new();
    for (i, pull) in route.pulls.iter().enumerate() {
        let color = pull
            .color
            .clone()
            .unwrap_or_else(|| DEFAULT_PULL_COLOR.to_string());
        for entry in &pull.enemies {
            for &clone_idx in &entry.clone_indices {
                pull_of.insert((entry.enemy_idx, clone_idx), (i + 1, color.clone()));
            }
        }
    }

    let mut all_enemies = Vec::new();
    for (&enemy_idx, enemy) in &dungeon.enemies {
        for (&clone_idx, pos) in &enemy.clones {
            let (pull, color) = match pull_of.get(&(enemy_idx, clone_idx)) {
                Some((p, c)) => (Some(*p), Some(c.clone())),
                None => (None, None),
            };
            all_enemies.push(MapEnemy {
                x: pos.x,
                y: pos.y,
                sublevel: pos.sublevel,
                name: enemy.name.clone(),
                is_boss: enemy.is_boss,
                scale: enemy.scale,
                count: enemy.count,
                health: calculate_enemy_health(
                    enemy.is_boss,
                    enemy.health,
                    route.keystone_level,
                    enemy.ignore_fortified,
                ),
                race: enemy.creature_type.to_lowercase(),
                patrol: pos.patrol.iter().map(|p| MapPoint { x: p.x, y: p.y }).collect(),
                pull,
                color,
            });
        }
    }
    // Stable order: unpulled first (drawn underneath), then by pull number, so
    // pulled mobs paint on top — and the output is deterministic despite the
    // HashMap iteration above.
    all_enemies.sort_by(|a, b| {
        a.pull
            .is_some()
            .cmp(&b.pull.is_some())
            .then(a.pull.cmp(&b.pull))
            .then(a.name.cmp(&b.name))
    });

    let map = MdtMap {
        dungeon_idx: route.dungeon_idx,
        total_count: dungeon.total_count,
        sublevels: dungeon
            .sublevels
            .iter()
            .map(|s| MapSublevel {
                index: s.index,
                name: s.name.clone(),
            })
            .collect(),
        pulls: map_pulls,
        enemies: all_enemies,
    };

    let raid_events = pull_lines.join("\n");
    let simc = if raid_events.is_empty() {
        "fight_style=DungeonRoute".to_string()
    } else {
        format!("fight_style=DungeonRoute\n{raid_events}")
    };

    Ok(MdtSimc {
        mdt_version: db.mdt_version().to_string(),
        dungeon_name: dungeon.name.clone(),
        week: route.week,
        keystone_level: route.keystone_level,
        pull_count: route.pulls.len(),
        enemy_count,
        total_health,
        unresolved,
        raid_events,
        simc,
        map,
    })
}

/// Make an enemy name safe for a SimC enemy specifier (no spaces or `:`/`|`/`"`)
/// and apply the `BOSS_` prefix that SimC uses to spawn a boss-type actor.
fn sanitize_name(name: &str, is_boss: bool) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();
    if is_boss {
        format!("BOSS_{cleaned}")
    } else {
        cleaned
    }
}
