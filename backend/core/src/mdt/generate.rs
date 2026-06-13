//! Generate a SimulationCraft `DungeonRoute` fight definition from a decoded MDT
//! route plus the static enemy database.
//!
//! Output: a multi-line header (`fight_style=DungeonRoute`, overrides, `max_time`,
//! `enemy`, `keystone_level`, invulnerable event) followed by one
//! `raid_events+=/pull,...` line per pull. Each enemy specifier uses keystone.guru's
//! slug-N format: `"slug_N":health` (bosses prefixed `BOSS_`), no `:creatureType`
//! suffix. Health in the SimC specifier is scaled to `hp_percent` of full health.

use super::enemy_db::DungeonDb;
use super::health_scaling::calculate_enemy_health;
use super::model::MdtRoute;
use serde::Serialize;

/// Palette for pulls that carry no color of their own — e.g. routes built on the
/// map and saved as bare clone refs (serialize drops color), which would
/// otherwise all collapse to one color on reload. Matches the frontend's drawing
/// palette (NEW_PULL_COLORS) so a reloaded route keeps the colors it was drawn with.
const PULL_PALETTE: [&str; 7] =
    ["e08a3f", "c95fd6", "5fb0d6", "d6c45f", "6fd65f", "d65f7a", "7f9fe0"];

/// A colorless pull's display color: a palette slot chosen by pull index, so
/// consecutive pulls stay visually distinct instead of all rendering identically.
fn pull_palette_color(i: usize) -> String {
    PULL_PALETTE[i % PULL_PALETTE.len()].to_string()
}

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
    /// The complete SimC fight definition (header + pulls).
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

/// A pull's identity for the map: its number and color. The mobs themselves are
/// drawn from the full [`MapEnemy`] layer below (each clone is tagged with its
/// pull number + color), so they are not duplicated here.
#[derive(Debug, Clone, Serialize)]
pub struct MapPull {
    /// 1-based pull number in route order.
    pub index: usize,
    /// 6-char hex color (no `#`).
    pub color: String,
}

