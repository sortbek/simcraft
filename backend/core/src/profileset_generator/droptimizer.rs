use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;

use super::base_profile::parse_base_profile;
use super::constraints::{is_legal_gear_set, GearSetContext};
use crate::simc_string::{extract_bonus_ids, extract_item_id, join_ids};
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

/// The applied replacement configuration drives both SimC and result metadata.
struct AppliedDropCandidate {
    base: String,
    bonus_ids: Vec<u64>,
    display_bonus_ids: Vec<u64>,
    /// Present only when the pair must be emitted as `crafted_stats=`; crafted
    /// gear carries it as missive bonus ids instead.
    stat_parameter: Option<Vec<u64>>,
    enchant_id: u64,
    gem_ids: Vec<u64>,
}
impl AppliedDropCandidate {
    fn simc_string(&self) -> String {
        let mut result = self.base.clone();
        if let Some(stat_ids) = self.stat_parameter.as_deref().filter(|ids| !ids.is_empty()) {
            result.push_str(&format!(",crafted_stats={}", join_ids(stat_ids)));
        }
        if !self.bonus_ids.is_empty() {
            result.push_str(&format!(",bonus_id={}", join_ids(&self.bonus_ids)));
        }
        if self.enchant_id > 0 {
            result.push_str(&format!(",enchant_id={}", self.enchant_id));
        }
        if !self.gem_ids.is_empty() {
            result.push_str(&format!(",gem_id={}", join_ids(&self.gem_ids)));
        }
        result
    }
}

pub(super) fn generate_droptimizer_input(
    base_profile: &str,
    drop_items: &[Value],
    crafted_stats: Option<super::CraftedStats>,
    embellishments: &HashMap<u64, super::CraftedEmbellishment>,
) -> (String, usize, HashMap<String, Value>) {
    generate_droptimizer_input_with(
        base_profile,
        drop_items,
        crafted_stats,
        embellishments,
        DropRunOptions::default(),
    )
}

/// Run-level knobs that are not carried per item: which gem fills sockets the
/// player's own gear does not already cover, and whether every eligible
/// candidate is simmed as if it came with a vault reward's extra socket.
#[derive(Debug, Clone, Copy, Default)]
pub struct DropRunOptions {
    pub preferred_gem_id: Option<u64>,
    pub add_vault_socket: bool,
}

