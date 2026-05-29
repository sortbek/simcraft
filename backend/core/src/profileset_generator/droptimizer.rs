use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;

use super::base_profile::parse_base_profile;
use super::constraints::{is_legal_gear_set, GearSetContext};
use crate::simc_string::{extract_bonus_ids, extract_item_id};
use crate::types::class_data::{self, GEAR_SLOTS};

/// Validate that placing `drop_item_id` (with `drop_bonus_ids`) in `target_slot`
/// — while every other slot keeps its equipped item — yields a legal gear set
/// under the shared `is_legal_gear_set` rules. False = skip the combo; the
/// user can still see the comparison via the combo for the slot that holds
/// the conflicting copy (which gets replaced, not duplicated).
///
/// Mirrors the profileset-emission normalization where a 2H drop in main_hand
/// for non-Fury clears the off_hand — the candidate gear set must match the
/// gear set simc actually receives, or the weapon-pairing check would flag a
/// state that doesn't exist in the emitted profileset.
fn drop_combo_is_valid(
    equipped: &HashMap<String, String>,
    target_slot: &str,
    drop_item_id: u64,
    drop_bonus_ids: &[u64],
    drop_inv_type: u64,
    spec: &str,
) -> bool {
    let mut candidate: HashMap<String, Value> = HashMap::with_capacity(GEAR_SLOTS.len());
    for slot in GEAR_SLOTS {
        if *slot == target_slot {
            candidate.insert(
                slot.to_string(),
                json!({
                    "item_id": drop_item_id,
                    "bonus_ids": drop_bonus_ids,
                }),
            );
        } else if let Some(eq) = equipped.get(*slot) {
            candidate.insert(
                slot.to_string(),
                json!({
                    "item_id": extract_item_id(eq),
                    "bonus_ids": extract_bonus_ids(eq),
                }),
            );
        }
    }
    if target_slot == "main_hand" && drop_inv_type == 17 && spec != "fury" {
        candidate.remove("off_hand");
    }
    is_legal_gear_set(
        &candidate,
        &GearSetContext {
            spec,
            max_catalyst_charges: None,
        },
    )
}