/// One clone in the full mob layer, tagged with its pull membership
/// (`None` = not pulled, drawn dimmed) and its patrol path. `(x, y)` are MDT map
/// coordinates; the frontend plots the center at `(x * s, -y * s)` (y is flipped).
#[derive(Debug, Clone, Serialize)]
pub struct MapEnemy {
    /// MDT enemy index + clone index — the stable reference the frontend sends
    /// back to `/api/mdt/serialize` to rebuild an edited pull assignment.
    pub enemy_idx: i64,
    pub clone_idx: i64,
    pub x: f64,
    pub y: f64,
    pub sublevel: i64,
    pub name: String,
    pub is_boss: bool,
    pub scale: f64,
    pub count: i64,
    /// Full keystone-scaled health for this mob (the mob's max HP shown on the
    /// map). The sim specifier uses `hp_percent` of this value.
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

pub fn generate(route: &MdtRoute, db: &DungeonDb, opts: &super::ConvertOptions) -> Result<MdtSimc, String> {
    let dungeon = db
        .dungeon(route.dungeon_idx)
        .ok_or_else(|| format!("dungeon index {} not in MDT database", route.dungeon_idx))?;

    // Clamp to the keystone floor (2) so the emitted `keystone_level=` and the
    // enemy health (which `calculate_enemy_health` also floors at 2) agree — an
    // overview/serialize with no level chosen would otherwise pair a declared
    // level 0 with level-2-scaled health.
    let keystone_level = opts.keystone_level.unwrap_or(route.keystone_level).max(2);

    // max_time is required: a 0 would make SimC end every iteration at t=0.
    let max_time = dungeon
        .timer_max_seconds
        .ok_or_else(|| format!("dungeon '{}' has no timer; cannot build a route", dungeon.name))?;
    // keystone.guru names the primary enemy actor after the route, or after the
    // dungeon when there's no route text (an overview or a map-built route).
    let title = if route.text.trim().is_empty() {
        dungeon.name.clone()
    } else {
        route.text.clone()
    }
    .replace('"', "'");

    let delays = super::travel::calculate_delays(route, dungeon);

    // Each pull's display color, resolved once (its own, or a palette slot by
    // index) so the pull lines and the full mob layer below agree.
    let pull_colors: Vec<String> = route
        .pulls
        .iter()
        .enumerate()
        .map(|(i, p)| p.color.clone().unwrap_or_else(|| pull_palette_color(i)))
        .collect();

    let mut pull_lines = Vec::new();
    let mut map_pulls = Vec::new();
    let mut enemy_count = 0;
    let mut total_health = 0;
    let mut unresolved = 0;
    let mut npc_counts: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();

    for (i, pull) in route.pulls.iter().enumerate() {
        let mut specifiers = Vec::new();
        let mut mapped_clones = 0usize;
        npc_counts.clear();
        for entry in &pull.enemies {
            let Some(enemy) = dungeon.enemies.get(&entry.enemy_idx) else {
                unresolved += entry.clone_indices.len();
                continue;
            };
            let full_health = calculate_enemy_health(
                enemy.is_boss,
                enemy.health,
                keystone_level,
                enemy.ignore_fortified,
            );
            // slug + simmed health are the same for every clone of this enemy.
            let slug = sim_slug(&enemy.name, enemy.is_boss);
            let sim_health = full_health * opts.hp_percent / 100;
            // One specifier per clone in this pull — each clone is its own mob.
            for &clone_idx in &entry.clone_indices {
                let n = { let c = npc_counts.entry(enemy.id).or_default(); *c += 1; *c };
                specifiers.push(format!("\"{slug}_{n}\":{sim_health}"));
                enemy_count += 1;
                total_health += full_health;
                if enemy.clones.contains_key(&clone_idx) {
                    // Drawn from the full mob layer below; here we only count it.
                    mapped_clones += 1;
                } else {
                    // Clone index unknown to the DB (MDT version drift): the
                    // mob is still simmed but cannot be drawn on the map.
                    unresolved += 1;
                }
            }
        }
        // Emit a map pull only when at least one of its clones can be placed, so
        // a fully-unresolved pull contributes no orphan color entry.
        if mapped_clones > 0 {
            map_pulls.push(MapPull {
                index: i + 1,
                color: pull_colors[i].clone(),
            });
        }
        if specifiers.is_empty() {
            continue;
        }
        pull_lines.push(format!(
            "raid_events+=/pull,pull={:02},bloodlust=0,delay={:03},enemies={}",
            i + 1,
            delays.get(i).copied().unwrap_or(0),
            specifiers.join("|")
        ));
    }

    // Full mob layer: every clone of every enemy, tagged with pull membership.
    // First map (enemy_idx, clone_idx) -> (pull number, color) from the route.
    let mut pull_of: std::collections::HashMap<(i64, i64), (usize, String)> =
        std::collections::HashMap::new();
    for (i, pull) in route.pulls.iter().enumerate() {
        for entry in &pull.enemies {
            for &clone_idx in &entry.clone_indices {
                pull_of.insert((entry.enemy_idx, clone_idx), (i + 1, pull_colors[i].clone()));
            }
        }
    }

    let mut all_enemies = Vec::new();
    for (&enemy_idx, enemy) in &dungeon.enemies {
        // health + race are identical for every clone of this enemy.
        let health =
            calculate_enemy_health(enemy.is_boss, enemy.health, keystone_level, enemy.ignore_fortified);
        let race = enemy.creature_type.to_lowercase();
        for (&clone_idx, pos) in &enemy.clones {
            let (pull, color) = match pull_of.get(&(enemy_idx, clone_idx)) {
                Some((p, c)) => (Some(*p), Some(c.clone())),
                None => (None, None),
            };
            all_enemies.push(MapEnemy {
                enemy_idx,
                clone_idx,
                x: pos.x,
                y: pos.y,
                sublevel: pos.sublevel,
                name: enemy.name.clone(),
                is_boss: enemy.is_boss,
                scale: enemy.scale,
                count: enemy.count,
                health,
                race: race.clone(),
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

    let header = format!(
"fight_style=DungeonRoute
override.bloodlust=0
override.arcane_intellect=0
override.power_word_fortitude=0
override.mark_of_the_wild=0
override.battle_shout=0
override.mystic_touch=0
override.chaos_brand=0
override.skyfury=0
override.hunters_mark=0
override.power_infusion=0
override.bleeding=0
single_actor_batch=1
max_time={max_time}
enemy=\"{title}\"
enemy_health=999999
keystone_level={keystone_level}
raid_events=/invulnerable,cooldown=5160,duration=5160,retarget=1",
    );
    let raid_events = pull_lines.join("\n");
    let simc = if raid_events.is_empty() { header } else { format!("{header}\n{raid_events}") };

    Ok(MdtSimc {
        mdt_version: db.mdt_version().to_string(),
        dungeon_name: dungeon.name.clone(),
        week: route.week,
        keystone_level,
        // Pulls that produced a raid_events line — a fully-unresolved pull (all
        // enemies missing from the DB) emits nothing, so it isn't counted.
        pull_count: pull_lines.len(),
        enemy_count,
        total_health,
        unresolved,
        simc,
        map,
    })
}

/// Slugify an NPC name like keystone.guru's `Str::slug`: lowercase, runs of
/// non-alphanumerics collapse to a single '-', trimmed; bosses get `BOSS_`.
fn sim_slug(name: &str, is_boss: bool) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for c in name.chars() {
        if c.is_alphanumeric() {
            slug.extend(c.to_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            slug.push('-');
            prev_dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if is_boss { format!("BOSS_{slug}") } else { slug }
}