pub(super) fn generate_droptimizer_input_with(
    base_profile: &str,
    drop_items: &[Value],
    crafted_stats: Option<super::CraftedStats>,
    embellishments: &HashMap<u64, super::CraftedEmbellishment>,
    options: DropRunOptions,
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
    // An explicit pick beats the inferred one, but both only ever fill sockets
    // the equipped item in that slot does not already cover.
    let best_gem = options
        .preferred_gem_id
        .filter(|&id| crate::item_db::get_gem_info(id).is_some())
        .or_else(|| most_used_gem(&equipped_gear, &legacy_gem_re));

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
        // The raid/dungeon the encounter sits in, for the results summary subtext.
        let instance = item
            .get("instance_name")
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
        // Drop-variant markers (Void Forged / Catalyst) ride along in the combo
        // metadata so the result parser echoes them and the roster report can
        // tell a variant apart from its base item (a Void Forged item keeps the
        // base item_id). Absent on plain drops.
        let is_void_forge = item
            .get("is_void_forge")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let is_catalyst = item
            .get("is_catalyst")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let source_item_id = item.get("source_item_id").and_then(|v| v.as_u64());
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
        base_simc_str.push_str(&crate::item_db::redirected_base_stats_fragment(
            is_catalyst,
            source_item_id.unwrap_or(0),
        ));
        // Crafted gear carries the stat pair as missive bonus IDs; a raid BOE has
        // no missive, so it needs `crafted_stats=` or simc resolves its
        // placeholder secondaries to "unknown". Dispatched per item — a raid
        // selection mixes both with ordinary fixed-stat drops.
        // A catalysed piece keeps the SOURCE item's secondaries (redirected_base_stats=),
        // so its stat eligibility follows the source, not the tier item.
        let stat_item_id = match (is_catalyst, source_item_id) {
            (true, Some(source)) if source > 0 => source,
            _ => item_id,
        };
        let use_missives = crate::item_db::is_crafted_item(stat_item_id);
        let crafted_stats =
            crafted_stats.filter(|_| crate::item_db::accepts_preferred_stats(stat_item_id));
        let needs_stat_param = !use_missives && crate::item_db::has_flexible_stats(stat_item_id);
        // The item's own effect grants (e.g. Venomcursed) live in the game data,
        // never in the drop payload. Deduped: resolve_bonuses SUMS socket grants.
        let mut requested_bonuses = bonus_ids.clone();
        if let Some(cs) = crafted_stats.filter(|_| use_missives) {
            requested_bonuses.extend_from_slice(&cs.bonus_ids);
        }
        let item_bonus_ids = crate::item_db::with_item_effect_bonuses(item_id, &requested_bonuses);
        // Display keeps the requested bonuses plus effects, without missives or
        // embellishments — the results UI shows what dropped, not what was simmed.
        let display_bonus_ids = crate::item_db::with_item_effect_bonuses(item_id, &bonus_ids);
        // Applicability was validated at the trust boundary (droptimizer_handlers);
        // any future caller wiring picks in (e.g. roster runs) must validate too.
        let item_embellishment = item
            .get("embellishment_id")
            .and_then(|v| v.as_u64())
            .and_then(|id| embellishments.get(&id));

        for slot in &slots {
            // Embellished-first validity: if the pick would breach a limit
            // category in this combo (e.g. a third Embellished piece), fall
            // back to simming the combo plain rather than dropping the row.
            let combo_embellishment = item_embellishment.filter(|e| {
                let mut extended = item_bonus_ids.clone();
                extended.extend_from_slice(&e.bonus_ids);
                drop_combo_is_valid(&equipped_gear, slot, item_id, &extended, inv_type, &spec)
            });
            // Enforce the same unique-equipped + item-limit-category rules as Top
            // Gear: skip a drop that would duplicate the equipped copy of a paired
            // slot or exceed a bonus-id limit category. The conflicting slot still
            // emits its own "would replacing this slot be better" combo.
            if combo_embellishment.is_none()
                && !drop_combo_is_valid(
                    &equipped_gear,
                    slot,
                    item_id,
                    &item_bonus_ids,
                    inv_type,
                    &spec,
                )
            {
                continue;
            }
            // combo_embellishment is Some only when the extended (embellished) bonus
            // set passed validity above; otherwise we've just confirmed the plain
            // bonus set is valid. Either way the combo built below is the one that
            // was actually validated — nothing ships unvalidated.
            let mut combo_bonus_ids = item_bonus_ids.clone();
            if let Some(e) = combo_embellishment {
                for id in &e.bonus_ids {
                    if !combo_bonus_ids.contains(id) {
                        combo_bonus_ids.push(*id);
                    }
                }
            }
            let mut applied = AppliedDropCandidate {
                base: base_simc_str.clone(),
                bonus_ids: combo_bonus_ids,
                display_bonus_ids: display_bonus_ids.clone(),
                stat_parameter: crafted_stats
                    .filter(|_| needs_stat_param)
                    .map(|cs| cs.stat_ids.to_vec()),
                enchant_id: 0,
                gem_ids: Vec::new(),
            };
            let equipped = equipped_gear.get(*slot);

            // Enchant: inherit from the equipped item in this slot.
            if let Some(equipped) = equipped {
                if let Some(caps) = legacy_enchant_re.captures(equipped) {
                    if let Ok(eid) = caps[1].parse::<u64>() {
                        if eid > 0 {
                            applied.enchant_id = eid;
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
            // `bonus_ids` holds only inherent bonuses here — crafted stat bonus IDs
            // are kept separate and never reach socket lookups.
            // A vault reward is simmed as if it HAS a socket — a floor, not an
            // extra one. Gear that already carries sockets is unaffected, so the
            // option only ever reaches slots with none of their own.
            let vault_floor =
                u64::from(options.add_vault_socket && crate::item_db::takes_vault_socket(inv_type));
            let drop_sockets = crate::item_db::item_socket_count(item_id, &bonus_ids)
                .max(crate::item_db::inv_type_guaranteed_sockets(inv_type))
                .max(vault_floor);
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
                applied.gem_ids = gems;
            }

            let combo_name = format!("Combo {}", combo_idx);
            lines.push(format!("### {}", combo_name));
            lines.push(format!(
                "profileset.\"{}\"+={}={}",
                combo_name,
                slot,
                applied.simc_string()
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

            let metadata = json!({
                "slot": slot,
                "item_id": item_id,
                "ilevel": ilevel,
                "name": name,
                "embellishment": combo_embellishment.map(|e| json!({
                    "id": e.id,
                    "name": e.name,
                    "bonus_ids": e.bonus_ids,
                })),
                "is_kept": false,
                "encounter": encounter,
                "instance": instance,
                "is_void_forge": is_void_forge,
                "is_catalyst": is_catalyst,
                "source_item_id": source_item_id,
                "bonus_ids": applied.display_bonus_ids,
                "crafted_stats": crafted_stats
                    .map(|cs| cs.stat_ids.to_vec())
                    .unwrap_or_default(),
                "enchant_id": applied.enchant_id,
                "gem_id": applied.gem_ids.first().copied().unwrap_or(0),
                "gem_ids": applied.gem_ids,
            });
            combo_metadata.insert(combo_name.clone(), json!([metadata.clone()]));
            combo_idx += 1;

            // Two on-use trinkets compete for the same windows, and the APL
            // addresses trinkets by slot, so which one sits where changes what
            // gets pressed. Sim the same pair the other way round. The pair is
            // identical, so it needs no fresh validity check.
            if inv_type != 12 {
                continue;
            }
            let partner_slot = if *slot == "trinket1" {
                "trinket2"
            } else {
                "trinket1"
            };
            let Some(partner) = equipped_gear.get(partner_slot) else {
                continue;
            };
            if !crate::item_db::is_on_use_trinket(item_id)
                || !crate::item_db::is_on_use_trinket(extract_item_id(partner))
            {
                continue;
            }
            let swapped = format!("Combo {}", combo_idx);
            lines.push(format!("### {}", swapped));
            // The drop takes the partner's slot; the partner takes the drop's.
            lines.push(format!(
                "profileset.\"{}\"+={}={}",
                swapped,
                partner_slot,
                applied.simc_string()
            ));
            lines.push(format!("profileset.\"{}\"+={}={}", swapped, slot, partner));
            if !talents_string.is_empty() {
                lines.push(format!(
                    "profileset.\"{}\"+=talents={}",
                    swapped, talents_string
                ));
            }
            lines.push(String::new());
            let mut swapped_metadata = metadata;
            swapped_metadata["slot"] = json!(partner_slot);
            // The partner moves into the slot the drop came from. Without it the
            // combo reads as "the drop in `partner_slot`" — which is also the
            // plain combo for that slot, so the results view cannot tell the two
            // gear sets apart and drops one of them.
            let partner_bonus_ids = extract_bonus_ids(partner);
            let partner_item = json!({
                "slot": slot,
                "item_id": extract_item_id(partner),
                "ilevel": crate::item_db::resolve_bonuses(&partner_bonus_ids)
                    .ilevel
                    .unwrap_or(0),
                "bonus_ids": partner_bonus_ids,
                "is_kept": true,
                "encounter": encounter,
                "instance": instance,
            });
            combo_metadata.insert(swapped.clone(), json!([swapped_metadata, partner_item]));
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
        crate::test_support::ensure_game_data_loaded();
        json!({
            "item_id": item_id,
            "ilevel": 600,
            "name": format!("Drop {}", item_id),
            "encounter": "Boss",
            "inventory_type": inv_type,
            "bonus_ids": bonus_ids,
        })
    }

    /// A drop carrying a per-item embellishment pick, mirroring how the
    /// handler stamps `embellishment_id` onto the drop item Value.
    fn drop_with_emb(item_id: u64, inv_type: u64, bonus_ids: Vec<u64>, emb_id: u64) -> Value {
        let mut d = drop(item_id, inv_type, bonus_ids);
        d["embellishment_id"] = json!(emb_id);
        d
    }

    /// A resolution cache holding a single embellishment, keyed by its id.
    fn cache(
        emb: &crate::profileset_generator::CraftedEmbellishment,
    ) -> HashMap<u64, crate::profileset_generator::CraftedEmbellishment> {
        HashMap::from([(emb.id, emb.clone())])
    }

    #[test]
    fn catalyst_drop_redirects_base_stats_to_source() {
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let mut item = drop(271564, 1, vec![13575]); // tier helm + set marker bonus
        item["is_catalyst"] = json!(true);
        item["source_item_id"] = json!(251199); // Worldroot Canopy (Mastery/Crit)
        let drops = vec![item];

        let (input, _, metadata) =
            generate_droptimizer_input(profile, &drops, None, &HashMap::new());

        assert!(
            input.contains("head=,id=271564"),
            "catalysed drop keeps the tier item id, got:\n{input}"
        );
        assert!(
            input.contains("redirected_base_stats=251199"),
            "catalysed drop must redirect base stats to the source, got:\n{input}"
        );
        assert!(
            input.contains("bonus_id=13575"),
            "tier set marker bonus must survive, got:\n{input}"
        );
        let combo = metadata.get("Combo 2").expect("missing combo");
        assert_eq!(
            combo[0]["item_id"],
            json!(271564),
            "metadata keeps the tier piece id for display"
        );
        assert_eq!(combo[0]["source_item_id"], json!(251199));
    }

    /// The swap moves the equipped partner into the drop's slot. Without that in
    /// the metadata the row is indistinguishable from the plain combo for the
    /// same slot — the results view dedupes on it and throws one sim away.
    #[test]
    fn a_swapped_trinket_pair_records_the_partner_it_moved() {
        crate::test_support::ensure_game_data_loaded();
        let profile = "deathknight=test
spec=unholy
trinket1=,id=249344
trinket2=,id=270165
";
        let mut item = drop(270175, 12, vec![]); // on-use trinket
        item["encounter"] = json!("Ula'tek");

        let (_, _, metadata) = generate_droptimizer_input(profile, &[item], None, &HashMap::new());

        let swaps: Vec<&Vec<Value>> = metadata
            .values()
            .filter_map(|combo| combo.as_array())
            .filter(|items| items.len() > 1)
            .collect();
        // Only a pair of on-use trinkets is worth swapping, so how many combos
        // this yields follows the equipped gear; what matters is what each says.
        assert!(
            !swaps.is_empty(),
            "an on-use pair must produce a swapped combo"
        );
        for items in swaps {
            assert_eq!(items[0]["item_id"], json!(270175), "the drop stays first");
            assert_eq!(
                items[1]["is_kept"],
                json!(true),
                "the partner is gear you already own"
            );
            assert_ne!(
                items[1]["slot"], items[0]["slot"],
                "the partner takes the slot the drop came from"
            );
            let partner = items[1]["item_id"].as_u64().unwrap();
            assert!(
                partner == 249344 || partner == 270165,
                "the partner is one of the equipped trinkets, got {partner}"
            );
        }
    }

    #[test]
    fn a_drops_instance_reaches_the_combo_metadata() {
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test
spec=frost
head=,id=100
";
        let mut item = drop(271564, 1, vec![]);
        item["instance_name"] = json!("The Venomous Abyss");

        let (_, _, metadata) = generate_droptimizer_input(profile, &[item], None, &HashMap::new());

        let combo = metadata.get("Combo 2").expect("missing combo");
        assert_eq!(combo[0]["instance"], json!("The Venomous Abyss"));
    }

    /// Two sources converting to the same tier piece must not produce identical
    /// profilesets — the whole point of one row per source.
    #[test]
    fn catalyst_drops_from_different_sources_are_distinct_sims() {
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let mut a = drop(271564, 1, vec![13575]);
        a["is_catalyst"] = json!(true);
        a["source_item_id"] = json!(251199);
        let mut b = drop(271564, 1, vec![13575]);
        b["is_catalyst"] = json!(true);
        b["source_item_id"] = json!(251232);

        let (input, count, _) = generate_droptimizer_input(profile, &[a, b], None, &HashMap::new());

        assert_eq!(count, 2, "both sources need their own combo, got:\n{input}");
        let head_lines: Vec<&str> = input
            .lines()
            .filter(|l| l.starts_with("profileset.") && l.contains("id=271564"))
            .collect();
        assert_eq!(head_lines.len(), 2, "expected two head lines:\n{input}");
        assert_ne!(
            head_lines[0], head_lines[1],
            "same tier piece from different sources must sim differently:\n{input}"
        );
    }

    #[test]
    fn unknown_inv_type_skipped() {
        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let drops = vec![drop(999, 99, vec![])]; // inv_type 99 = no slots
        let (_, count, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
        assert_eq!(count, 0);
    }

    #[test]
    fn crafted_stat_bonus_ids_go_into_the_simc_string() {
        // Must be a real crafted-pool item: missives are dispatched per item now.
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let drops = vec![drop(237830, 11, vec![])];
        let (input, _, _) = generate_droptimizer_input(
            profile,
            &drops,
            Some(crate::profileset_generator::CraftedStats {
                stat_ids: [49, 36],
                bonus_ids: [11137, 11138],
            }),
            &HashMap::new(),
        );
        assert!(
            input.contains("bonus_id=11137/11138"),
            "expected crafted stat bonus IDs in the simc string, got:\n{input}"
        );
    }

    #[test]
    fn crafted_stats_surface_in_metadata_not_display_bonus_ids() {
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let drops = vec![drop(237830, 11, vec![12345])];
        let (_, _, metadata) = generate_droptimizer_input(
            profile,
            &drops,
            Some(crate::profileset_generator::CraftedStats {
                stat_ids: [49, 36],
                bonus_ids: [11137, 11138],
            }),
            &HashMap::new(),
        );
        let entry = &metadata.values().next().unwrap()[0];
        assert_eq!(entry["bonus_ids"], json!([12345]));
        assert_eq!(entry["crafted_stats"], json!([49, 36]));
    }

    #[test]
    fn crafted_stats_appended_after_existing_bonus_ids() {
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let drops = vec![drop(237830, 11, vec![12345])];
        let (input, _, _) = generate_droptimizer_input(
            profile,
            &drops,
            Some(crate::profileset_generator::CraftedStats {
                stat_ids: [49, 36],
                bonus_ids: [11137, 11138],
            }),
            &HashMap::new(),
        );
        assert!(
            input.contains("bonus_id=12345/11137/11138"),
            "expected crafted stat bonus IDs appended after the upgrade bonus, got:\n{input}"
        );
    }

    #[test]
    fn candidate_carries_the_items_own_effect_bonus() {
        // Aqirbane Reliquary's proc rides on bonus 13987, which lives in the game
        // data's bonusLists and never in the drop payload. Without it the neck
        // sims as a plain stat stick and ranks mid-pack instead of first.
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test
spec=frost
neck=,id=100
";
        let drops = vec![drop(268265, 2, vec![12846])];
        let (input, _, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
        let line = input
            .lines()
            .find(|l| l.contains("id=268265"))
            .unwrap_or_default();
        assert!(
            line.contains("13987"),
            "effect bonus missing from:
{line}"
        );
        assert!(
            line.contains("12846"),
            "upgrade bonus missing from:
{line}"
        );
    }

    #[test]
    fn inherent_bonus_is_not_repeated_when_already_requested() {
        // resolve_bonuses SUMS socket grants, so a duplicated id would invent a
        // socket. 13668 is Aqirbane's own socket bonus.
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test
spec=frost
neck=,id=100
";
        let drops = vec![drop(268265, 2, vec![13668])];
        let (input, _, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
        let line = input
            .lines()
            .find(|l| l.contains("id=268265"))
            .unwrap_or_default();
        let bonus = line.split(",bonus_id=").nth(1).unwrap_or_default();
        let ids: Vec<&str> = bonus
            .split(',')
            .next()
            .unwrap_or_default()
            .split('/')
            .collect();
        assert_eq!(
            ids.iter().filter(|b| **b == "13668").count(),
            1,
            "13668 duplicated in: {line}"
        );
    }

    #[test]
    fn mixed_raid_drops_only_apply_preferred_stats_to_flexible_items() {
        crate::test_support::ensure_game_data_loaded();
        let drops = vec![drop(271638, 2, vec![12846]), drop(268265, 2, vec![12846])];
        assert!(crate::item_db::accepts_preferred_stats(271638));
        assert!(!crate::item_db::accepts_preferred_stats(268265));
        let (input, count, metadata) = generate_droptimizer_input(
            "mage=test\nspec=frost\nneck=,id=100\n",
            &drops,
            Some(crate::profileset_generator::CraftedStats {
                stat_ids: [36, 49],
                bonus_ids: [11138, 11137],
            }),
            &HashMap::new(),
        );
        assert_eq!(count, 2);
        for (item_id, expected) in [(271638, json!([36, 49])), (268265, json!([]))] {
            let entry = metadata
                .values()
                .find(|items| items[0]["item_id"] == item_id)
                .unwrap();
            assert_eq!(entry[0]["crafted_stats"], expected);
            let line = input
                .lines()
                .find(|line| line.contains(&format!("id={item_id}")))
                .unwrap();
            assert_eq!(line.contains("crafted_stats=36/49"), item_id == 271638);
            assert!(!line.contains("11138"));
            assert!(!line.contains("11137"));
        }
    }

    #[test]
    fn catalysed_flexible_drop_takes_the_pair_from_its_source_item() {
        // A catalysed piece inherits the source drop's secondaries via
        // redirected_base_stats=, so eligibility must follow the source. Keying on
        // the tier item id instead leaves the placeholders unresolved and the combo
        // sims with no secondaries at all.
        crate::test_support::ensure_game_data_loaded();
        const FLEXIBLE_SOURCE: u64 = 271434; // Venom Rite Mantle, stat ids 24/25
        assert!(crate::item_db::has_flexible_stats(FLEXIBLE_SOURCE));
        let profile = "mage=test
spec=frost
shoulder=,id=100
";
        let mut item = drop(999_001, 3, vec![12846]);
        item["is_catalyst"] = json!(true);
        item["source_item_id"] = json!(FLEXIBLE_SOURCE);
        let (input, _, _) = generate_droptimizer_input(
            profile,
            &[item],
            Some(crate::profileset_generator::CraftedStats {
                stat_ids: [36, 49],
                bonus_ids: [11138, 11137],
            }),
            &HashMap::new(),
        );
        let line = input
            .lines()
            .find(|l| l.contains("id=999001"))
            .unwrap_or_default();
        assert!(
            line.contains("crafted_stats=36/49"),
            "got:
{line}"
        );
    }

    #[test]
    fn flexible_stat_drop_gets_the_pair_as_a_simc_parameter() {
        // Bound Serpent's Jade Eye is a raid BOE, not crafted: its secondaries are
        // placeholders (stat ids 24/25) with no missive to carry them. Without
        // `crafted_stats=` simc resolves them to "unknown" and the neck sims as a
        // stamina stick — a real upgrade reported as a large downgrade.
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test
spec=frost
neck=,id=100
";
        let drops = vec![drop(271638, 2, vec![12846])];
        let (input, _, _) = generate_droptimizer_input(
            profile,
            &drops,
            Some(crate::profileset_generator::CraftedStats {
                stat_ids: [36, 49],
                bonus_ids: [11138, 11137],
            }),
            &HashMap::new(),
        );
        let line = input
            .lines()
            .find(|l| l.contains("id=271638"))
            .unwrap_or_default();
        assert!(
            line.contains("crafted_stats=36/49"),
            "got:
{line}"
        );
        // Missive bonus IDs belong to crafted gear only — they must not be grafted
        // onto a raid drop.
        assert!(
            !line.contains("11138"),
            "missive leaked onto a raid BOE:
{line}"
        );
    }

    #[test]
    fn crafted_socketless_drop_does_not_inherit_equipped_gem() {
        // Regression: a socketless crafted drop (empty inherent bonus_ids) must
        // not inherit the equipped gem just because missives were appended.
        // Uses head (inv type 1): neck/ring carry a guaranteed socket floor this
        // season, so they always gem regardless of bonus IDs.
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test\nspec=frost\nhead=,id=100,gem_id=999\n";
        let drops = vec![drop(237830, 1, vec![])];
        let (input, _, _) = generate_droptimizer_input(
            profile,
            &drops,
            Some(crate::profileset_generator::CraftedStats {
                stat_ids: [49, 36],
                bonus_ids: [11137, 11138],
            }),
            &HashMap::new(),
        );
        assert!(
            input.contains("bonus_id=11137/11138"),
            "stats still applied:\n{input}"
        );
        // The gem appears in the baseline (Combo 1); assert the drop lines don't.
        let drop_lines_inherit_gem = input
            .lines()
            .filter(|l| l.starts_with("profileset.") && l.contains("id=207157"))
            .any(|l| l.contains("gem_id=999"));
        assert!(
            !drop_lines_inherit_gem,
            "socketless crafted drop must not inherit the equipped gem:\n{input}"
        );
    }

    #[test]
    fn no_preferred_stats_leaves_bonus_ids_unchanged() {
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let drops = vec![drop(237830, 11, vec![12345])];
        let (input, _, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
        assert!(input.contains("bonus_id=12345"), "got:\n{input}");
        assert!(
            !input.contains("11137"),
            "no crafted bonus expected, got:\n{input}"
        );
    }

    /// A real embellishment + a real crafted item it applies to, from game data.
    fn test_embellishment() -> (crate::profileset_generator::CraftedEmbellishment, u64) {
        crate::test_support::ensure_game_data_loaded();
        let e = crate::item_db::crafted_embellishments()
            .iter()
            .find(|e| e.name == "Arcanoweave Lining")
            .expect("Arcanoweave Lining in season list");
        // 237828 = Spellbreaker's March, crafted plate boots (inventory type 8),
        // recipe slot 391 offers Arcanoweave Lining.
        assert!(crate::item_db::embellishment_applicable(237828, e.id));
        (
            crate::profileset_generator::CraftedEmbellishment {
                id: e.id,
                name: e.name.clone(),
                bonus_ids: e.bonus_ids.clone(),
            },
            237828,
        )
    }

    #[test]
    fn embellishment_bonus_ids_append_to_simc_string_for_applicable_drop() {
        let (emb, item_id) = test_embellishment();
        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let drops = vec![drop_with_emb(item_id, 8, vec![12345], emb.id)];
        let (input, count, metadata) =
            generate_droptimizer_input(profile, &drops, None, &cache(&emb));
        assert_eq!(count, 1);
        let tail = emb
            .bonus_ids
            .iter()
            .map(u64::to_string)
            .collect::<Vec<_>>()
            .join("/");
        assert!(
            input.contains(&format!("bonus_id=12345/{tail}")),
            "embellishment bonuses must append after inherent bonuses, got:\n{input}"
        );
        let entry = &metadata.values().next().unwrap()[0];
        // Display bonus_ids stay inherent-only; the pick rides its own field.
        assert_eq!(entry["bonus_ids"], serde_json::json!([12345]));
        assert_eq!(entry["embellishment"]["id"], serde_json::json!(emb.id));
        assert_eq!(entry["embellishment"]["name"], serde_json::json!(emb.name));
        assert_eq!(
            entry["embellishment"]["bonus_ids"],
            serde_json::json!(emb.bonus_ids)
        );
    }

    #[test]
    fn embellishment_appends_after_missive_bonus_ids() {
        let (emb, item_id) = test_embellishment();
        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let drops = vec![drop_with_emb(item_id, 8, vec![], emb.id)];
        let (input, _, _) = generate_droptimizer_input(
            profile,
            &drops,
            Some(crate::profileset_generator::CraftedStats {
                stat_ids: [49, 36],
                bonus_ids: [11137, 11138],
            }),
            &cache(&emb),
        );
        let tail = emb
            .bonus_ids
            .iter()
            .map(u64::to_string)
            .collect::<Vec<_>>()
            .join("/");
        assert!(
            input.contains(&format!("bonus_id=11137/11138/{tail}")),
            "expected missives then embellishment, got:\n{input}"
        );
    }

    #[test]
    fn item_without_pick_field_sims_unmodified() {
        // Inapplicable-with-field is now a handler 400, not a generator case —
        // a drop simply absent the field must sim unmodified even with a
        // non-empty resolution cache in scope.
        let (emb, _) = test_embellishment();
        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        // 251513 = Loa Worshiper's Band: inherently embellished ring, no
        // "Add Embellishment" recipe slot.
        let drops = vec![drop(251513, 11, vec![])];
        let (input, count, metadata) =
            generate_droptimizer_input(profile, &drops, None, &cache(&emb));
        assert!(count >= 1);
        for bid in &emb.bonus_ids {
            let leaked = input
                .lines()
                .filter(|l| l.contains("profileset"))
                .any(|l| l.contains(&bid.to_string()));
            assert!(
                !leaked,
                "no embellishment bonus expected without a pick, got:\n{input}"
            );
        }
        let entry = &metadata.values().next().unwrap()[0];
        assert!(entry["embellishment"].is_null());
    }

    #[test]
    fn embellishment_cap_falls_back_to_plain_combo() {
        let (emb, item_id) = test_embellishment();
        // Two equipped embellished pieces (marker 8960) on waist + back; the boots
        // candidate would be a third embellished item -> combo must still emit,
        // without the embellishment.
        let profile =
            "mage=test\nspec=frost\nwaist=,id=200,bonus_id=8960\nback=,id=201,bonus_id=8960\n";
        let drops = vec![drop_with_emb(item_id, 8, vec![], emb.id)];
        let (input, count, metadata) =
            generate_droptimizer_input(profile, &drops, None, &cache(&emb));
        assert_eq!(count, 1, "combo must not vanish at the cap");
        // The drop has no inherent bonuses, so a plain fallback emits profileset
        // lines with no bonus_id fragment at all (the base actor's 8960 lines are
        // not profileset lines).
        let leaked = input
            .lines()
            .filter(|l| l.contains("profileset"))
            .any(|l| l.contains("bonus_id="));
        assert!(!leaked, "cap fallback must sim plain, got:\n{input}");
        let entry = &metadata.values().next().unwrap()[0];
        assert!(entry["embellishment"].is_null());
    }

    #[test]
    fn outdoor_embellishment_cap_is_max_one() {
        // Engineering-pet embellishments carry marker 13555 -> category 697
        // ("Outdoor Embellished"), max 1 — enforced by the same generic path.
        crate::test_support::ensure_game_data_loaded();
        let e = crate::item_db::crafted_embellishments()
            .iter()
            .find(|e| e.name == "HU5H, Nonchalant Pup")
            .expect("HU5H in season list");
        assert!(
            e.bonus_ids.contains(&13555),
            "HU5H must carry the Outdoor marker, got {:?}",
            e.bonus_ids
        );
        let emb = crate::profileset_generator::CraftedEmbellishment {
            id: e.id,
            name: e.name.clone(),
            bonus_ids: e.bonus_ids.clone(),
        };
        // 244743 = Aetherlume Eye Wrap, crafted Engineering goggles (inv type 1).
        assert!(crate::item_db::embellishment_applicable(244743, e.id));
        // One equipped Outdoor-embellished piece elsewhere -> the goggles combo
        // would be a second (max 1): must fall back to plain.
        let profile = "mage=test\nspec=frost\nback=,id=201,bonus_id=13555\n";
        let drops = vec![drop_with_emb(244743, 1, vec![], emb.id)];
        let (input, count, metadata) =
            generate_droptimizer_input(profile, &drops, None, &cache(&emb));
        assert_eq!(count, 1, "combo must not vanish at the outdoor cap");
        let leaked = input
            .lines()
            .filter(|l| l.contains("profileset"))
            .any(|l| l.contains("bonus_id="));
        assert!(
            !leaked,
            "outdoor cap fallback must sim plain, got:\n{input}"
        );
        let entry = &metadata.values().next().unwrap()[0];
        assert!(entry["embellishment"].is_null());
    }

    #[test]
    fn embellishment_applies_when_replacing_an_embellished_slot() {
        let (emb, item_id) = test_embellishment();
        // Boots slot itself is one of the two embellished pieces: replacing it
        // keeps the count at 2, so the embellished combo is legal.
        let profile =
            "mage=test\nspec=frost\nfeet=,id=200,bonus_id=8960\nback=,id=201,bonus_id=8960\n";
        let drops = vec![drop_with_emb(item_id, 8, vec![], emb.id)];
        let (_, count, metadata) = generate_droptimizer_input(profile, &drops, None, &cache(&emb));
        assert_eq!(count, 1);
        let entry = &metadata.values().next().unwrap()[0];
        assert_eq!(entry["embellishment"]["id"], serde_json::json!(emb.id));
    }

    #[test]
    fn embellished_socketless_drop_does_not_inherit_equipped_gem() {
        let (emb, item_id) = test_embellishment();
        // Mirrors crafted_socketless_drop_does_not_inherit_equipped_gem: the
        // embellishment bonuses must never reach socket lookups.
        let profile = "mage=test\nspec=frost\nfeet=,id=100,gem_id=213743\n";
        let drops = vec![drop_with_emb(item_id, 8, vec![], emb.id)];
        let (input, _, _) = generate_droptimizer_input(profile, &drops, None, &cache(&emb));
        let drop_lines_inherit_gem = input
            .lines()
            .filter(|l| l.contains("profileset"))
            .any(|l| l.contains("gem_id=213743"));
        assert!(
            !drop_lines_inherit_gem,
            "socketless embellished drop must not inherit the equipped gem:\n{input}"
        );
    }

    #[test]
    fn no_embellishment_leaves_generation_unchanged() {
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let drops = vec![drop(237830, 11, vec![12345])];
        let with_none = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
        assert!(with_none.0.contains("bonus_id=12345"));
        let entry = &with_none.2.values().next().unwrap()[0];
        assert!(entry["embellishment"].is_null());
    }

    /// Two crafted drops with different picks in the same run must each carry
    /// their own bonus IDs and metadata; a third drop absent from the map (no
    /// `embellishment_id` field) sims unmodified alongside them.
    #[test]
    fn per_item_picks_are_independent() {
        crate::test_support::ensure_game_data_loaded();
        let arcanoweave = crate::item_db::crafted_embellishments()
            .iter()
            .find(|e| e.name == "Arcanoweave Lining")
            .expect("Arcanoweave Lining in season list")
            .clone();
        let hush = crate::item_db::crafted_embellishments()
            .iter()
            .find(|e| e.name == "HU5H, Nonchalant Pup")
            .expect("HU5H in season list")
            .clone();
        // 237828 = Spellbreaker's March (boots), 244743 = Aetherlume Eye Wrap
        // (goggles) — both known-applicable to their own pick.
        assert!(crate::item_db::embellishment_applicable(
            237828,
            arcanoweave.id
        ));
        assert!(crate::item_db::embellishment_applicable(244743, hush.id));

        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let drops = vec![
            drop_with_emb(237828, 8, vec![], arcanoweave.id),
            drop_with_emb(244743, 1, vec![], hush.id),
            drop(207157, 11, vec![12345]),
        ];
        let mut picks = HashMap::new();
        picks.insert(
            arcanoweave.id,
            crate::profileset_generator::CraftedEmbellishment {
                id: arcanoweave.id,
                name: arcanoweave.name.clone(),
                bonus_ids: arcanoweave.bonus_ids.clone(),
            },
        );
        picks.insert(
            hush.id,
            crate::profileset_generator::CraftedEmbellishment {
                id: hush.id,
                name: hush.name.clone(),
                bonus_ids: hush.bonus_ids.clone(),
            },
        );

        let (input, _count, metadata) = generate_droptimizer_input(profile, &drops, None, &picks);

        let arcanoweave_tail = arcanoweave
            .bonus_ids
            .iter()
            .map(u64::to_string)
            .collect::<Vec<_>>()
            .join("/");
        let hush_tail = hush
            .bonus_ids
            .iter()
            .map(u64::to_string)
            .collect::<Vec<_>>()
            .join("/");

        let boots_line = input
            .lines()
            .find(|l| l.starts_with("profileset.") && l.contains("id=237828"))
            .expect("missing boots combo line");
        assert!(boots_line.contains(&arcanoweave_tail), "got:\n{boots_line}");
        for bid in &hush.bonus_ids {
            assert!(
                !boots_line.contains(&bid.to_string()),
                "boots line leaked hush's bonus: {boots_line}"
            );
        }

        let goggles_line = input
            .lines()
            .find(|l| l.starts_with("profileset.") && l.contains("id=244743"))
            .expect("missing goggles combo line");
        assert!(goggles_line.contains(&hush_tail), "got:\n{goggles_line}");
        for bid in &arcanoweave.bonus_ids {
            assert!(
                !goggles_line.contains(&bid.to_string()),
                "goggles line leaked arcanoweave's bonus: {goggles_line}"
            );
        }

        let boots_meta = metadata
            .values()
            .find(|v| v[0]["item_id"] == json!(237828))
            .expect("missing boots metadata");
        assert_eq!(boots_meta[0]["embellishment"]["id"], json!(arcanoweave.id));

        let goggles_meta = metadata
            .values()
            .find(|v| v[0]["item_id"] == json!(244743))
            .expect("missing goggles metadata");
        assert_eq!(goggles_meta[0]["embellishment"]["id"], json!(hush.id));

        let ring_metas: Vec<_> = metadata
            .values()
            .filter(|v| v[0]["item_id"] == json!(207157))
            .collect();
        assert!(!ring_metas.is_empty(), "missing ring metadata");
        for m in ring_metas {
            assert!(m[0]["embellishment"].is_null());
        }
    }

    #[test]
    fn two_hand_drop_clears_off_hand_for_non_fury() {
        let profile = "\
warrior=test\n\
spec=arms\n\
main_hand=,id=200\n\
off_hand=,id=201\n";
        let drops = vec![drop(999, 17, vec![])]; // inv_type 17 = 2H weapon
        let (input, count, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
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
        let (input, _, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
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
        let (input, _, metadata) =
            generate_droptimizer_input(profile, &drops, None, &HashMap::new());
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
        let (input, _, metadata) =
            generate_droptimizer_input(profile, &drops, None, &HashMap::new());
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
        let (input, _, metadata) =
            generate_droptimizer_input(profile, &drops, None, &HashMap::new());
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
        let (input, _, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
        assert!(
            input.contains("finger1=,id=999,ilevel=600,gem_id=5000"),
            "ring drop must be gemmed via the per-slot socket floor:\n{input}"
        );
    }

    #[test]
    fn drop_ignores_slot_inherits_field_in_request() {
        crate::test_support::ensure_game_data_loaded();
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
        let (input, _, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
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
        let (input, _, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
        assert!(input.contains("profileset.\"Combo 2\"+=off_hand=,"));
    }

    #[test]
    fn drop_carries_talents_when_present() {
        let profile = "mage=test\nspec=frost\nhead=,id=100\ntalents=ABCDEF\n";
        let drops = vec![drop(999, 1, vec![])];
        let (input, _, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
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
        let (input, _, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
        assert!(input.contains("bonus_id=10/20/30"));
    }

    #[test]
    fn ring_drop_emits_two_combos_one_per_finger() {
        // inv_type 11 → finger1 + finger2 → 2 emits
        let profile = "mage=test\nspec=frost\nfinger1=,id=100\nfinger2=,id=101\n";
        let drops = vec![drop(999, 11, vec![])];
        let (input, count, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
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
        let (input, count, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
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
        let (input, count, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
        assert_eq!(count, 1);
        assert!(input.contains("trinket1=,id=900"));
        assert!(!input.contains("trinket2=,id=900"));
    }

    #[test]
    fn trinket_drop_emits_two_combos_one_per_trinket() {
        let profile = "mage=test\nspec=frost\ntrinket1=,id=100\ntrinket2=,id=101\n";
        let drops = vec![drop(999, 12, vec![])];
        let (_, count, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
        assert_eq!(count, 2);
    }

    #[test]
    fn shield_drop_targets_off_hand_only() {
        // inv_type 14 = shield → off_hand only
        let profile = "warrior=test\nspec=protection\nmain_hand=,id=100\noff_hand=,id=101\n";
        let drops = vec![drop(999, 14, vec![])];
        let (input, count, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
        assert_eq!(count, 1);
        assert!(input.contains("profileset.\"Combo 2\"+=off_hand=,id=999"));
    }

    #[test]
    fn one_hand_weapon_dual_wield_emits_two_combos() {
        // inv_type 13 = 1H, fury can dual wield
        let profile = "warrior=test\nspec=fury\nmain_hand=,id=100\noff_hand=,id=101\n";
        let drops = vec![drop(999, 13, vec![])];
        let (_, count, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
        assert_eq!(count, 2);
    }

    #[test]
    fn one_hand_weapon_non_dual_wield_emits_main_hand_only() {
        // Arms warrior cannot dual wield 1H
        let profile = "warrior=test\nspec=arms\nmain_hand=,id=100\n";
        let drops = vec![drop(999, 13, vec![])];
        let (_, count, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
        assert_eq!(count, 1);
    }

    #[test]
    fn back_drop_targets_back_slot_only() {
        let profile = "mage=test\nspec=frost\nback=,id=100\n";
        let drops = vec![drop(999, 16, vec![])];
        let (input, count, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
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
        let (input, count, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
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
        let (input, _, metadata) =
            generate_droptimizer_input(profile, &drops, None, &HashMap::new());
        assert!(
            input.contains("neck=,id=250247,ilevel=600,gem_id=1111/2222"),
            "expected equipped gem 1111 + most-used 2222 on the override neck:\n{input}"
        );
        let combo = metadata.get("Combo 2").expect("missing combo");
        assert_eq!(combo[0]["gem_id"], 1111);
        assert_eq!(combo[0]["gem_ids"], json!([1111, 2222]));
    }

    #[test]
    fn multiple_drops_get_sequential_combo_numbers() {
        let profile = "mage=test\nspec=frost\nhead=,id=100\nchest=,id=101\n";
        let drops = vec![
            drop(901, 1, vec![]),  // head
            drop(902, 5, vec![]),  // chest
            drop(903, 16, vec![]), // back (no equipped slot for this profile, but inv_type maps it)
        ];
        let (input, count, _) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
        // 3 drops, each emitting once. Even back works (it doesn't need equipped slot).
        assert_eq!(count, 3);
        assert!(input.contains("### Combo 2"));
        assert!(input.contains("### Combo 3"));
        assert!(input.contains("### Combo 4"));
    }

    #[test]
    fn drop_metadata_carries_encounter_field() {
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let drops = vec![json!({
            "item_id": 999,
            "ilevel": 600,
            "name": "Drop",
            "encounter": "Specific Boss Name",
            "inventory_type": 1,
            "bonus_ids": []
        })];
        let (_, _, metadata) = generate_droptimizer_input(profile, &drops, None, &HashMap::new());
        let combo = metadata.get("Combo 2").expect("missing combo");
        assert_eq!(combo[0]["encounter"], "Specific Boss Name");
    }

    /// A bonus-roll reward reaches simc exactly as the browser priced it: the
    /// flat vault rank for the tier, and the Very Rare override where one
    /// applies. The generator needs no bonus-roll protocol — it consumes the
    /// resolved `ilevel` and `bonus_ids` — so this pins that contract.
    #[test]
    fn bonus_roll_ranks_reach_the_generated_candidate() {
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test\nspec=frost\nhead=,id=100\n";
        // Heroic vault (Myth 1/6), Mythic vault (Myth 6/6), Very Rare override.
        for (ilvl, bonus_id) in [(318u64, 12849u64), (334, 12854), (344, 13848)] {
            let mut item = drop(271564, 1, vec![bonus_id]);
            item["ilevel"] = json!(ilvl);
            let (input, _, metadata) =
                generate_droptimizer_input(profile, &[item], None, &HashMap::new());
            assert!(
                input.contains(&format!("ilevel={ilvl}")),
                "candidate must sim at the vault rank, got:\n{input}"
            );
            assert!(
                input.contains(&format!("bonus_id={bonus_id}")),
                "candidate must carry the tier's bonus, got:\n{input}"
            );
            let entry = &metadata.values().next().expect("missing combo")[0];
            assert_eq!(entry["ilevel"], json!(ilvl), "reported level must agree");
        }
    }

    /// The gems the generator actually emits for one slot's candidate.
    fn gems_of(input: &str, slot: &str) -> Vec<u64> {
        let needle = format!("{slot}=,");
        let line = input
            .lines()
            .find(|l| l.starts_with("profileset.") && l.contains(&needle))
            .unwrap_or_else(|| panic!("no candidate line for {slot} in:\n{input}"));
        line.split(",gem_id=")
            .nth(1)
            .map(|tail| {
                tail.split(',')
                    .next()
                    .unwrap_or("")
                    .split('/')
                    .filter_map(|g| g.parse().ok())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// "Upgrade all equipped gear to the same level" lifts the character being
    /// compared against, not the loot. Raidbots does the same before generating
    /// candidates, which is why its reported gains are smaller.
    #[test]
    fn equipped_upgrade_lifts_the_baseline_without_touching_candidates() {
        crate::test_support::ensure_game_data_loaded();
        // Equipped neck sits at Hero 4/6 (315); the drop is priced at Myth 1/6 (318).
        let profile = "deathknight=test\nspec=unholy\nneck=,id=251234,bonus_id=12844\n";
        let upgraded = crate::item_db::upgrade_simc_input_to_rank(profile, 6);
        assert!(
            upgraded.contains("bonus_id=12846"),
            "equipped neck must reach Hero 6/6, got:\n{upgraded}"
        );

        let mut item = drop(268250, 2, vec![12849]);
        item["ilevel"] = json!(318);
        let (input, _, _) = generate_droptimizer_input(&upgraded, &[item], None, &HashMap::new());

        assert!(
            input.contains("bonus_id=12846"),
            "the baseline stays upgraded, got:\n{input}"
        );
        assert!(
            input.contains("bonus_id=12849"),
            "the candidate keeps the rank it was priced at, got:\n{input}"
        );
        assert!(
            !input.contains("12854"),
            "the candidate must not be lifted to Myth 6/6, got:\n{input}"
        );
    }

    /// Raidbots: "Preferred Gem: used when the Droptimizer item has more sockets
    /// than your equipped item." It never displaces a gem the player already wears.
    #[test]
    fn preferred_gem_only_fills_sockets_the_equipped_item_does_not_cover() {
        crate::test_support::ensure_game_data_loaded();
        // Aqirbane Reliquary carries two sockets; the worn neck only one.
        let profile = "mage=test\nspec=frost\nneck=,id=100,gem_id=240983\n";
        let gems = gems_of(
            &generate_droptimizer_input_with(
                profile,
                &[drop(268265, 2, vec![])],
                None,
                &HashMap::new(),
                DropRunOptions {
                    preferred_gem_id: Some(240908),
                    add_vault_socket: false,
                },
            )
            .0,
            "neck",
        );
        assert_eq!(gems.len(), 2, "the item's own two sockets, got {gems:?}");
        assert_eq!(gems[0], 240983, "the worn gem keeps the first socket");
        assert_eq!(
            gems[1], 240908,
            "only the uncovered one takes the preference"
        );

        // A single-socket neck is fully covered by what the player wears, so the
        // preference is never consulted.
        let covered = gems_of(
            &generate_droptimizer_input_with(
                profile,
                &[drop(268250, 2, vec![])],
                None,
                &HashMap::new(),
                DropRunOptions {
                    preferred_gem_id: Some(240908),
                    add_vault_socket: false,
                },
            )
            .0,
            "neck",
        );
        assert_eq!(covered, vec![240983]);
    }

    /// Older pickers saved the gem's enchantment id (8149) instead of its item id;
    /// SimC rejects that, so it falls back like no preference at all.
    #[test]
    fn a_preference_that_is_not_a_gem_item_falls_back_to_the_worn_gem() {
        crate::test_support::ensure_game_data_loaded();
        let profile = "mage=test\nspec=frost\nneck=,id=100,gem_id=240983\n";
        let gems = gems_of(
            &generate_droptimizer_input_with(
                profile,
                &[drop(268265, 2, vec![])],
                None,
                &HashMap::new(),
                DropRunOptions {
                    preferred_gem_id: Some(8149),
                    add_vault_socket: false,
                },
            )
            .0,
            "neck",
        );
        assert_eq!(gems, vec![240983, 240983]);
    }

    /// "All eligible items will be simmed as if they have a socket" — a floor of
    /// one, not an extra. Gear that already has sockets keeps exactly what it has,
    /// so the option only ever reaches slots with none of their own.
    #[test]
    fn the_vault_socket_is_a_floor_not_an_extra_socket() {
        crate::test_support::ensure_game_data_loaded();
        let profile =
            "mage=test\nspec=frost\nneck=,id=100,gem_id=240983\nhead=,id=101\nchest=,id=102\n";
        let with_vault = |item| {
            generate_droptimizer_input_with(
                profile,
                std::slice::from_ref(&item),
                None,
                &HashMap::new(),
                DropRunOptions {
                    preferred_gem_id: Some(240908),
                    add_vault_socket: true,
                },
            )
            .0
        };

        // Head has no socket of its own, so the floor gives it one.
        assert_eq!(
            gems_of(&with_vault(drop(268229, 1, vec![])), "head"),
            vec![240908]
        );
        // A neck already carries one; the floor must not add a second.
        assert_eq!(
            gems_of(&with_vault(drop(268250, 2, vec![])), "neck"),
            vec![240983]
        );
        // Nor a third on the two-socket neck.
        assert_eq!(
            gems_of(&with_vault(drop(268265, 2, vec![])), "neck"),
            vec![240983, 240908]
        );
        // Chest is not an eligible slot at all.
        assert!(gems_of(&with_vault(drop(268222, 5, vec![])), "chest").is_empty());
    }

    /// Two on-use trinkets are pressed in an order the APL decides per slot, so
    /// the same pair is worth simming both ways round. One on-use and one passive
    /// has no order to get wrong.
    #[test]
    fn a_double_on_use_pair_is_simmed_in_both_slot_orders() {
        crate::test_support::ensure_game_data_loaded();
        // Light Company Guidon is on-use, Keeper's Seething Core is not.
        assert!(
            crate::item_db::is_on_use_trinket(249344),
            "fixture: t1 is on-use"
        );
        assert!(
            !crate::item_db::is_on_use_trinket(270165),
            "fixture: t2 is passive"
        );
        assert!(
            crate::item_db::is_on_use_trinket(270168),
            "fixture: on-use drop"
        );
        assert!(
            !crate::item_db::is_on_use_trinket(270163),
            "fixture: passive drop"
        );

        let profile = "deathknight=t\nspec=unholy\ntrinket1=,id=249344\ntrinket2=,id=270165\n";
        // Each combo's trinket lines, in emission order.
        let combos_for = |item: Value| -> Vec<Vec<String>> {
            let (input, _, _) = generate_droptimizer_input(profile, &[item], None, &HashMap::new());
            let mut combos: Vec<(String, Vec<String>)> = Vec::new();
            for line in input.lines().filter(|l| l.starts_with("profileset.")) {
                let Some((name, rest)) = line.trim_start_matches("profileset.").split_once("+=")
                else {
                    continue;
                };
                if !rest.starts_with("trinket") {
                    continue;
                }
                match combos.last_mut() {
                    Some((n, entries)) if n == name => entries.push(rest.to_string()),
                    _ => combos.push((name.to_string(), vec![rest.to_string()])),
                }
            }
            combos.into_iter().map(|(_, entries)| entries).collect()
        };

        // An on-use drop replacing the passive trinket2 leaves two on-use
        // trinkets, so that pair is simmed both ways: three combos, not two.
        let on_use = combos_for(drop(270168, 12, vec![]));
        assert_eq!(on_use.len(), 3, "got: {on_use:#?}");
        assert!(on_use[0][0].starts_with("trinket1=,id=270168"));
        assert_eq!(on_use[0].len(), 1, "the untouched trinket2 stays put");
        assert!(on_use[1][0].starts_with("trinket2=,id=270168"));
        assert_eq!(on_use[1].len(), 1, "the untouched trinket1 stays put");
        // The third holds the same pair as the second, slots reversed.
        assert_eq!(
            on_use[2].len(),
            2,
            "the partner moves across: {:?}",
            on_use[2]
        );
        assert!(on_use[2][0].starts_with("trinket1=,id=270168"));
        assert!(on_use[2][1].starts_with("trinket2=,id=249344"));

        // A passive drop can never form a double on-use pair.
        let passive = combos_for(drop(270163, 12, vec![]));
        assert_eq!(passive.len(), 2, "got: {passive:#?}");
        assert!(passive.iter().all(|c| c.len() == 1), "nothing to reorder");
    }

    /// With no explicit pick the inferred gem still fills the floor's socket, so
    /// the option is additive rather than a switch that turns gemming on."""
    #[test]
    fn without_a_preference_the_most_used_equipped_gem_fills_the_vault_socket() {
        crate::test_support::ensure_game_data_loaded();
        let profile =
            "mage=test\nspec=frost\nneck=,id=100,gem_id=240983\nfinger1=,id=102,gem_id=240983\n";
        let (input, _, _) = generate_droptimizer_input_with(
            profile,
            &[drop(268229, 1, vec![])],
            None,
            &HashMap::new(),
            DropRunOptions {
                preferred_gem_id: None,
                add_vault_socket: true,
            },
        );
        assert_eq!(gems_of(&input, "head"), vec![240983]);
    }
}
