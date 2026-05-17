use std::collections::{HashMap, HashSet};

use super::simc::{combinations, gem_color, is_diamond};

pub struct GemCombosBuilder<'a> {
    pub gem_options: &'a [u64],
    pub gem_slots: &'a [String],
    pub diamond_ids: &'a [u64],
    pub diamond_always_use: bool,
    pub max_colors: bool,
}

/// Generate colored gem combos for a set of non-diamond slots.
/// Corresponds to the `gen_color_combos` closure in the original top_gear.rs.
fn gen_color_combos(slots: &[String], gems: &[u64], max_colors: bool) -> Vec<HashMap<String, u64>> {
    if slots.is_empty() {
        return vec![HashMap::new()];
    }
    if gems.is_empty() {
        return vec![HashMap::new()];
    }
    if max_colors {
        let mut by_color: HashMap<String, Vec<u64>> = HashMap::new();
        for &gid in gems {
            let color = gem_color(gid).unwrap_or_else(|| "other".to_string());
            by_color.entry(color).or_default().push(gid);
        }
        let colors: Vec<String> = by_color.keys().cloned().collect();
        let n_colors = colors.len().min(slots.len());

        let color_combos = combinations(&colors, n_colors);
        let mut result: Vec<HashMap<String, u64>> = Vec::new();
        for color_set in &color_combos {
            let per_slot_gems: Vec<&Vec<u64>> =
                color_set.iter().map(|c| by_color.get(c).unwrap()).collect();
            let mut slot_combos: Vec<Vec<u64>> = vec![vec![]];
            for slot_gems in &per_slot_gems {
                let mut next = Vec::new();
                for combo in &slot_combos {
                    for &gid in *slot_gems {
                        let mut c = combo.clone();
                        c.push(gid);
                        next.push(c);
                    }
                }
                slot_combos = next;
            }
            for slot_combo in slot_combos {
                let combo: HashMap<String, u64> = slot_combo
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i < slots.len())
                    .map(|(i, &gid)| (slots[i].clone(), gid))
                    .collect();
                result.push(combo);
            }
        }
        result
    } else {
        // Cartesian product: each slot independently gets each gem,
        // then deduplicate mirror combos (gems are slot-independent).
        let mut result: Vec<HashMap<String, u64>> = vec![HashMap::new()];
        for slot in slots {
            let mut next = Vec::new();
            for combo in &result {
                for &gid in gems {
                    let mut c = combo.clone();
                    c.insert(slot.clone(), gid);
                    next.push(c);
                }
            }
            result = next;
        }
        dedupe_gem_assignments(result, 0)
    }
}

fn dedupe_gem_assignments(
    combos: Vec<HashMap<String, u64>>,
    max_diamonds: usize,
) -> Vec<HashMap<String, u64>> {
    let mut seen: HashSet<Vec<u64>> = HashSet::new();
    let mut result = Vec::new();

    for combo in combos {
        let diamond_count = combo.values().filter(|&&gid| is_diamond(gid)).count();
        if diamond_count > max_diamonds {
            continue;
        }

        let mut key: Vec<u64> = combo.values().copied().collect();
        key.sort();
        if seen.insert(key) {
            result.push(combo);
        }
    }

    result
}

/// Materialize the full Vec of gem assignments. Behavior MUST match the
/// pre-extraction code at top_gear.rs:284-462 exactly. Used by the eager
/// path (below-threshold jobs) and by the streaming iterator's resolver.
pub fn enumerate_all(b: &GemCombosBuilder) -> Vec<HashMap<String, u64>> {
    let gems = b.gem_options;
    let gem_slots = b.gem_slots;
    let diamond_ids = b.diamond_ids;
    let diamond_always_use = b.diamond_always_use;
    let max_colors = b.max_colors;

    if gems.is_empty() && diamond_ids.is_empty() {
        Vec::new()
    } else if !diamond_ids.is_empty() && diamond_always_use {
        // Diamond always-use: try exactly one diamond in each socketed slot position.
        let mut result: Vec<HashMap<String, u64>> = Vec::new();
        for (d_idx, d_slot) in gem_slots.iter().enumerate() {
            let remaining: Vec<String> = gem_slots
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != d_idx)
                .map(|(_, s)| s.clone())
                .collect();
            let color_combos = gen_color_combos(&remaining, gems, max_colors);
            for &did in diamond_ids {
                for base in &color_combos {
                    let mut combo = base.clone();
                    combo.insert(d_slot.clone(), did);
                    result.push(combo);
                }
            }
        }
        dedupe_gem_assignments(result, 1)
    } else if !diamond_ids.is_empty() {
        // Diamond optional: allow either no diamond or exactly one diamond, never more.
        let mut result = if gems.is_empty() {
            Vec::new()
        } else {
            gen_color_combos(gem_slots, gems, max_colors)
        };

        for (d_idx, d_slot) in gem_slots.iter().enumerate() {
            let remaining: Vec<String> = gem_slots
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != d_idx)
                .map(|(_, s)| s.clone())
                .collect();
            let color_combos = gen_color_combos(&remaining, gems, max_colors);
            for &did in diamond_ids {
                for base in &color_combos {
                    let mut combo = base.clone();
                    combo.insert(d_slot.clone(), did);
                    result.push(combo);
                }
            }
        }

        dedupe_gem_assignments(result, 1)
    } else {
        gen_color_combos(gem_slots, gems, max_colors)
    }
}

/// Phase 1 minimal implementation: pre-materialized Vec, yielded one at a time.
/// True streaming is deferred until calibration shows it's needed.
pub struct GemCombosIterator {
    all: Vec<HashMap<String, u64>>,
    pos: usize,
}

impl GemCombosIterator {
    pub fn new(b: &GemCombosBuilder) -> Self {
        Self {
            all: enumerate_all(b),
            pos: 0,
        }
    }
}

impl Iterator for GemCombosIterator {
    type Item = HashMap<String, u64>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.pos >= self.all.len() {
            return None;
        }
        let v = std::mem::take(&mut self.all[self.pos]);
        self.pos += 1;
        Some(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::ensure_game_data_loaded;

    #[test]
    fn iterator_yields_same_as_enumerate_all() {
        ensure_game_data_loaded();
        let slots = vec!["head".to_string(), "wrist".to_string()];
        let gems = vec![100u64, 200u64];
        let b = GemCombosBuilder {
            gem_options: &gems,
            gem_slots: &slots,
            diamond_ids: &[],
            diamond_always_use: false,
            max_colors: false,
        };
        let direct = enumerate_all(&b);
        let iter_collected: Vec<_> = GemCombosIterator::new(&b).collect();
        assert_eq!(direct.len(), iter_collected.len());
        for (a, c) in direct.iter().zip(iter_collected.iter()) {
            assert_eq!(a, c);
        }
    }

    #[test]
    fn empty_gems_empty_result() {
        let slots = vec!["head".to_string()];
        let b = GemCombosBuilder {
            gem_options: &[],
            gem_slots: &slots,
            diamond_ids: &[],
            diamond_always_use: false,
            max_colors: false,
        };
        assert!(enumerate_all(&b).is_empty());
    }
}
