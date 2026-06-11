//! Typed view of a decoded MDT preset.
//!
//! The export string carries only structural data: which dungeon, which affix
//! week, the keystone level, and the ordered pulls (each a list of enemy +
//! clone indices). Enemy NPC ids, health and counts are NOT in the string —
//! they live in the static MDT dungeon database keyed by `dungeon_idx` and the
//! per-enemy index.

use super::ace::AceValue;

#[derive(Debug, Clone, PartialEq)]
pub struct MdtRoute {
    /// MDT-internal dungeon index (`value.currentDungeonIdx`).
    pub dungeon_idx: i64,
    /// Affix-week index (`week`); selects Fortified vs Tyrannical via the static
    /// `affixWeeks` table.
    pub week: i64,
    /// Keystone level (`difficulty`); 0 if the string did not include it.
    pub keystone_level: i64,
    /// Pulls in route order.
    pub pulls: Vec<MdtPull>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MdtPull {
    pub enemies: Vec<MdtPullEnemy>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MdtPullEnemy {
    /// Index into `MDT.dungeonEnemies[dungeon_idx]`.
    pub enemy_idx: i64,
    /// Which clones of that enemy are part of this pull.
    pub clone_indices: Vec<i64>,
}

/// Interpret a deserialized AceSerializer preset into an [`MdtRoute`].
pub fn parse_route(preset: &AceValue) -> Result<MdtRoute, String> {
    let preset = preset
        .as_table()
        .ok_or("preset is not a table")?;

    let week = preset
        .get_str("week")
        .and_then(AceValue::as_int)
        .ok_or("missing 'week'")?;
    let keystone_level = preset
        .get_str("difficulty")
        .and_then(AceValue::as_int)
        .unwrap_or(0);

    let value = preset
        .get_str("value")
        .and_then(AceValue::as_table)
        .ok_or("missing 'value' table")?;
    let dungeon_idx = value
        .get_str("currentDungeonIdx")
        .and_then(AceValue::as_int)
        .ok_or("missing 'currentDungeonIdx'")?;

    let pulls_table = value
        .get_str("pulls")
        .and_then(AceValue::as_table)
        .ok_or("missing 'pulls' table")?;

    let pulls = pulls_table
        .int_entries()
        .into_iter()
        .map(|(_, pull)| parse_pull(pull))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(MdtRoute {
        dungeon_idx,
        week,
        keystone_level,
        pulls,
    })
}

fn parse_pull(pull: &AceValue) -> Result<MdtPull, String> {
    let pull = pull.as_table().ok_or("pull is not a table")?;
    // Integer keys are enemy indices; string keys (e.g. "color") are metadata.
    let enemies = pull
        .int_entries()
        .into_iter()
        .map(|(enemy_idx, clones)| MdtPullEnemy {
            enemy_idx,
            clone_indices: clone_indices(clones),
        })
        .collect();
    Ok(MdtPull { enemies })
}

/// The value for an enemy key is a sequence table of clone indices.
fn clone_indices(clones: &AceValue) -> Vec<i64> {
    let Some(table) = clones.as_table() else {
        return Vec::new();
    };
    table
        .int_entries()
        .into_iter()
        .filter_map(|(_, v)| v.as_int())
        .collect()
}
