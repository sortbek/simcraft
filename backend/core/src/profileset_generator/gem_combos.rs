use std::collections::{HashMap, HashSet};

use super::simc::{combinations, gem_color, is_diamond};

/// One gem-combo entry: per slot, the list of gem ids (length = socket count
/// for that slot). Order inside the Vec doesn't matter for dedup — `gem_id=A/B`
/// and `gem_id=B/A` are equivalent in SimC and we collapse them.
pub type GemCombo = HashMap<String, Vec<u64>>;

pub struct GemCombosBuilder<'a> {
    pub gem_options: &'a [u64],
    /// (slot, socket count). Counts > 1 make `gen_color_combos` emit per-slot
    /// multisets of that size.
    pub gem_slots: &'a [(String, usize)],
    pub diamond_ids: &'a [u64],
    pub diamond_always_use: bool,
    pub max_colors: bool,
}

/// All k-element multisets (combinations with repetition) of `items`.
/// e.g. `multisets(&[A,B,C], 2)` -> AA, AB, AC, BB, BC, CC.
fn multisets<T: Clone>(items: &[T], k: usize) -> Vec<Vec<T>> {
    if k == 0 {
        return vec![vec![]];
    }
    if items.is_empty() {
        return vec![];
    }
    let mut result = Vec::new();
    for (i, item) in items.iter().enumerate() {
        // Slice from `i` (not `i+1`) allows repetition; index-based recursion
        // pins order so we never emit both `A,B` and `B,A`.
        for mut sub in multisets(&items[i..], k - 1) {
            sub.insert(0, item.clone());
            result.push(sub);
        }
    }
    result
}

/// Generate colored gem combos for a set of `(slot, socket_count)` entries.
/// In max_colors mode each *slot* picks a single color shared across all of
/// its sockets, and distinct slots pick distinct colors. Within a slot, the
/// K sockets become a K-multiset of that slot's color.
fn gen_color_combos(slots: &[(String, usize)], gems: &[u64], max_colors: bool) -> Vec<GemCombo> {
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

        // Precompute per-(color, socket_count) multisets so we don't
        // regenerate the same list inside the slot loop below.
        let mut multisets_cache: HashMap<(String, usize), Vec<Vec<u64>>> = HashMap::new();
        for (color, gems_for_color) in &by_color {
            for (_, socket_count) in slots {
                multisets_cache
                    .entry((color.clone(), *socket_count))
                    .or_insert_with(|| multisets(gems_for_color, *socket_count));
            }
        }

        let mut result: Vec<GemCombo> = Vec::new();
        for color_set in combinations(&colors, n_colors) {
            let mut current: Vec<GemCombo> = vec![HashMap::new()];
            for (slot_idx, (slot, socket_count)) in slots.iter().enumerate() {
                let color = &color_set[slot_idx % color_set.len()];
                let slot_multisets = &multisets_cache[&(color.clone(), *socket_count)];
                let mut next = Vec::new();
                for combo in &current {
                    for ms in slot_multisets {
                        let mut c = combo.clone();
                        c.insert(slot.clone(), ms.clone());
                        next.push(c);
                    }
                }
                // Collapse permutation-equivalent partials each step so the
                // accumulator stays polynomial (see non-max_colors branch).
                current = dedupe_gem_assignments(next, 0);
            }
            result.extend(current);
        }
        dedupe_gem_assignments(result, 0)
    } else {
        // Each slot independently picks a K-multiset of gems where K is its
        // socket count. Cross-slot product, then dedup mirror combos.
        let mut result: Vec<GemCombo> = vec![HashMap::new()];
        for (slot, socket_count) in slots {
            let slot_multisets = multisets(gems, *socket_count);
            let mut next = Vec::new();
            for combo in &result {
                for ms in &slot_multisets {
                    let mut c = combo.clone();
                    c.insert(slot.clone(), ms.clone());
                    next.push(c);
                }
            }
            // Dedup the partial accumulator after each slot. Dedup keys on the
            // flat sorted gem list, so two partials with the same flat multiset
            // extend identically — collapsing here is loss-free and keeps the
            // accumulator polynomial instead of materializing gems^slots first.
            result = dedupe_gem_assignments(next, 0);
        }
        result
    }
}

fn dedupe_gem_assignments(combos: Vec<GemCombo>, max_diamonds: usize) -> Vec<GemCombo> {
    let mut seen: HashSet<Vec<u64>> = HashSet::new();
    let mut result = Vec::new();

    for combo in combos {
        let diamond_count = combo
            .values()
            .flat_map(|gids| gids.iter())
            .filter(|&&gid| is_diamond(gid))
            .count();
        if diamond_count > max_diamonds {
            continue;
        }

        // Gems are character-wide — a gem in head vs neck (or A,B vs B,A) is the
        // same DPS. Dedup on the flat sorted gem list to skip permutation dupes.
        let mut key: Vec<u64> = combo
            .values()
            .flat_map(|gids| gids.iter().copied())
            .collect();
        key.sort();
        if seen.insert(key) {
            result.push(combo);
        }
    }

    result
}

