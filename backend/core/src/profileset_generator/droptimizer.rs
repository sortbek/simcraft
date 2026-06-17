use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;

use super::base_profile::parse_base_profile;
use super::constraints::{is_legal_gear_set, GearSetContext};
use crate::simc_string::{extract_bonus_ids, extract_item_id};
use crate::types::class_data::{self, GEAR_SLOTS};

/// True if dropping `drop_item_id` into `target_slot` (other slots unchanged)
/// is a legal gear set under `is_legal_gear_set`. False = skip this combo (the
/// conflicting slot still gets its own replacement combo). Mirrors the emission
/// normalization (2H drop in main_hand for non-Fury clears off_hand) so the
/// candidate matches what simc actually receives.
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

/// The player's most-used equipped gem id — their best-stat choice — used to
/// fill every socket on a drop. `None` when they have no gems. Ties break to the
/// smallest id for deterministic output.
fn most_used_gem(equipped: &HashMap<String, String>, gem_re: &Regex) -> Option<u64> {
    let mut counts: HashMap<u64, usize> = HashMap::new();
    for line in equipped.values() {
        if let Some(caps) = gem_re.captures(line) {
            for g in caps[1].split('/') {
                if let Ok(id) = g.parse::<u64>() {
                    if id > 0 {
                        *counts.entry(id).or_insert(0) += 1;
                    }
                }
            }
        }
    }
    counts
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0)))
        .map(|(id, _)| id)
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

    // Backend is the single source of truth for inheritance: copy enchant_id/
    // gem_id from the equipped item in the drop's target slot. The frontend's
    // old `slot_inherits` array is now ignored.
    let legacy_enchant_re = Regex::new(r"enchant_id=(\d+)").unwrap();
    let legacy_gem_re = Regex::new(r"gem_id=([\d/]+)").unwrap();
    let best_gem = most_used_gem(&equipped_gear, &legacy_gem_re);

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
        // `slot_inherits` is intentionally ignored (kept in the type for API
        // back-compat, no longer authoritative).
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
            // Enforce the same unique-equipped + item-limit-category rules as Top
            // Gear: skip a drop that would duplicate the equipped copy of a paired
            // slot or exceed a bonus-id limit category. The conflicting slot still
            // emits its own "would replacing this slot be better" combo.
            if !drop_combo_is_valid(&equipped_gear, slot, item_id, &bonus_ids, inv_type, &spec) {
                continue;
            }

            let mut simc_str = base_simc_str.clone();
            let mut applied_enchant: u64 = 0;
            let mut applied_gem: u64 = 0;
            let equipped = equipped_gear.get(*slot);

            // Enchant: inherit from the equipped item in this slot.
            if let Some(equipped) = equipped {
                if let Some(caps) = legacy_enchant_re.captures(equipped) {
                    if let Ok(eid) = caps[1].parse::<u64>() {
                        if eid > 0 {
                            simc_str.push_str(&format!(",enchant_id={}", eid));
                            applied_enchant = eid;
                        }
                    }
                }
            }

            // Gems: keep the gem(s) the player already has in this slot, then fill
            // any EXTRA sockets the drop has with their most-used gem (best-stat
            // choice). The socket count folds base sockets, bonus-granted sockets,
            // curated overrides, and the per-slot guaranteed-socket floor (necks/rings
            // always carry a socket this season). SimC applies exactly the gems we
            // list (it does not cap to real sockets), so the count must be accurate.
            let drop_sockets = crate::item_db::item_socket_count(item_id, &bonus_ids)
                .max(crate::item_db::inv_type_guaranteed_sockets(inv_type));
            if drop_sockets > 0 {
                let slot_gems: Vec<u64> = equipped
                    .and_then(|e| legacy_gem_re.captures(e))
                    .map(|caps| {
                        caps[1]
                            .split('/')
                            .filter_map(|g| g.parse::<u64>().ok())
                            .filter(|&id| id > 0)
                            .collect()
                    })
                    .unwrap_or_default();
                // Socket i uses the slot's own gem when present, else the most-used.
                let gems: Vec<u64> = (0..drop_sockets as usize)
                    .filter_map(|i| slot_gems.get(i).copied().or(best_gem))
                    .collect();
                if let Some(&first) = gems.first() {
                    applied_gem = first;
                    let gem_str = gems.iter().map(u64::to_string).collect::<Vec<_>>().join("/");
                    simc_str.push_str(&format!(",gem_id={}", gem_str));
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
        // Equipped neck has a gem; drop has a socket (bonus 13534 = +1), so the
        // drop inherits that gem id.
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
        // Equipped wrist has a socket+gem; a plain wrist drop has no socket, so
        // inheritance (gated on the drop's socket count) must not apply.
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
    fn ring_drop_gemmed_via_slot_socket_floor() {
        // Rings (inv 11) carry a guaranteed socket this season even when the drop's
        // bonus_ids encode none (the socket comes from a drop-context bonus our data
        // doesn't record). The drop must still be gemmed from the equipped slot.
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test\nspec=frost\nfinger1=,id=100,gem_id=5000\nfinger2=,id=101\n";
        let drops = vec![drop(999, 11, vec![])]; // ring drop, NO socket bonus
        let (input, _, _) = generate_droptimizer_input(profile, &drops);
        assert!(
            input.contains("finger1=,id=999,ilevel=600,gem_id=5000"),
            "ring drop must be gemmed via the per-slot socket floor:\n{input}"
        );
    }

    #[test]
    fn drop_ignores_slot_inherits_field_in_request() {
        // A request still carrying the legacy `slot_inherits` array must be
        // tolerated and ignored (backend derives inheritance from equipped).
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
        // Drop is a copy of equipped finger1 (500); putting it in finger2 violates
        // unique-equipped, so only the finger1 replacement combo emits.
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
    fn ring_drop_inherits_enchant_and_gem_per_target_slot() {
        // Each finger inherits from its OWN equipped item — enchant AND gem. The
        // most-used gem (6000) must NOT override finger1's own gem (5000). Drop
        // has bonus 13534 (+1 socket).
        crate::test_support::ensure_game_data_loaded();
        let profile = "\
mage=test\n\
spec=frost\n\
finger1=,id=100,enchant_id=7000,gem_id=5000\n\
finger2=,id=101,gem_id=6000\n\
main_hand=,id=200,gem_id=6000\n"; // 6000 is most-used (x2)
        let drops = vec![drop(999, 11, vec![13534])];
        let (input, count, _) = generate_droptimizer_input(profile, &drops);
        assert_eq!(count, 2);
        assert!(
            input.contains("finger1=,id=999,ilevel=600,bonus_id=13534,enchant_id=7000,gem_id=5000"),
            "finger1 must keep its own gem 5000, not the most-used 6000:\n{input}"
        );
        let f2_line = input
            .lines()
            .find(|l| l.contains("Combo 3") && l.contains("finger2=,id=999"))
            .expect("missing finger2 line");
        assert!(
            f2_line.contains("gem_id=6000") && !f2_line.contains("enchant_id="),
            "finger2 keeps its own gem 6000 and has no enchant: {f2_line}"
        );
    }

    #[test]
    fn override_neck_keeps_equipped_gem_and_fills_extra_socket() {
        // 250247 (Amulet of the Abyssal Hymn) has a curated override of 2 sockets
        // though the drop carries only its ilvl bonus. The player's neck has ONE
        // gem (1111); the drop must keep that gem in socket 1 and fill socket 2
        // with their most-used gem (2222).
        crate::test_support::ensure_game_data_loaded();
        let profile = "\
mage=test\n\
spec=frost\n\
neck=,id=100,gem_id=1111\n\
finger1=,id=101,gem_id=2222\n\
finger2=,id=102,gem_id=2222\n"; // 2222 is most-used (x2)
        let drops = vec![drop(250247, 2, vec![])]; // neck, no socket bonus on the drop
        let (input, _, metadata) = generate_droptimizer_input(profile, &drops);
        assert!(
            input.contains("neck=,id=250247,ilevel=600,gem_id=1111/2222"),
            "expected equipped gem 1111 + most-used 2222 on the override neck:\n{input}"
        );
        let combo = metadata.get("Combo 2").expect("missing combo");
        assert_eq!(combo[0]["gem_id"], 1111);
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
