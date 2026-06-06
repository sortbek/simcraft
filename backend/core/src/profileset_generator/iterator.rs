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

use serde_json::Value;
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
#[derive(Clone)]
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
#[derive(Clone)]
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
    /// Catalyst budget for the streaming gear-validator. `None` = the request
    /// doesn't deal in catalyst (mirrors the eager path's `GearSetContext`).
    pub max_catalyst_charges: Option<u32>,
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

    /// The next global profileset name index (`Combo {n}`). Monotonic across the
    /// whole iterator. Cloud-streaming checkpoints persist this so a resumed run
    /// continues the global naming instead of re-emitting "Combo 1" and colliding
    /// with earlier chunks.
    pub fn next_name_idx(&self) -> usize {
        self.next_name_idx
    }

    /// Restore the global `Combo {n}` name counter after a [`seek`]. `seek`
    /// (re)positions the cursor but leaves `next_name_idx` at its post-`new`
    /// value (1), so a resumed run MUST call this with the checkpointed
    /// `next_name_idx` or it would re-emit "Combo 1, Combo 2, …" and collide
    /// with the names already produced by earlier (completed) chunks.
    ///
    /// [`seek`]: Self::seek
    pub fn set_next_name_idx(&mut self, next_name_idx: usize) {
        self.next_name_idx = next_name_idx;
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

        // ── 3. Validate constraints (shared funnel — see constraints.rs) ──────
        if !super::constraints::is_legal_gear_set(
            &gear_set,
            &super::constraints::GearSetContext {
                spec: &self.cfg.spec,
                max_catalyst_charges: self.cfg.max_catalyst_charges,
            },
        ) {
            return None;
        }

        // ── 4. Detect baseline gear ──────────────────────────────────────────
        let is_baseline = GEAR_SLOTS.iter().all(|slot| {
            gear_set
                .get(*slot)
                .and_then(|item| item.get("is_equipped"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true) // absent slot → doesn't count against baseline
        });

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

        // Skip combos that reproduce the baseline actor byte-for-byte. The base
        // case is all-equipped gear with no overrides. But a gem-only combo on
        // baseline gear whose effective gems EQUAL the already-socketed gems is
        // also baseline-identical (e.g. replace_gems=true and the user re-picked
        // an already-equipped gem): `set_gem_ids` with the same gem is a no-op,
        // so it would waste a sim slot on a zero-delta duplicate of the baseline.
        // (Enchant overrides always differ from equipped — axis index 0 is the
        // equipped enchant and never emits an override — so a non-empty enchant
        // map always changes something.)
        let gems_match_equipped = eff_gems.iter().all(|(slot, gids)| {
            let equipped_gems = gear_set
                .get(slot)
                .and_then(|item| item.get("simc_string"))
                .and_then(|s| s.as_str())
                .map(crate::simc_string::extract_gem_ids)
                .unwrap_or_default();
            let mut a = gids.clone();
            a.sort_unstable();
            let mut b = equipped_gems;
            b.sort_unstable();
            a == b
        });
        if is_baseline
            && effective_enchants_map.is_empty()
            && gems_match_equipped
            && talent_string.is_empty()
        {
            return None;
        }

        // ── 8. Identity key ──────────────────────────────────────────────────
        let identity_key = compute_identity_key(&IdentityInput {
            spec: &self.cfg.spec,
            gear_set: &gear_set,
            effective_enchants: &effective_enchants_map,
            effective_gems: &eff_gems,
            talent_string: &talent_string,
        });

        // ── 9. Format simc lines + build metadata ───────────────────────────
        let profileset_name = format!("Combo {}", self.next_name_idx);

        // Build slot_simc: apply enchant and gem overrides to each gear slot.
        let slot_simc: HashMap<String, String> = GEAR_SLOTS
            .iter()
            .filter_map(|slot| {
                let item = gear_set.get(*slot)?;
                let base_simc = item
                    .get("simc_string")
                    .and_then(|s| s.as_str())
                    .unwrap_or("");
                let with_enchant = if let Some(&eid) = effective_enchants_map.get(*slot) {
                    crate::simc_string::set_enchant_id(base_simc, eid)
                } else {
                    base_simc.to_string()
                };
                let item_sockets = item
                    .get("sockets")
                    .and_then(|s| s.as_u64())
                    .unwrap_or(0) as usize;
                // apply_item_gems uses item_sockets from game data as authoritative:
                // items with sockets:0 are never gemmed, regardless of socketed_item_ids.
                // replace_gems=true here because eff_gems is already filtered upstream
                // (socketless items and replace_gems=false already-gemmed items are excluded
                // during gem_slots construction in build_iterator_config).
                let with_gem = super::emit::apply_item_gems(
                    &with_enchant,
                    item_sockets,
                    slot,
                    &eff_gems,
                    true,
                );
                Some((slot.to_string(), with_gem))
            })
            .collect();

        // Talent spec for spec= override line (streaming doesn't vary specs but
        // keep the call consistent with the eager path).
        let talent_spec_name: Option<&str> = if talent_string.is_empty() {
            None
        } else {
            super::simc::extract_spec_id_from_talent_string(&talent_string)
                .and_then(crate::types::class_data::spec_id_to_name)
        };

        let profileset_simc = super::emit::emit_profileset(
            &profileset_name,
            &slot_simc,
            &talent_string,
            talent_spec_name,
            &self.cfg.spec,
        )
        .join("\n");

        // Build gear-item rows: non-equipped items (streaming has no paired
        // display slot distinction — all non-equipped items appear).
        let gear_item_rows: Vec<(String, bool, &Value)> = GEAR_SLOTS
            .iter()
            .filter_map(|slot| {
                let item = gear_set.get(*slot)?;
                let is_equipped = item
                    .get("is_equipped")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if !is_equipped {
                    Some((slot.to_string(), false, item.as_ref()))
                } else {
                    None
                }
            })
            .collect();

        // Enchant delta entries.
        let enchant_entries: Vec<serde_json::Value> = effective_enchants_map
            .iter()
            .filter(|(slot, _)| {
                // Only emit an enchant entry when there is no gear-swap for
                // that slot (the gear item entry already carries enchant_id).
                !gear_item_rows.iter().any(|(s, _, _)| s == *slot)
            })
            .map(|(slot, &eid)| {
                let info = crate::item_db::get_enchant_info(eid);
                let ename = info
                    .as_ref()
                    .and_then(|v| v.get("name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                serde_json::json!({
                    "slot": slot,
                    "type": "enchant",
                    "enchant_id": eid,
                    "name": ename,
                })
            })
            .collect();

        // Gem delta entries (one per socket per slot).
        let gem_entries: Vec<serde_json::Value> = eff_gems
            .iter()
            .flat_map(|(slot, gids)| {
                gids.iter().map(move |&gid| {
                    let info = crate::item_db::get_gem_info(gid);
                    let gname = info
                        .as_ref()
                        .and_then(|v| v.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("")
                        .to_string();
                    serde_json::json!({
                        "slot": slot,
                        "type": "gem",
                        "gem_id": gid,
                        "name": gname,
                    })
                })
            })
            .collect();

        let include_off_hand_synthetic = !gear_set.contains_key("off_hand");

        let mut meta_items = super::emit::build_combo_metadata(
            &gear_item_rows,
            &enchant_entries,
            &gem_entries,
            None, // no talent tagging in streaming path
            include_off_hand_synthetic,
        );

        // A gear-SWAP slot that ALSO receives an enchant/gem override in this
        // combo must show the OVERRIDE on its gear row, not the swapped item's
        // STATIC enchant_id/gem_id (which `item_meta` copied verbatim). Frontend
        // consumers read the gear row's `enchant_id` directly (TopGearRankings
        // ItemTag, GearSlotRow), and the enchant delta entry is intentionally
        // SUPPRESSED for swapped slots above — so without this the override is
        // invisible/wrong on that row.
        for meta in meta_items.iter_mut() {
            // Only gear rows (no `type`) carry a `slot` that can collide with an axis.
            if meta.get("type").is_some() {
                continue;
            }
            let Some(slot) = meta
                .get("slot")
                .and_then(|s| s.as_str())
                .map(str::to_string)
            else {
                continue;
            };
            let is_swap = gear_item_rows.iter().any(|(s, _, _)| *s == slot);
            if !is_swap {
                continue;
            }
            if let Some(&eid) = effective_enchants_map.get(&slot) {
                meta["enchant_id"] = serde_json::json!(eid);
            }
            if let Some(gids) = eff_gems.get(&slot) {
                meta["gem_id"] = serde_json::json!(gids.first().copied().unwrap_or(0));
            }
        }
        let metadata = serde_json::json!(meta_items);

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
            max_catalyst_charges: None,
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
            max_catalyst_charges: None,
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
    fn gem_only_axis_yields_equipped_gear_with_gem_delta() {
        crate::test_support::ensure_game_data_loaded();

        let mut slot_item_lists = HashMap::new();
        slot_item_lists.insert("head".to_string(), vec![arc_item(100, "head", true, 1)]);
        let mut socketed_item_ids = HashSet::new();
        socketed_item_ids.insert(100);
        let mut gem_combo = GemCombo::new();
        gem_combo.insert("head".to_string(), vec![240898]);

        let cfg = ProfilesetIteratorConfig {
            spec: "mistweaver".to_string(),
            base_profile: Arc::from(""),
            slot_item_lists,
            varying_slots: vec![],
            enchant_axes: vec![],
            gem_combo_count: 1,
            gem_combos_resolver: GemCombosResolver::new(vec![gem_combo]),
            socketed_item_ids,
            talent_builds: vec![],
            max_catalyst_charges: None,
        };

        let yielded: Vec<_> = ProfilesetIterator::new(cfg).collect();
        assert_eq!(yielded.len(), 1);
        assert!(
            yielded[0].profileset_simc.contains("gem_id=240898"),
            "gem-only profileset should be emitted with gem override: {}",
            yielded[0].profileset_simc
        );
    }

    /// Build an equipped, socketed item whose simc_string ALREADY carries `gem`.
    fn arc_item_with_gem(id: u64, slot: &str, gem: u64) -> Arc<Value> {
        Arc::new(json!({
            "item_id": id,
            "slot": slot,
            "simc_string": format!(",id={},gem_id={}", id, gem),
            "is_equipped": true,
            "sockets": 1,
            "bonus_ids": [],
            "enchant_id": 0,
            "gem_id": gem,
            "ilevel": 0,
            "name": format!("Item {}", id),
            "origin": "bags",
        }))
    }

    fn gem_only_iter(slot_gem: u64, combo_gem: u64) -> Vec<ProfilesetCandidate> {
        let mut slot_item_lists = HashMap::new();
        slot_item_lists.insert(
            "head".to_string(),
            vec![arc_item_with_gem(100, "head", slot_gem)],
        );
        let mut socketed_item_ids = HashSet::new();
        socketed_item_ids.insert(100);
        let mut gem_combo = GemCombo::new();
        gem_combo.insert("head".to_string(), vec![combo_gem]);

        let cfg = ProfilesetIteratorConfig {
            spec: "mistweaver".to_string(),
            base_profile: Arc::from(""),
            slot_item_lists,
            varying_slots: vec![],
            enchant_axes: vec![],
            gem_combo_count: 1,
            gem_combos_resolver: GemCombosResolver::new(vec![gem_combo]),
            socketed_item_ids,
            talent_builds: vec![],
            max_catalyst_charges: None,
        };
        ProfilesetIterator::new(cfg).collect()
    }

    #[test]
    fn baseline_gem_equal_to_equipped_is_not_emitted() {
        crate::test_support::ensure_game_data_loaded();
        // Equipped head already has gem 5001; the gem axis re-assigns the SAME
        // gem 5001 (e.g. replace_gems=true, user re-picked the equipped gem).
        // `set_gem_ids` would be a no-op → byte-identical to baseline → must skip.
        let same = gem_only_iter(5001, 5001);
        assert!(
            same.is_empty(),
            "a baseline-identical gem combo must not be emitted, got: {:?}",
            same.iter().map(|c| &c.profileset_simc).collect::<Vec<_>>()
        );

        // A DIFFERENT gem 5002 genuinely changes the actor → still emitted.
        let diff = gem_only_iter(5001, 5002);
        assert_eq!(diff.len(), 1, "a distinct gem must still be emitted");
        assert!(diff[0].profileset_simc.contains("gem_id=5002"));
    }

    #[test]
    fn swapped_slot_gear_row_carries_override_enchant_and_gem() {
        crate::test_support::ensure_game_data_loaded();

        // head: equipped 100 (gemless) + alt 200 (socketed). The alt is the swap.
        let mut slot_item_lists = HashMap::new();
        slot_item_lists.insert(
            "head".to_string(),
            vec![
                arc_item(100, "head", true, 0),
                arc_item(200, "head", false, 1),
            ],
        );
        let mut socketed_item_ids = HashSet::new();
        socketed_item_ids.insert(200);

        // Enchant axis on head: index 0 = equipped (none), index 1 = override 9999.
        let enchant_axes = vec![EnchantAxis {
            slot: "head".to_string(),
            options: vec![0, 9999],
        }];
        // Gem combo assigns gem 5005 to head.
        let mut gem_combo = GemCombo::new();
        gem_combo.insert("head".to_string(), vec![5005]);

        let cfg = ProfilesetIteratorConfig {
            spec: "mistweaver".to_string(),
            base_profile: Arc::from(""),
            slot_item_lists,
            varying_slots: vec!["head".to_string()],
            enchant_axes,
            gem_combo_count: 1,
            gem_combos_resolver: GemCombosResolver::new(vec![gem_combo]),
            socketed_item_ids,
            talent_builds: vec![],
            max_catalyst_charges: None,
        };

        let mut it = ProfilesetIterator::new(cfg);
        // Find the candidate that swaps head to 200 AND applies the enchant override.
        let cand = it
            .find(|c| {
                c.profileset_simc.contains("id=200")
                    && c.profileset_simc.contains("enchant_id=9999")
            })
            .expect("expected a swapped+enchanted candidate");

        let items = cand.metadata.as_array().expect("metadata array");
        let head = items
            .iter()
            .find(|v| v["slot"] == "head" && v.get("type").is_none())
            .expect("head gear row required");
        assert_eq!(
            head["enchant_id"],
            json!(9999),
            "swapped slot gear row must carry the OVERRIDE enchant, not the item's static enchant_id: {head:?}"
        );
        assert_eq!(
            head["gem_id"],
            json!(5005),
            "swapped slot gear row must carry the override gem: {head:?}"
        );
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

    #[test]
    fn set_next_name_idx_continues_naming_after_seek() {
        // seek resets the cursor but leaves next_name_idx at 1; a resumed run
        // restores the global counter so emitted names continue (no collision
        // with names earlier chunks already produced).
        let cfg = make_cfg();
        let mut iter = ProfilesetIterator::new(cfg);
        assert!(iter.seek(vec![0, 0, 0]));
        iter.set_next_name_idx(50);
        assert_eq!(iter.next_name_idx(), 50);
        let first = iter.next().expect("one candidate after seek");
        assert_eq!(
            first.profileset_name, "Combo 50",
            "restored next_name_idx must drive the first emitted name"
        );
    }

    #[test]
    fn streaming_iterator_enforces_catalyst_budget() {
        use crate::test_support::{ensure_game_data_loaded, TestItem};
        ensure_game_data_loaded();

        let make_cfg = |budget: Option<u32>| {
            let mut slot_item_lists: HashMap<String, Vec<Arc<Value>>> = HashMap::new();
            slot_item_lists.insert(
                "head".into(),
                vec![
                    Arc::new(TestItem::new(102).build()),
                    Arc::new(TestItem::new(101).catalyst().build()),
                ],
            );
            slot_item_lists.insert(
                "chest".into(),
                vec![
                    Arc::new(TestItem::new(202).build()),
                    Arc::new(TestItem::new(201).catalyst().build()),
                ],
            );
            ProfilesetIteratorConfig {
                spec: "arms".into(),
                base_profile: Arc::from(""),
                slot_item_lists,
                varying_slots: vec!["chest".into(), "head".into()],
                enchant_axes: vec![],
                gem_combo_count: 0,
                gem_combos_resolver: GemCombosResolver::new(vec![]),
                socketed_item_ids: HashSet::new(),
                talent_builds: vec![],
                max_catalyst_charges: budget,
            }
        };

        let count = |budget| {
            let mut it = ProfilesetIterator::new(make_cfg(budget));
            let mut n = 0usize;
            while it.next().is_some() {
                n += 1;
            }
            n
        };

        let with_budget = count(Some(1));
        let without_budget = count(None);
        assert_eq!(
            without_budget - with_budget,
            1,
            "budget=1 must filter exactly the double-catalyst combo that budget=None admits"
        );
    }

    /// Shape-parity test (Task D2): after convergence, streaming metadata must
    /// match the eager metadata shape for a single gear-swap combo.
    #[test]
    fn streaming_metadata_matches_eager_shape_for_single_swap() {
        // make_cfg() has head: equipped 100 + alt 200, no gems/enchants/talents.
        let cfg = make_cfg();
        let mut it = ProfilesetIterator::new(cfg);
        let cand = it.next().expect("one candidate from single-slot config");

        let items = cand
            .metadata
            .as_array()
            .expect("metadata must be a JSON array");

        // Head item must appear with correct eager-shape fields.
        let head = items
            .iter()
            .find(|v| v["slot"] == "head")
            .expect("head entry required");
        assert_eq!(head["item_id"], json!(200), "head item_id mismatch");
        assert_eq!(head["is_kept"], json!(false), "head is_kept must be false");
        assert!(
            head.get("origin").is_some(),
            "origin field required by eager shape; got: {head:?}"
        );
        assert!(
            head.get("ilevel").is_some(),
            "ilevel field required by eager shape"
        );
        assert!(
            head.get("bonus_ids").is_some(),
            "bonus_ids field required by eager shape"
        );
        assert!(
            head.get("enchant_id").is_some(),
            "enchant_id field required by eager shape"
        );
        assert!(
            head.get("gem_id").is_some(),
            "gem_id field required by eager shape"
        );

        // Synthetic off_hand entry must be present (eager shape).
        assert!(
            items.iter().any(|v| v["slot"] == "off_hand"),
            "synthetic off_hand entry required by eager shape; got: {items:?}"
        );
    }
}
