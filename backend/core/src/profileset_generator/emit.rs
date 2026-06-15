//! Shared simc-line emit and per-combo metadata builders for both the eager
//! generator (`top_gear.rs`) and the streaming iterator (`iterator.rs`).
//!
//! Shape contract: both paths produce the **eager** metadata shape (production
//! contract) — `Vec<Value>` per combo, per-slot objects with
//! `{slot, item_id, ilevel, name, bonus_ids, enchant_id, gem_id, is_kept, origin}`,
//! plus enchant/gem delta entries and a synthetic empty `off_hand` entry when the
//! gear set has no off_hand (two-hand main_hand case).

use serde_json::{json, Value};
use std::collections::HashMap;

use crate::types::class_data::GEAR_SLOTS;

/// Apply a gem-combo's gem ids to one item's simc string, gated by the item's
/// OWN socket count (authoritative — its resolved `"sockets"` game-data field,
/// NOT the simc string's bonus-id or existing gem count). No-op when
/// `item_sockets == 0` or (`!replace_gems` and the simc already has a gem).
/// Gem ids are truncated to `item_sockets` (a 2-gem combo on a 1-socket item
/// writes one id).
pub(super) fn apply_item_gems(
    item_simc: &str,
    item_sockets: usize,
    slot: &str,
    gem_combo: &crate::profileset_generator::gem_combos::GemCombo,
    replace_gems: bool,
) -> String {
    if item_sockets == 0 {
        return item_simc.to_string();
    }
    if !replace_gems && crate::simc_string::extract_gem_id(item_simc) > 0 {
        return item_simc.to_string();
    }
    match gem_combo.get(slot) {
        Some(gids) => {
            let take = gids.len().min(item_sockets);
            crate::simc_string::set_gem_ids(item_simc, &gids[..take])
        }
        None => item_simc.to_string(),
    }
}

/// Emit the "# Base Actor" header block for the eager generator: header,
/// non-gear lines, `### Combo 1`, equipped gear (explicit empty `off_hand` if
/// absent), optional `talents=`/`spec=` overrides, trailing blank line.
pub(super) fn emit_base_actor(
    base_lines: &[String],
    equipped_gear: &HashMap<String, String>,
    base_talent: &str,
    base_actor_spec: &str,
    original_spec: &str,
) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    lines.push("# Base Actor".to_string());
    lines.extend(base_lines.iter().cloned());
    lines.push("### Combo 1".to_string());
    for slot in GEAR_SLOTS {
        if let Some(gear_val) = equipped_gear.get(*slot) {
            lines.push(format!("{}={}", slot, gear_val));
        } else if *slot == "off_hand" {
            lines.push("off_hand=,".to_string());
        }
    }
    if !base_talent.is_empty() {
        lines.push(format!("talents={}", base_talent));
        if base_actor_spec != original_spec {
            lines.push(format!("spec={}", base_actor_spec));
        }
    }
    lines.push(String::new());
    lines
}

/// Emit one profileset's simc lines: `profileset."<name>"+=<slot>=<value>` for
/// each `GEAR_SLOTS` entry present in `slot_simc` (absent slots skipped, except
/// an empty `off_hand`), plus `talents=`/`spec=` overrides.
///
/// `slot_simc`: caller-built slot → final simc (enchant/gem overrides already
/// applied). `talent_spec_name`: spec derived from `talent_string`; a `spec=`
/// line is emitted only when `Some(s)` and `s != base_actor_spec`.
pub(super) fn emit_profileset(
    name: &str,
    slot_simc: &HashMap<String, String>,
    talent_string: &str,
    talent_spec_name: Option<&str>,
    base_actor_spec: &str,
) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    lines.push(format!("### {}", name));
    for slot in GEAR_SLOTS {
        if let Some(val) = slot_simc.get(*slot) {
            lines.push(format!("profileset.\"{}\"+={}={}", name, slot, val));
        } else if *slot == "off_hand" {
            lines.push(format!("profileset.\"{}\"+=off_hand=,", name));
        }
    }
    if !talent_string.is_empty() {
        lines.push(format!(
            "profileset.\"{}\"+=talents={}",
            name, talent_string
        ));
        if let Some(spec_name) = talent_spec_name {
            if spec_name != base_actor_spec {
                lines.push(format!("profileset.\"{}\"+=spec={}", name, spec_name));
            }
        }
    }
    lines.push(String::new());
    lines
}

/// One enchant delta metadata row: `{slot, type:"enchant", enchant_id, name}`.
pub(super) fn build_enchant_entry(slot: &str, enchant_id: u64) -> Value {
    let name = crate::item_db::get_enchant_info(enchant_id)
        .as_ref()
        .and_then(|v| v.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();
    json!({ "slot": slot, "type": "enchant", "enchant_id": enchant_id, "name": name })
}

/// One gem delta metadata row: `{slot, type:"gem", gem_id, name}`.
pub(super) fn build_gem_entry(slot: &str, gem_id: u64) -> Value {
    let name = crate::item_db::get_gem_info(gem_id)
        .as_ref()
        .and_then(|v| v.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();
    json!({ "slot": slot, "type": "gem", "gem_id": gem_id, "name": name })
}

/// Build per-combo metadata for one profileset (canonical eager shape).
///
/// `gear_items`: `(slot, is_kept, item)` gear rows (paired-display + non-equipped
/// alts). `enchant_entries`/`gem_entries`: pre-built delta rows (`&[]` if none).
/// `talent_info`: `Some((build_name, talent_spec))` to tag talent variants.
/// `include_off_hand_synthetic`: append an empty `off_hand` entry when the gear
/// set lacks one (two-hand main_hand case).
pub(super) fn build_combo_metadata(
    gear_items: &[(String, bool, &Value)], // (slot, is_kept, item_value)
    enchant_entries: &[Value],
    gem_entries: &[Value],
    talent_info: Option<(&str, Option<&str>)>, // (build_name, talent_spec_str)
    include_off_hand_synthetic: bool,
) -> Vec<Value> {
    let mut combo_items: Vec<Value> = Vec::new();

    for (slot, is_kept, item) in gear_items {
        let mut meta = crate::profileset_generator::base_profile::item_meta(item, slot);
        meta["is_kept"] = json!(is_kept);
        combo_items.push(meta);
    }

    combo_items.extend_from_slice(enchant_entries);
    combo_items.extend_from_slice(gem_entries);

    if let Some((build_name, talent_spec)) = talent_info {
        if combo_items.is_empty() {
            combo_items.push(json!({
                "talent_build": build_name,
                "talent_spec": talent_spec,
                "is_kept": true,
            }));
        } else {
            for item in &mut combo_items {
                item["talent_build"] = json!(build_name);
                item["talent_spec"] = json!(talent_spec);
            }
        }
    }

    if include_off_hand_synthetic {
        combo_items.push(json!({
            "slot": "off_hand",
            "item_id": 0,
            "ilevel": 0,
            "name": "",
            "bonus_ids": [],
            "enchant_id": 0,
            "gem_id": 0,
            "is_kept": false,
            "origin": "system",
        }));
    }

    combo_items
}
