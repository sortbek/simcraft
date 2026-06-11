//! Port of MDT's `CalculateEnemyHealth` (MythicDungeonTools.lua).
//!
//! In the current MDT version Fortified and Tyrannical are always applied (fort
//! to non-boss trash, tyr to bosses, at keystone level >= 4), independent of the
//! affix week — so `week` does not affect the health number, only the per-enemy
//! `is_boss` / `ignore_fortified` flags and the keystone level do.

const FORT_MULT: f64 = 1.2;
const TYR_MULT: f64 = 1.25;
const SCALING_NORMAL: f64 = 1.07;
const SCALING_EXTRA: f64 = 1.1; // Xal'atath's Guile, applied past EXTRA_SCALING_LEVEL
const EXTRA_SCALING_LEVEL: i64 = 11;

/// Mirror MDT's `round` (Lua `string.format("%.Nf")` + `tonumber`).
fn round(x: f64, decimals: usize) -> f64 {
    format!("{x:.decimals$}").parse().unwrap_or(x)
}

fn fort_tyr_mult(level: i64, boss: bool, ignore_fortified: bool) -> f64 {
    let mut mult = 1.0;
    if level >= 4 {
        if !boss && !ignore_fortified {
            mult *= FORT_MULT;
        }
        if boss {
            mult *= TYR_MULT;
        }
    }
    mult
}

fn scaling(mult: f64, level: i64) -> f64 {
    let normal = SCALING_NORMAL.powi((level - 1).min(EXTRA_SCALING_LEVEL - 2) as i32);
    let extra = SCALING_EXTRA.powi((level - EXTRA_SCALING_LEVEL + 1).max(0) as i32);
    round(mult * normal * extra, 2)
}

/// Effective enemy health at the given keystone `level`.
pub fn calculate_enemy_health(
    boss: bool,
    base_health: i64,
    level: i64,
    ignore_fortified: bool,
) -> i64 {
    let mult = scaling(fort_tyr_mult(level, boss, ignore_fortified), level);
    round(mult * base_health as f64, 0) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_2_trash_applies_only_base_scaling() {
        // level 2 < 4 -> no fort/tyr; scaling = 1.07^1 = 1.07.
        // Enemy 1 of Seat of the Triumvirate: base 1974499.
        assert_eq!(calculate_enemy_health(false, 1974499, 2, false), 2112714);
    }

    #[test]
    fn boss_gets_tyrannical_above_level_4() {
        // level 10 boss: tyr 1.25 * 1.07^9. round(1.25*1.838459..,2)=2.30; *1000000.
        let h = calculate_enemy_health(true, 1_000_000, 10, false);
        assert_eq!(h, 2_300_000);
    }
}
