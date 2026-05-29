//! Streaming `ProfilesetIterator` over the full Top Gear product space.
//!
//! Produces one [`ProfilesetCandidate`] at a time with O(axes) memory.
//! The existing eager generator in `top_gear.rs` is untouched.
//!
//! ## Axis layout (cursor indices)
//!
//! `cursor[0..varying_slots.len()]`           — gear choice per varying slot
//! `cursor[gear..]..gear+enchant_axes.len()]`  — enchant option per axis
//! `cursor[gear+enchant]`                      — gem combo index
//! `cursor[gear+enchant+1]`                    — talent build index

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use super::gem_combos::GemCombo;
use super::identity_key::{compute_identity_key, effective_gems, IdentityInput};
use crate::types::class_data::GEAR_SLOTS;

// ── Public types ─────────────────────────────────────────────────────────────

/// One candidate profileset yielded by the iterator.
#[derive(Debug, Clone)]
pub struct ProfilesetCandidate {
    /// Cursor position at the moment of emission (for resume/checkpointing).
    pub cursor_at_emission: Vec<usize>,
    /// e.g. `"Combo 42"`
    pub profileset_name: String,
    /// Full simc lines for this profileset (with `profileset."Combo N"+=` prefix).
    pub profileset_simc: String,
    /// Metadata value (mirrors the combo_metadata entries from the eager path).
    pub metadata: Value,
    /// Stable 32-hex-char identity key (dedup handle for Triage).
    pub identity_key: String,
}

/// One enchant variation axis: a slot and its candidate enchant IDs.
/// `options[0]` must be the currently-equipped enchant ID (0 if unenchanted).
#[derive(Debug, Clone)]
pub struct EnchantAxis {
    pub slot: String,
    pub options: Vec<u64>,
}

/// Wrapper around a pre-built gem combo list. Each entry maps slot →
/// `Vec<gem_id>` of length equal to the slot's socket count (1 for
/// single-socket items, 2+ for crafted/socketed necks etc.).
pub struct GemCombosResolver {
    inner: Vec<GemCombo>,
}

impl GemCombosResolver {
    pub fn new(combos: Vec<GemCombo>) -> Self {
        Self { inner: combos }
    }
    pub fn nth(&self, i: usize) -> Option<&GemCombo> {
        self.inner.get(i)
    }
    pub fn len(&self) -> usize {
        self.inner.len()
    }
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }
}

/// Configuration for [`ProfilesetIterator`].
pub struct ProfilesetIteratorConfig {
    pub spec: String,
    pub base_profile: Arc<str>,
    /// All items per slot (including the equipped one).
    pub slot_item_lists: HashMap<String, Vec<Arc<Value>>>,
    /// Slots with more than one choice (sorted deterministically).
    pub varying_slots: Vec<String>,
    /// Enchant variation axes.
    pub enchant_axes: Vec<EnchantAxis>,
    /// Total number of gem combos (from `GemCombosResolver::len()`).
    pub gem_combo_count: usize,
    pub gem_combos_resolver: GemCombosResolver,
    /// Item IDs known to carry a socket.
    pub socketed_item_ids: HashSet<u64>,
    /// `(name, talent_string)` pairs. Empty → treated as a single pass with no talent override.
    pub talent_builds: Vec<(String, String)>,
}

// ── Iterator ─────────────────────────────────────────────────────────────────

pub struct ProfilesetIterator {
    cfg: ProfilesetIteratorConfig,
    cursor: Vec<usize>,
    axis_sizes: Vec<usize>,
    done: bool,
    next_name_idx: usize,
}

impl ProfilesetIterator {
    pub fn new(cfg: ProfilesetIteratorConfig) -> Self {
        let mut axis_sizes = Vec::new();

        // Gear axes.
        for slot in &cfg.varying_slots {
            let sz = cfg.slot_item_lists.get(slot).map(|v| v.len()).unwrap_or(1);
            axis_sizes.push(sz);
        }

        // Enchant axes.
        for ea in &cfg.enchant_axes {
            axis_sizes.push(ea.options.len());
        }

        // Gem axis (always 1 axis; size ≥ 1 so the loop fires even with no gem combos).
        axis_sizes.push(cfg.gem_combo_count.max(1));

        // Talent axis.
        axis_sizes.push(cfg.talent_builds.len().max(1));

        let cursor = vec![0usize; axis_sizes.len()];
        // Terminate immediately if any axis has size 0 (can't enumerate).
        let done = axis_sizes.contains(&0);

        Self {
            cfg,
            cursor,
            axis_sizes,
            done,
            next_name_idx: 1,
        }
    }

