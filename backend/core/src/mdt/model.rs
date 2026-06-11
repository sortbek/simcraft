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
    /// The preset's display name (`text`), used for the SimC `enemy="..."` line.
    pub text: String,
    /// Pulls in route order.
    pub pulls: Vec<MdtPull>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MdtPull {
    pub enemies: Vec<MdtPullEnemy>,
    /// Pull color as a 6-char hex string (no `#`), if the route set one.
    pub color: Option<String>,
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

    let text = preset
        .get_str("text")
        .and_then(|v| match v { AceValue::Str(s) => Some(s.clone()), _ => None })
        .unwrap_or_default();
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
        text,
        pulls,
    })
}

fn parse_pull(pull: &AceValue) -> Result<MdtPull, String> {
    let pull = pull.as_table().ok_or("pull is not a table")?;
    // Integer keys are enemy indices; string keys (e.g. "color") are metadata.
    let enemies = pull
        .int_entries_ordered()
        .into_iter()
        .map(|(enemy_idx, clones)| MdtPullEnemy {
            enemy_idx,
            clone_indices: clone_indices(clones),
        })
        .collect();
    let color = match pull.get_str("color") {
        Some(AceValue::Str(s)) => Some(s.clone()),
        _ => None,
    };
    Ok(MdtPull { enemies, color })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mdt::ace;

    #[test]
    fn parses_text_and_preserves_enemy_order() {
        // preset { text="My Route", week=2, difficulty=14,
        //          value={ currentDungeonIdx=151,
        //                  pulls={ [1]={ [5]={[1]=1}, [1]={[1]=1} } } } }
        let s = "^1^T^Stext^SMy Route^Sweek^N2^Sdifficulty^N14^Svalue^T\
                 ^ScurrentDungeonIdx^N151^Spulls^T^N1^T^N5^T^N1^N1^t^N1^T^N1^N1^t^t^t^t^t^^";
        let v = ace::deserialize(s).unwrap();
        let route = parse_route(&v).unwrap();
        assert_eq!(route.text, "My Route");
        assert_eq!(route.keystone_level, 14);
        let order: Vec<i64> = route.pulls[0].enemies.iter().map(|e| e.enemy_idx).collect();
        assert_eq!(order, vec![5, 1], "enemy order must follow storage, not be sorted");
    }
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
