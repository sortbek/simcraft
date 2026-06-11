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

#[derive(Debug, Clone, Serialize)]
pub struct MdtSimc {
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
}

pub fn generate(route: &MdtRoute, db: &DungeonDb) -> Result<MdtSimc, String> {
    let dungeon = db
        .dungeon(route.dungeon_idx)
        .ok_or_else(|| format!("dungeon index {} not in MDT database", route.dungeon_idx))?;

    let mut pull_lines = Vec::new();
    let mut enemy_count = 0;
    let mut total_health = 0;
    let mut unresolved = 0;

    for (i, pull) in route.pulls.iter().enumerate() {
        let mut specifiers = Vec::new();
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
            // One specifier per clone in this pull — each clone is its own mob.
            for _ in &entry.clone_indices {
                specifiers.push(format!("\"{name}\":{health}:{race}"));
                enemy_count += 1;
                total_health += health;
            }
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

    let raid_events = pull_lines.join("\n");
    let simc = if raid_events.is_empty() {
        "fight_style=DungeonRoute".to_string()
    } else {
        format!("fight_style=DungeonRoute\n{raid_events}")
    };

    Ok(MdtSimc {
        dungeon_name: dungeon.name.clone(),
        week: route.week,
        keystone_level: route.keystone_level,
        pull_count: route.pulls.len(),
        enemy_count,
        total_health,
        unresolved,
        raid_events,
        simc,
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