    /// Seek to a specific cursor position (for resume). Returns `true` if valid.
    pub fn seek(&mut self, cursor: Vec<usize>) -> bool {
        if cursor.len() != self.axis_sizes.len() {
            return false;
        }
        for (i, &v) in cursor.iter().enumerate() {
            if v >= self.axis_sizes[i] {
                return false;
            }
        }
        self.cursor = cursor;
        self.done = false;
        true
    }

    /// Current cursor position.
    pub fn cursor(&self) -> &[usize] {
        &self.cursor
    }

    fn advance(&mut self) {
        let mut i = self.cursor.len();
        while i > 0 {
            i -= 1;
            self.cursor[i] += 1;
            if self.cursor[i] < self.axis_sizes[i] {
                return;
            }
            self.cursor[i] = 0;
        }
        self.done = true;
    }

    fn build_candidate(&self) -> Option<ProfilesetCandidate> {
        // ── 1. Build gear set ────────────────────────────────────────────────
        let mut gear_set: HashMap<String, Arc<Value>> = HashMap::new();
        for (slot, items) in &self.cfg.slot_item_lists {
            let default = items
                .iter()
                .find(|it| {
                    it.get("is_equipped")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                })
                .unwrap_or(&items[0]);
            gear_set.insert(slot.clone(), Arc::clone(default));
        }
        for (i, slot) in self.cfg.varying_slots.iter().enumerate() {
            let idx = self.cursor[i];
            if let Some(items) = self.cfg.slot_item_lists.get(slot) {
                if let Some(item) = items.get(idx) {
                    gear_set.insert(slot.clone(), Arc::clone(item));
                }
            }
        }

        // ── 2. 2H normalization ──────────────────────────────────────────────
        if super::constraints::main_hand_is_two_hand(&gear_set, &self.cfg.spec) {
            gear_set.remove("off_hand");
        }

        // ── 3. Validate constraints ──────────────────────────────────────────
        if !super::constraints::validate_unique_equipped(&gear_set) {
            return None;
        }
        if !super::constraints::validate_vault_constraint(&gear_set) {
            return None;
        }
        if !super::constraints::validate_weapon_constraint(&gear_set, &self.cfg.spec) {
            return None;
        }
        if !super::constraints::validate_item_limits(&gear_set) {
            return None;
        }

        // ── 4. Skip baseline (all-equipped gear) ─────────────────────────────
        let is_baseline = GEAR_SLOTS.iter().all(|slot| {
            gear_set
                .get(*slot)
                .and_then(|item| item.get("is_equipped"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true) // absent slot → doesn't count against baseline
        });
        if is_baseline {
            return None;
        }

        // ── 5. Resolve enchants ──────────────────────────────────────────────
        let gear_axes_count = self.cfg.varying_slots.len();
        let mut effective_enchants_map: HashMap<String, u64> = HashMap::new();
        for (i, ea) in self.cfg.enchant_axes.iter().enumerate() {
            let opt_idx = self.cursor[gear_axes_count + i];
            // Index 0 = equipped baseline (no override needed in effective_enchants).
            if opt_idx > 0 {
                if let Some(&enchant_id) = ea.options.get(opt_idx) {
                    if enchant_id != 0 {
                        effective_enchants_map.insert(ea.slot.clone(), enchant_id);
                    }
                }
            }
        }

        // ── 6. Resolve gems ──────────────────────────────────────────────────
        let gem_axis_idx = gear_axes_count + self.cfg.enchant_axes.len();
        let gem_combo_idx = self.cursor[gem_axis_idx];
        let nominal_gems: GemCombo = self
            .cfg
            .gem_combos_resolver
            .nth(gem_combo_idx)
            .cloned()
            .unwrap_or_default();
        let eff_gems = effective_gems(&gear_set, &nominal_gems, &self.cfg.socketed_item_ids);

        // ── 7. Resolve talent ────────────────────────────────────────────────
        let talent_idx = self.cursor[self.cursor.len() - 1];
        let (_, talent_string) = self
            .cfg
            .talent_builds
            .get(talent_idx)
            .cloned()
            .unwrap_or_else(|| ("".to_string(), "".to_string()));

        // ── 8. Identity key ──────────────────────────────────────────────────
        let identity_key = compute_identity_key(&IdentityInput {
            spec: &self.cfg.spec,
            gear_set: &gear_set,
            effective_enchants: &effective_enchants_map,
            effective_gems: &eff_gems,
            talent_string: &talent_string,
        });

        // ── 9. Format simc lines ─────────────────────────────────────────────
        let profileset_name = format!("Combo {}", self.next_name_idx);
        let profileset_simc = format_streaming_profileset_lines(
            &profileset_name,
            &gear_set,
            &effective_enchants_map,
            &eff_gems,
            &talent_string,
        );

        // ── 10. Build metadata ───────────────────────────────────────────────
        let metadata = build_streaming_metadata(&gear_set, &effective_enchants_map, &eff_gems);

        Some(ProfilesetCandidate {
            cursor_at_emission: self.cursor.clone(),
            profileset_name,
            profileset_simc,
            metadata,
            identity_key,
        })
    }
}

impl Iterator for ProfilesetIterator {
    type Item = ProfilesetCandidate;