/// Materialize the full Vec of gem assignments (slot → `Vec<gem_id>` sized to
/// the slot's socket count). Used by the eager path and the iterator's resolver.
pub fn enumerate_all(b: &GemCombosBuilder) -> Vec<GemCombo> {
    let gems = b.gem_options;
    let gem_slots = b.gem_slots;
    let diamond_ids = b.diamond_ids;
    let diamond_always_use = b.diamond_always_use;
    let max_colors = b.max_colors;

    if gems.is_empty() && diamond_ids.is_empty() {
        Vec::new()
    } else if !diamond_ids.is_empty() && diamond_always_use {
        let placements = build_diamond_placements(gem_slots, gems, diamond_ids, max_colors);
        dedupe_gem_assignments(placements, 1)
    } else if !diamond_ids.is_empty() {
        // Diamond optional: allow either no diamond or exactly one diamond.
        let mut result = if gems.is_empty() {
            Vec::new()
        } else {
            gen_color_combos(gem_slots, gems, max_colors)
        };
        result.extend(build_diamond_placements(
            gem_slots,
            gems,
            diamond_ids,
            max_colors,
        ));
        dedupe_gem_assignments(result, 1)
    } else {
        gen_color_combos(gem_slots, gems, max_colors)
    }
}

/// Build combos where exactly one diamond is placed in some socket of one
/// slot. Other sockets in the diamond slot are filled with a colored-gem
/// multiset; other slots get full multiset combos via `gen_color_combos`.
fn build_diamond_placements(
    gem_slots: &[(String, usize)],
    gems: &[u64],
    diamond_ids: &[u64],
    max_colors: bool,
) -> Vec<GemCombo> {
    let mut result: Vec<GemCombo> = Vec::new();
    for (d_slot_idx, (d_slot, d_socket_count)) in gem_slots.iter().enumerate() {
        let remaining: Vec<(String, usize)> = gem_slots
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != d_slot_idx)
            .map(|(_, sw)| sw.clone())
            .collect();
        let other_combos = gen_color_combos(&remaining, gems, max_colors);

        // Fill the diamond slot's remaining sockets (count-1) with a colored-gem
        // multiset. With none left, the lone diamond is still valid — the empty
        // filler truncates to a single gem at apply time.
        let other_socket_count = d_socket_count.saturating_sub(1);
        let same_slot_fillers: Vec<Vec<u64>> = if other_socket_count == 0 || gems.is_empty() {
            vec![vec![]]
        } else {
            multisets(gems, other_socket_count)
        };

        for &did in diamond_ids {
            for base in &other_combos {
                for filler in &same_slot_fillers {
                    let mut combo = base.clone();
                    let mut slot_gems = vec![did];
                    slot_gems.extend(filler.iter().copied());
                    combo.insert(d_slot.clone(), slot_gems);
                    result.push(combo);
                }
            }
        }
    }
    result
}

/// Phase 1 minimal implementation: pre-materialized Vec, yielded one at a time.
/// True streaming is deferred until calibration shows it's needed.
pub struct GemCombosIterator {
    all: Vec<GemCombo>,
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
    type Item = GemCombo;
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
        let slots = vec![("head".to_string(), 1), ("wrist".to_string(), 1)];
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
    fn cross_slot_dedup_matches_multiset_count() {
        // 5 single-socket slots, 5 gems: naive product is 5^5=3125, but gems are
        // character-wide so the deduped count is size-5 multisets of 5 = C(9,5)=126
        // (must hold whether dedup is incremental or final).
        ensure_game_data_loaded();
        let slots: Vec<(String, usize)> = ["head", "neck", "wrist", "hands", "waist"]
            .iter()
            .map(|s| (s.to_string(), 1))
            .collect();
        let gems = vec![100u64, 200, 300, 400, 500];
        let b = GemCombosBuilder {
            gem_options: &gems,
            gem_slots: &slots,
            diamond_ids: &[],
            diamond_always_use: false,
            max_colors: false,
        };
        let combos = enumerate_all(&b);
        assert_eq!(combos.len(), 126, "expected C(9,5)=126 deduped multisets");
        for c in &combos {
            assert_eq!(c.len(), 5, "every slot must be assigned: {c:?}");
            for gids in c.values() {
                assert_eq!(gids.len(), 1, "single-socket slot gets one gem: {gids:?}");
            }
        }
    }

    #[test]
    fn empty_gems_empty_result() {
        let slots = vec![("head".to_string(), 1)];
        let b = GemCombosBuilder {
            gem_options: &[],
            gem_slots: &slots,
            diamond_ids: &[],
            diamond_always_use: false,
            max_colors: false,
        };
        assert!(enumerate_all(&b).is_empty());
    }

    #[test]
    fn two_socket_slot_emits_multisets() {
        // 3 gems, 1 slot with 2 sockets → 6 multisets: AA, AB, AC, BB, BC, CC.
        ensure_game_data_loaded();
        let slots = vec![("neck".to_string(), 2)];
        let gems = vec![100u64, 200u64, 300u64];
        let b = GemCombosBuilder {
            gem_options: &gems,
            gem_slots: &slots,
            diamond_ids: &[],
            diamond_always_use: false,
            max_colors: false,
        };
        let combos = enumerate_all(&b);
        assert_eq!(
            combos.len(),
            6,
            "expected 6 multisets (3 gems × 2 sockets), got {} :\n{:?}",
            combos.len(),
            combos
        );
        for combo in &combos {
            let gems = combo.get("neck").expect("neck slot missing");
            assert_eq!(gems.len(), 2, "neck must carry 2 gems: {:?}", gems);
        }
    }
}
