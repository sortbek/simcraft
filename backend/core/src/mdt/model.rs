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
    /// Drawn polyline annotations from the preset's `objects` table.
    pub lines: Vec<MdtLine>,
}

/// A drawn polyline annotation from the MDT preset's `objects`.
#[derive(Debug, Clone, PartialEq)]
pub struct MdtLine {
    pub sublevel: i64,
    /// Polyline vertices in MDT map coordinates, in draw order.
    pub points: Vec<(f64, f64)>,
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

    let lines = parse_lines(preset);

    Ok(MdtRoute {
        dungeon_idx,
        week,
        keystone_level,
        text,
        pulls,
        lines,
    })
}

fn parse_lines(preset: &super::ace::AceTable) -> Vec<MdtLine> {
    let Some(objects) = preset.get_str("objects").and_then(AceValue::as_table) else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    for (_, obj) in objects.int_entries_ordered() {
        let Some(obj) = obj.as_table() else { continue };
        // Notes have a truthy `n`; lines have `l`.
        if matches!(obj.get_str("n"), Some(AceValue::Bool(true))) {
            continue;
        }
        let Some(l) = obj.get_str("l").and_then(AceValue::as_table) else { continue };
        let coords: Vec<f64> = l.int_entries().into_iter().filter_map(|(_, v)| as_f64(v)).collect();
        if coords.len() < 4 {
            continue; // need at least two points
        }
        let sublevel = obj
            .get_str("d")
            .and_then(AceValue::as_table)
            .and_then(|d| d.int_entries().into_iter().find(|(k, _)| *k == 3).and_then(|(_, v)| v.as_int()))
            .unwrap_or(1);
        let points = coords.chunks_exact(2).map(|c| (c[0], c[1])).collect();
        lines.push(MdtLine { sublevel, points });
    }
    lines
}

/// Coerce an AceValue number or numeric string to f64 (MDT stores some coords as strings).
fn as_f64(v: &AceValue) -> Option<f64> {
    match v {
        AceValue::Int(i) => Some(*i as f64),
        AceValue::Float(f) => Some(*f),
        AceValue::Str(s) => s.parse().ok(),
        _ => None,
    }
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

    #[test]
    fn parses_line_objects_skipping_notes() {
        // objects = { [1] = { n=true, d={...} },              -- a note, skipped
        //             [2] = { l={0,0,10,5}, d={ [3]=1 } } }   -- a line on sublevel 1
        let s = "^1^T^Stext^SR^Sweek^N1^Sdifficulty^N2^Svalue^T^ScurrentDungeonIdx^N151^Spulls^T^t^t\
                 ^Sobjects^T\
                 ^N1^T^Sn^B^Sd^T^N1^N5^N2^N5^t^t\
                 ^N2^T^Sl^T^N1^N0^N2^N0^N3^N10^N4^N5^t^Sd^T^N3^N1^t^t\
                 ^t^t^^";
        let v = crate::mdt::ace::deserialize(s).unwrap();
        let route = parse_route(&v).unwrap();
        assert_eq!(route.lines.len(), 1, "one line, the note is skipped");
        assert_eq!(route.lines[0].sublevel, 1);
        assert_eq!(route.lines[0].points, vec![(0.0, 0.0), (10.0, 5.0)]);
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