    fn next(&mut self) -> Option<Self::Item> {
        while !self.done {
            let candidate = self.build_candidate();
            self.advance();
            if let Some(c) = candidate {
                self.next_name_idx += 1;
                return Some(c);
            }
        }
        None
    }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/// Produce simc profileset lines for one candidate.
///
/// Known duplication: the eager path in `top_gear.rs` has equivalent inline
/// logic. Consolidation pending calibration work.
fn format_streaming_profileset_lines(
    name: &str,
    gear_set: &HashMap<String, Arc<Value>>,
    effective_enchants: &HashMap<String, u64>,
    effective_gems: &HashMap<String, Vec<u64>>,
    talent_string: &str,
) -> String {
    let mut lines: Vec<String> = Vec::new();

    for slot in GEAR_SLOTS {
        if let Some(item) = gear_set.get(*slot) {
            let base_simc = item
                .get("simc_string")
                .and_then(|s| s.as_str())
                .unwrap_or("");

            // Apply enchant override if any.
            let with_enchant = if let Some(&eid) = effective_enchants.get(*slot) {
                crate::simc_string::set_enchant_id(base_simc, eid)
            } else {
                base_simc.to_string()
            };

            // Apply gems. `set_gem_ids` handles both single- and multi-socket
            // cases by emitting `gem_id=A/B` for multi-gem lists; an empty
            // list leaves the line untouched.
            let with_gem = if let Some(gids) = effective_gems.get(*slot) {
                if gids.is_empty() {
                    with_enchant
                } else {
                    crate::simc_string::set_gem_ids(&with_enchant, gids)
                }
            } else {
                with_enchant
            };

            lines.push(format!("profileset.\"{}\"+={}={}", name, slot, with_gem));
        } else if *slot == "off_hand" {
            // Emit explicit empty off_hand when main_hand is 2H (gear_set won't have it).
            lines.push(format!("profileset.\"{}\"+=off_hand=,", name));
        }
    }

    if !talent_string.is_empty() {
        lines.push(format!(
            "profileset.\"{}\"+=talents={}",
            name, talent_string
        ));
    }

    lines.join("\n")
}

/// Build a minimal metadata Value for one candidate.
///
/// Returns a JSON object (not array) with the key fields the Triage layer
/// needs. The eager path returns `Vec<Value>` per combo; for the streaming
/// path a single object is simpler and sufficient.
///
/// Known duplication with the eager path's inline metadata building.
fn build_streaming_metadata(
    gear_set: &HashMap<String, Arc<Value>>,
    effective_enchants: &HashMap<String, u64>,
    effective_gems: &HashMap<String, Vec<u64>>,
) -> Value {
    let mut items: Vec<Value> = Vec::new();
    for slot in GEAR_SLOTS {
        if let Some(item) = gear_set.get(*slot) {
            let is_equipped = item
                .get("is_equipped")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if !is_equipped {
                let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
                let ilevel = item.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0);
                let name = item
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let bonus_ids = item.get("bonus_ids").cloned().unwrap_or(json!([]));
                let enchant_id = effective_enchants.get(*slot).copied().unwrap_or_else(|| {
                    item.get("enchant_id").and_then(|v| v.as_u64()).unwrap_or(0)
                });
                let gem_ids_vec: Vec<u64> = effective_gems
                    .get(*slot)
                    .cloned()
                    .or_else(|| {
                        item.get("gem_id")
                            .and_then(|v| v.as_u64())
                            .filter(|g| *g > 0)
                            .map(|g| vec![g])
                    })
                    .unwrap_or_default();
                // Keep `gem_id` populated for downstream consumers that read
                // the single-gem field; emit the full list under `gem_ids`.
                let gem_id_first = gem_ids_vec.first().copied().unwrap_or(0);
                let origin = item
                    .get("origin")
                    .and_then(|v| v.as_str())
                    .unwrap_or("bags")
                    .to_string();
                items.push(json!({
                    "slot": slot,
                    "item_id": item_id,
                    "ilevel": ilevel,
                    "name": name,
                    "bonus_ids": bonus_ids,
                    "enchant_id": enchant_id,
                    "gem_id": gem_id_first,
                    "gem_ids": gem_ids_vec,
                    "is_kept": false,
                    "origin": origin,
                }));
            }
        }
    }
    // Enchant overrides that don't correspond to a gear swap.
    for (slot, &eid) in effective_enchants {
        if !items.iter().any(|i| i["slot"] == *slot) {
            let info = crate::item_db::get_enchant_info(eid);
            let ename = info
                .as_ref()
                .and_then(|v| v.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string();
            items.push(json!({
                "slot": slot,
                "type": "enchant",
                "enchant_id": eid,
                "name": ename,
            }));
        }
    }
    // Gem overrides — emit one entry per socket so a 2-gem neck produces
    // two metadata rows (matches the eager-path shape).
    for (slot, gids) in effective_gems {
        for &gid in gids {
            let info = crate::item_db::get_gem_info(gid);
            let gname = info
                .as_ref()
                .and_then(|v| v.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string();
            items.push(json!({
                "slot": slot,
                "type": "gem",
                "gem_id": gid,
                "name": gname,
            }));
        }
    }
    json!(items)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn arc_item(id: u64, slot: &str, equipped: bool, sockets: u64) -> Arc<Value> {
        Arc::new(json!({
            "item_id": id,
            "slot": slot,
            "simc_string": format!(",id={}", id),
            "is_equipped": equipped,
            "sockets": sockets,
            "bonus_ids": [],
            "enchant_id": 0,
            "gem_id": 0,
            "ilevel": 0,
            "name": format!("Item {}", id),
            "origin": "bags",
        }))
    }

    fn make_cfg() -> ProfilesetIteratorConfig {
        let mut slot_item_lists = HashMap::new();
        slot_item_lists.insert(
            "head".to_string(),
            vec![
                arc_item(100, "head", true, 0),
                arc_item(200, "head", false, 0),
            ],
        );
        ProfilesetIteratorConfig {
            spec: "mistweaver".to_string(),
            base_profile: Arc::from(""),
            slot_item_lists,
            varying_slots: vec!["head".to_string()],
            enchant_axes: vec![],
            gem_combo_count: 0,
            gem_combos_resolver: GemCombosResolver::new(vec![]),
            socketed_item_ids: HashSet::new(),
            talent_builds: vec![],
        }
    }

    #[test]
    fn empty_axes_iterator_terminates() {
        let cfg = ProfilesetIteratorConfig {
            spec: "mistweaver".to_string(),
            base_profile: Arc::from(""),
            slot_item_lists: HashMap::new(),
            varying_slots: vec![],
            enchant_axes: vec![],
            gem_combo_count: 0,
            gem_combos_resolver: GemCombosResolver::new(vec![]),
            socketed_item_ids: HashSet::new(),
            talent_builds: vec![],
        };
        let iter = ProfilesetIterator::new(cfg);
        assert_eq!(iter.count(), 0);
    }

    #[test]
    fn single_gear_axis_yields_non_baseline_only() {
        let cfg = make_cfg();
        let iter = ProfilesetIterator::new(cfg);
        let yielded: Vec<_> = iter.collect();
        // The equipped variant is baseline (skipped); only the alternative remains.
        assert_eq!(yielded.len(), 1);
        assert_eq!(yielded[0].profileset_name, "Combo 1");
    }

    #[test]
    fn cursor_seek_invalid_returns_false() {
        let cfg = make_cfg();
        let mut iter = ProfilesetIterator::new(cfg);
        // axis_sizes = [2(head), 1(gem), 1(talent)] = 3 axes.
        // cursor len mismatch → false.
        assert!(!iter.seek(vec![999, 0, 0, 0]));
    }

    #[test]
    fn cursor_seek_valid_returns_true() {
        let cfg = make_cfg();
        let mut iter = ProfilesetIterator::new(cfg);
        // axis_sizes = [2(head), 1(gem), 1(talent)] = 3 axes.
        // cursor [0, 0, 0] is valid (all within bounds).
        assert!(iter.seek(vec![0, 0, 0]));
    }
}