pub(super) fn generate_droptimizer_input(
    base_profile: &str,
    drop_items: &[Value],
) -> (String, usize, HashMap<String, Value>) {
    let (base_lines, equipped_gear, talents_string, spec) = parse_base_profile(base_profile);

    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: HashMap<String, Value> = HashMap::new();

    lines.push("# Base Actor".to_string());
    lines.extend(base_lines);
    lines.push("### Combo 1".to_string());
    for slot in GEAR_SLOTS {
        if let Some(gear) = equipped_gear.get(*slot) {
            lines.push(format!("{}={}", slot, gear));
        } else if *slot == "off_hand" {
            lines.push("off_hand=,".to_string());
        }
    }
    if !talents_string.is_empty() {
        lines.push(format!("talents={}", talents_string));
    }
    lines.push(String::new());

    let has_two_hand_equipped = {
        let oh = equipped_gear.get("off_hand").map(|s| s.trim());
        oh.is_none() || oh == Some("") || oh == Some(",")
    };

    // Backend is the single source of truth for inheritance: copy enchant_id
    // and gem_id from the equipped item in the drop's target slot. The
    // frontend used to send a precomputed `slot_inherits` array; that field
    // is now ignored (and removed from the frontend payload) because the
    // browser shouldn't be calculating simulation semantics. SimC is
    // tolerant of `gem_id=` on items without sockets (treated as no-op), so
    // unconditional inheritance is safe.
    let legacy_enchant_re = Regex::new(r"enchant_id=(\d+)").unwrap();
    let legacy_gem_re = Regex::new(r"gem_id=([\d/]+)").unwrap();

    let mut combo_idx = 2usize;
    for item in drop_items {
        let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
        let ilevel = item.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0);
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let encounter = item
            .get("encounter")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let inv_type = item
            .get("inventory_type")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let bonus_ids: Vec<u64> = item
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
            .unwrap_or_default();
        // `slot_inherits` is intentionally ignored; kept in the type for
        // backwards-compatible API requests but no longer authoritative.
        let mut slots = class_data::inv_type_to_slots(inv_type, &spec);

        if has_two_hand_equipped && !(spec == "fury" && inv_type == 17) {
            slots.retain(|s| *s != "off_hand");
        }

        if slots.is_empty() {
            continue;
        }

        let mut base_simc_str = format!(",id={},ilevel={}", item_id, ilevel);
        if !bonus_ids.is_empty() {
            let bonus_str = bonus_ids
                .iter()
                .map(|b| b.to_string())
                .collect::<Vec<_>>()
                .join("/");
            base_simc_str.push_str(&format!(",bonus_id={}", bonus_str));
        }

        for slot in &slots {
            // Validate the gear set this combo would produce against the same
            // unique-equipped + item-limit-category rules Top Gear enforces.
            // Two checks fall out:
            //   - Same item_id in both paired slots (rings/trinkets) → drop
            //     in the unequipped slot would duplicate the equipped copy.
            //   - A bonus-id item-limit category exceeded → e.g. "max 1 of
            //     this trinket type" hit because the equipped slot we're
            //     *not* replacing already holds one. The combo for the slot
            //     that holds the conflicting copy still emits — that's the
            //     "would replacing this slot be better" sim.
            if !drop_combo_is_valid(&equipped_gear, slot, item_id, &bonus_ids, inv_type, &spec) {
                continue;
            }

            let mut simc_str = base_simc_str.clone();
            let mut applied_enchant: u64 = 0;
            let mut applied_gem: u64 = 0;

            // Derive enchant + gem inheritance from the equipped item in the
            // target slot. The browser used to compute this and send it as
            // `slot_inherits`; that responsibility now lives entirely here.
            if let Some(equipped) = equipped_gear.get(*slot) {
                if let Some(caps) = legacy_enchant_re.captures(equipped) {
                    if let Ok(eid) = caps[1].parse::<u64>() {
                        if eid > 0 {
                            simc_str.push_str(&format!(",enchant_id={}", eid));
                            applied_enchant = eid;
                        }
                    }
                }
                // Only inherit a gem when the DROP item actually has a socket.
                // The equipped item may have a socket-adding bonus (e.g. neck/
                // ring sockets, or socket-added wrist/head/waist crafted items)
                // that the drop does not — copying the equipped gem onto a
                // socketless drop simulates gear that can't exist.
                //
                // Sockets in current-expansion data come exclusively from
                // bonus IDs, so empty bonus_ids ⇒ 0 sockets without needing
                // to hit the bonus DB (also keeps unit tests that don't load
                // game data working).
                let drop_sockets = if bonus_ids.is_empty() {
                    0
                } else {
                    crate::item_db::resolve_bonuses(&bonus_ids)
                        .sockets
                        .unwrap_or(0)
                };
                if drop_sockets > 0 {
                    if let Some(caps) = legacy_gem_re.captures(equipped) {
                        // Inherit the first equipped gem id. Multi-gem drops
                        // are rare in the Drop Finder flow; Top Gear / Enchant
                        // Gem handle full multi-socket coverage.
                        if let Some(first) = caps[1].split('/').next() {
                            if let Ok(gid) = first.parse::<u64>() {
                                if gid > 0 {
                                    simc_str.push_str(&format!(",gem_id={}", gid));
                                    applied_gem = gid;
                                }
                            }
                        }
                    }
                }
            }

            let combo_name = format!("Combo {}", combo_idx);
            lines.push(format!("### {}", combo_name));
            lines.push(format!(
                "profileset.\"{}\"+={}={}",
                combo_name, slot, simc_str
            ));
            if inv_type == 17 && *slot == "main_hand" && spec != "fury" {
                lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
            }
            if !talents_string.is_empty() {
                lines.push(format!(
                    "profileset.\"{}\"+=talents={}",
                    combo_name, talents_string
                ));
            }
            lines.push(String::new());

            combo_metadata.insert(
                combo_name.clone(),
                json!([{
                    "slot": slot,
                    "item_id": item_id,
                    "ilevel": ilevel,
                    "name": name,
                    "bonus_ids": bonus_ids,
                    "enchant_id": applied_enchant,
                    "gem_id": applied_gem,
                    "is_kept": false,
                    "encounter": encounter,
                }]),
            );
            combo_idx += 1;
        }
    }

    let combo_count = combo_idx - 2;
    (lines.join("\n"), combo_count, combo_metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drop(item_id: u64, inv_type: u64, bonus_ids: Vec<u64>) -> Value {
        json!({
            "item_id": item_id,
            "ilevel": 600,
            "name": format!("Drop {}", item_id),
            "encounter": "Boss",
            "inventory_type": inv_type,
            "bonus_ids": bonus_ids,
        })
    }

    #[test]
    fn unknown_inv_type_skipped() {
        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let drops = vec![drop(999, 99, vec![])]; // inv_type 99 = no slots
        let (_, count, _) = generate_droptimizer_input(profile, &drops);
        assert_eq!(count, 0);
    }

    #[test]
    fn two_hand_drop_clears_off_hand_for_non_fury() {
        let profile = "\
warrior=test\n\
spec=arms\n\
main_hand=,id=200\n\
off_hand=,id=201\n";
        let drops = vec![drop(999, 17, vec![])]; // inv_type 17 = 2H weapon
        let (input, count, _) = generate_droptimizer_input(profile, &drops);
        assert_eq!(count, 1);
        assert!(input.contains("main_hand=,id=999"));
        assert!(
            input.contains("profileset.\"Combo 2\"+=off_hand=,"),
            "expected off_hand cleared for arms 2H:\n{input}"
        );
    }

    #[test]
    fn two_hand_drop_kept_dual_wield_for_fury() {
        let profile = "\
warrior=test\n\
spec=fury\n\
main_hand=,id=200\n\
off_hand=,id=201\n";
        let drops = vec![drop(999, 17, vec![])];
        let (input, _, _) = generate_droptimizer_input(profile, &drops);
        // Fury can wield two 2H weapons → off_hand should NOT be cleared
        assert!(
            !input.contains("profileset.\"Combo 2\"+=off_hand=,\n"),
            "fury should keep off_hand:\n{input}"
        );
    }

    #[test]
    fn drop_inherits_enchant_from_equipped_slot() {
        let profile = "mage=test\nspec=frost\nhead=,id=100,enchant_id=7777\n";
        let drops = vec![drop(999, 1, vec![])];
        let (input, _, metadata) = generate_droptimizer_input(profile, &drops);
        assert!(
            input.contains(",enchant_id=7777"),
            "expected enchant inheritance from equipped slot:\n{input}"
        );
        let combo = metadata.get("Combo 2").expect("missing combo");
        assert_eq!(combo[0]["enchant_id"], 7777);
    }

    #[test]
    fn drop_inherits_gem_from_equipped_slot_when_drop_has_socket() {
        // Gem inheritance moved from frontend slot_inherits to backend
        // derivation. Equipped neck has a gem; the drop also has a socket
        // (via bonus 13534, +1 socket per fixture data), so the drop should
        // pick up that gem id without any per-drop `slot_inherits`.
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test\nspec=frost\nneck=,id=100,gem_id=213453\n";
        let drops = vec![drop(999, 2, vec![13534])]; // inv_type 2 = neck
        let (input, _, metadata) = generate_droptimizer_input(profile, &drops);
        assert!(
            input.contains(",gem_id=213453"),
            "expected gem inheritance from equipped neck:\n{input}"
        );
        let combo = metadata.get("Combo 2").expect("missing combo");
        assert_eq!(combo[0]["gem_id"], 213453);
    }

    #[test]
    fn drop_does_not_inherit_gem_when_drop_has_no_socket() {
        // The equipped wrist has a socket-added bonus (e.g. crafted/embellished
        // wrist) and carries a gem. A plain non-crafted wrist drop has no
        // sockets — copying the equipped gem onto it would simulate gear that
        // can't exist. Inheritance must be gated on the *drop's* socket count.
        let profile = "mage=test\nspec=frost\nwrist=,id=100,gem_id=213453\n";
        let drops = vec![drop(999, 9, vec![])]; // inv_type 9 = wrist, no sockets
        let (input, _, metadata) = generate_droptimizer_input(profile, &drops);
        let combo2_line = input
            .lines()
            .find(|l| l.contains("Combo 2") && l.contains("wrist=,id=999"))
            .expect("missing wrist drop combo");
        assert!(
            !combo2_line.contains("gem_id="),
            "drop without sockets must NOT inherit the equipped gem: {combo2_line}"
        );
        let combo = metadata.get("Combo 2").expect("missing combo");
        assert_eq!(combo[0]["gem_id"], 0);
    }

    #[test]
    fn drop_ignores_slot_inherits_field_in_request() {
        // The frontend used to send a precomputed `slot_inherits` array. That
        // field is now ignored — backend derives from equipped. A request
        // that still includes it should be tolerated but treated as if
        // absent (no override of the equipped-derived values).
        let profile = "mage=test\nspec=frost\nhead=,id=100,enchant_id=7777\n";
        let drops = vec![json!({
            "item_id": 999,
            "ilevel": 600,
            "name": "Drop",
            "encounter": "Boss",
            "inventory_type": 1,
            "bonus_ids": [],
            // Stale frontend payload — backend should ignore this and still
            // pick up enchant_id 7777 from the equipped head.
            "slot_inherits": [{ "slot": "head", "enchant_id": 0, "gem_id": 0 }]
        })];
        let (input, _, _) = generate_droptimizer_input(profile, &drops);
        assert!(
            input.contains(",enchant_id=7777"),
            "slot_inherits=0 should NOT suppress equipped-derived enchant:\n{input}"
        );
    }

    #[test]
    fn drop_two_hand_clears_off_hand_only_when_one_hand_equipped() {
        // If user already has no off_hand (or 2H equipped without off_hand line),
        // the off_hand=, clear should still be emitted for a 2H drop on non-fury.
        let profile = "\
warrior=test\n\
spec=arms\n\
main_hand=,id=200\n";
        let drops = vec![drop(999, 17, vec![])];
        let (input, _, _) = generate_droptimizer_input(profile, &drops);
        assert!(input.contains("profileset.\"Combo 2\"+=off_hand=,"));
    }

    #[test]
    fn drop_carries_talents_when_present() {
        let profile = "mage=test\nspec=frost\nhead=,id=100\ntalents=ABCDEF\n";
        let drops = vec![drop(999, 1, vec![])];
        let (input, _, _) = generate_droptimizer_input(profile, &drops);
        assert!(input.contains("profileset.\"Combo 2\"+=talents=ABCDEF"));
    }

    #[test]
    fn drop_with_multiple_bonus_ids_joined_with_slash() {
        // Non-empty bonus_ids triggers a socket-resolution lookup, so the
        // bonus DB must be loaded even though this assertion is just about
        // string formatting.
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let drops = vec![drop(999, 1, vec![10, 20, 30])];
        let (input, _, _) = generate_droptimizer_input(profile, &drops);
        assert!(input.contains("bonus_id=10/20/30"));
    }

    #[test]
    fn ring_drop_emits_two_combos_one_per_finger() {
        // inv_type 11 → finger1 + finger2 → 2 emits
        let profile = "mage=test\nspec=frost\nfinger1=,id=100\nfinger2=,id=101\n";
        let drops = vec![drop(999, 11, vec![])];
        let (input, count, _) = generate_droptimizer_input(profile, &drops);
        assert_eq!(count, 2);
        assert!(input.contains("profileset.\"Combo 2\"+=finger1=,id=999"));
        assert!(input.contains("profileset.\"Combo 3\"+=finger2=,id=999"));
    }

    #[test]
    fn ring_drop_same_as_equipped_only_emits_replacement_combo() {
        // Equipped finger1 = item 500. Drop is another copy of item 500.
        // Putting it in finger2 would mean wearing two of the same ring
        // (unique-equipped violation). Only the finger1-replacement combo
        // should be emitted.
        let profile = "mage=test\nspec=frost\nfinger1=,id=500\nfinger2=,id=101\n";
        let drops = vec![drop(500, 11, vec![])];
        let (input, count, _) = generate_droptimizer_input(profile, &drops);
        assert_eq!(
            count, 1,
            "expected only 1 combo (finger1 replacement):\n{input}"
        );
        assert!(
            input.contains("profileset.\"Combo 2\"+=finger1=,id=500"),
            "expected finger1 replacement combo:\n{input}"
        );
        assert!(
            !input.contains("finger2=,id=500"),
            "finger2 should not get a duplicate copy:\n{input}"
        );
    }

    #[test]
    fn trinket_drop_same_as_equipped_only_emits_replacement_combo() {
        // Same unique-equipped rule for trinkets.
        let profile = "mage=test\nspec=frost\ntrinket1=,id=900\ntrinket2=,id=901\n";
        let drops = vec![drop(900, 12, vec![])];
        let (input, count, _) = generate_droptimizer_input(profile, &drops);
        assert_eq!(count, 1);
        assert!(input.contains("trinket1=,id=900"));
        assert!(!input.contains("trinket2=,id=900"));
    }

    #[test]
    fn trinket_drop_emits_two_combos_one_per_trinket() {
        let profile = "mage=test\nspec=frost\ntrinket1=,id=100\ntrinket2=,id=101\n";
        let drops = vec![drop(999, 12, vec![])];
        let (_, count, _) = generate_droptimizer_input(profile, &drops);
        assert_eq!(count, 2);
    }

    #[test]
    fn shield_drop_targets_off_hand_only() {
        // inv_type 14 = shield → off_hand only
        let profile = "warrior=test\nspec=protection\nmain_hand=,id=100\noff_hand=,id=101\n";
        let drops = vec![drop(999, 14, vec![])];
        let (input, count, _) = generate_droptimizer_input(profile, &drops);
        assert_eq!(count, 1);
        assert!(input.contains("profileset.\"Combo 2\"+=off_hand=,id=999"));
    }

    #[test]
    fn one_hand_weapon_dual_wield_emits_two_combos() {
        // inv_type 13 = 1H, fury can dual wield
        let profile = "warrior=test\nspec=fury\nmain_hand=,id=100\noff_hand=,id=101\n";
        let drops = vec![drop(999, 13, vec![])];
        let (_, count, _) = generate_droptimizer_input(profile, &drops);
        assert_eq!(count, 2);
    }

    #[test]
    fn one_hand_weapon_non_dual_wield_emits_main_hand_only() {
        // Arms warrior cannot dual wield 1H
        let profile = "warrior=test\nspec=arms\nmain_hand=,id=100\n";
        let drops = vec![drop(999, 13, vec![])];
        let (_, count, _) = generate_droptimizer_input(profile, &drops);
        assert_eq!(count, 1);
    }

    #[test]
    fn back_drop_targets_back_slot_only() {
        let profile = "mage=test\nspec=frost\nback=,id=100\n";
        let drops = vec![drop(999, 16, vec![])];
        let (input, count, _) = generate_droptimizer_input(profile, &drops);
        assert_eq!(count, 1);
        assert!(input.contains("profileset.\"Combo 2\"+=back=,id=999"));
    }

    #[test]
    fn ring_drop_inherits_per_target_finger() {
        // Each finger slot inherits from *its own* equipped item, not from a
        // shared payload. finger1 has enchant+gem; finger2 has neither.
        // Drop has bonus 13534 = +1 socket, so gem inheritance is allowed.
        crate::test_support::ensure_game_data_loaded();
        let profile = "\
mage=test\n\
spec=frost\n\
finger1=,id=100,enchant_id=7000,gem_id=5000\n\
finger2=,id=101\n";
        let drops = vec![drop(999, 11, vec![13534])];
        let (input, count, _) = generate_droptimizer_input(profile, &drops);
        assert_eq!(count, 2);
        assert!(
            input.contains("finger1=,id=999,ilevel=600,bonus_id=13534,enchant_id=7000,gem_id=5000"),
            "expected finger1 to inherit from equipped finger1:\n{input}"
        );
        let f2_line = input
            .lines()
            .find(|l| l.contains("Combo 3") && l.contains("finger2=,id=999"))
            .expect("missing finger2 line");
        assert!(
            !f2_line.contains("enchant_id="),
            "finger2 has no equipped enchant; drop must not invent one: {f2_line}"
        );
    }

    #[test]
    fn multiple_drops_get_sequential_combo_numbers() {
        let profile = "mage=test\nspec=frost\nhead=,id=100\nchest=,id=101\n";
        let drops = vec![
            drop(901, 1, vec![]),  // head
            drop(902, 5, vec![]),  // chest
            drop(903, 16, vec![]), // back (no equipped slot for this profile, but inv_type maps it)
        ];
        let (input, count, _) = generate_droptimizer_input(profile, &drops);
        // 3 drops, each emitting once. Even back works (it doesn't need equipped slot).
        assert_eq!(count, 3);
        assert!(input.contains("### Combo 2"));
        assert!(input.contains("### Combo 3"));
        assert!(input.contains("### Combo 4"));
    }

    #[test]
    fn drop_metadata_carries_encounter_field() {
        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let drops = vec![json!({
            "item_id": 999,
            "ilevel": 600,
            "name": "Drop",
            "encounter": "Specific Boss Name",
            "inventory_type": 1,
            "bonus_ids": []
        })];
        let (_, _, metadata) = generate_droptimizer_input(profile, &drops);
        let combo = metadata.get("Combo 2").expect("missing combo");
        assert_eq!(combo[0]["encounter"], "Specific Boss Name");
    }
}
