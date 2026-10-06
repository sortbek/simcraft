use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use crate::types::class_data::title_case;

fn extract_version(raw: &Value) -> String {
    let version = raw.get("version").and_then(|v| v.as_str()).unwrap_or("");
    let git_rev = raw
        .get("git_revision")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let git_branch = raw.get("git_branch").and_then(|v| v.as_str()).unwrap_or("");
    let build_date = raw.get("build_date").and_then(|v| v.as_str()).unwrap_or("");

    let mut parts: Vec<String> = Vec::new();
    if !version.is_empty() {
        parts.push(format!("SimC {}", version));
    }
    if !git_branch.is_empty() {
        parts.push(git_branch.to_string());
    }
    if !git_rev.is_empty() {
        parts.push(git_rev.chars().take(7).collect());
    }
    if !build_date.is_empty() {
        parts.push(build_date.to_string());
    }

    if parts.is_empty() {
        "Unknown".to_string()
    } else {
        parts.join(" / ")
    }
}

/// Read portion_apse from a stat entry (can be an object with `mean` or a bare number).
/// `portion_apse` is normalized over total fight length, so per-ability rows sum to
/// the player's overall DPS. The `portion_aps` variant divides by actor active time,
/// which inflates abilities that only fire during short uptimes (e.g. pet windows).
fn extract_portion_apse(stat: &Value) -> f64 {
    match stat.get("portion_apse") {
        Some(v) if v.is_object() => v.get("mean").and_then(|m| m.as_f64()).unwrap_or(0.0),
        Some(v) => v.as_f64().unwrap_or(0.0),
        None => 0.0,
    }
}

/// Pick a representative pet/summon ability icon for the given player.
/// Accepts whatever simc puts in `specialization` or `type` (e.g. "Beast Mastery Hunter",
/// "Hunter", "hunter") and matches loosely on substrings so casing/format drift doesn't
/// break the lookup. Returns None for classes without a meaningful pet.
fn pet_icon_for_spec(spec_or_class: &str) -> Option<&'static str> {
    let s = spec_or_class.to_lowercase();
    if s.contains("death knight") || s.contains("death_knight") || s.contains("deathknight") {
        return Some("spell_shadow_animatedead");
    }
    if s.contains("hunter") {
        return Some("ability_hunter_beastcall");
    }
    if s.contains("warlock") {
        return Some("spell_shadow_summoninfernal");
    }
    if s.contains("mage") {
        return Some("spell_magic_lesserinvisibility");
    }
    if s.contains("shaman") {
        return Some("spell_fire_elemental_totem");
    }
    if s.contains("priest") {
        return Some("spell_shadow_shadowfiend");
    }
    if s.contains("monk") {
        return Some("ability_monk_summontigerstatue");
    }
    if s.contains("druid") {
        return Some("ability_druid_forceofnature");
    }
    if s.contains("paladin") {
        return Some("ability_paladin_artofwar");
    }
    if s.contains("evoker") {
        return Some("ability_evoker_dragonrage");
    }
    None
}

/// Extract ability stats from a player or pet stats array into the abilities list.
fn extract_stats_into(abilities: &mut Vec<Value>, stats: Option<&Value>) {
    let stats = match stats.and_then(|s| s.as_array()) {
        Some(s) => s,
        None => return,
    };
    for stat in stats {
        let raw_name = stat.get("name").and_then(|n| n.as_str()).unwrap_or("");
        if raw_name.is_empty() {
            continue;
        }

        // Get DPS from portion_apse (object with mean, or bare number).
        // Sum parent + children to get total DPS for this ability group.
        let parent_dps = extract_portion_apse(stat);
        let children_arr = stat.get("children").and_then(|c| c.as_array());
        let mut children_dps_total = 0.0;
        if let Some(children) = children_arr {
            for child in children {
                children_dps_total += extract_portion_apse(child);
            }
        }
        let dps_contribution = parent_dps + children_dps_total;

        if dps_contribution <= 0.0 {
            continue;
        }

        let school = stat
            .get("school")
            .and_then(|s| s.as_str())
            .unwrap_or("physical");
        let display_name = raw_name.to_string();

        // Resolve spell_id: prefer parent, fall back to first child
        let mut spell_id = stat.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
        if spell_id == 0 {
            if let Some(children) = children_arr {
                if let Some(child) = children.first() {
                    spell_id = child.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                }
            }
        }

        let mut ability = json!({
            "name": display_name,
            "portion_dps": round1(dps_contribution),
            "school": school,
        });
        if spell_id > 0 {
            ability["spell_id"] = json!(spell_id);
        }

        // Emit children when the parent has multiple sub-abilities.
        // If the parent itself does damage alongside children, include
        // the parent's own contribution as the first child entry.
        if let Some(children) = children_arr {
            let mut child_entries: Vec<Value> = Vec::new();

            // Parent's own damage as first sub-entry
            if parent_dps > 0.0 {
                let mut parent_entry = json!({
                    "name": raw_name,
                    "portion_dps": round1(parent_dps),
                    "school": school,
                });
                if spell_id > 0 {
                    parent_entry["spell_id"] = json!(spell_id);
                }
                child_entries.push(parent_entry);
            }

            for child in children {
                let child_dps = extract_portion_apse(child);
                if child_dps <= 0.0 {
                    continue;
                }
                let child_name = child.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let child_school = child
                    .get("school")
                    .and_then(|s| s.as_str())
                    .unwrap_or(school);
                let child_spell_id = child.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                let mut entry = json!({
                    "name": child_name,
                    "portion_dps": round1(child_dps),
                    "school": child_school,
                });
                if child_spell_id > 0 {
                    entry["spell_id"] = json!(child_spell_id);
                }
                child_entries.push(entry);
            }

            if child_entries.len() > 1 {
                ability["children"] = json!(child_entries);
            }
        }

        abilities.push(ability);
    }
}

/// Extract key metrics from raw simc JSON output.
pub fn parse_simc_result(raw: &Value) -> Value {
    let empty = json!({});
    let sim = raw.get("sim").unwrap_or(&empty);
    let players = sim.get("players").and_then(|p| p.as_array());

    let players = match players {
        Some(p) if !p.is_empty() => p,
        _ => return json!({"error": "No player data found in simulation output"}),
    };

    let player = &players[0];
    let empty2 = json!({});
    let empty3 = json!({});
    let collected = player.get("collected_data").unwrap_or(&empty2);
    let dps_data = collected.get("dps").unwrap_or(&empty3);

    let dps_mean = dps_data.get("mean").and_then(|v| v.as_f64()).unwrap_or(0.0);

    let fight_length = sim
        .get("statistics")
        .and_then(|s| s.get("simulation_length"))
        .and_then(|sl| sl.get("mean"))
        .and_then(|m| m.as_f64())
        .unwrap_or(0.0);

    let statistics = sim.get("statistics").unwrap_or(&empty);
    let total_iterations = collected
        .get("dps")
        .and_then(|d| d.get("count"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let elapsed_time = statistics
        .get("elapsed_time_seconds")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let options = sim.get("options").unwrap_or(&empty);
    let target_error = options
        .get("target_error")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let desired_targets = options
        .get("desired_targets")
        .and_then(|v| v.as_u64())
        .unwrap_or(1);
    // Achieved 95% CI half-width as % of mean (same semantics as the user's
    // `target_error`): equals target_error when hit, honestly larger when the
    // iteration budget undershoots. Same formula as the per-row badges.
    let error_pct = precision_pct_from_simc(dps_data, dps_mean).unwrap_or(target_error);
    let dps_error_abs = dps_mean * error_pct / 100.0;

    let mut result = json!({
        "player_name": player.get("name").and_then(|n| n.as_str()).unwrap_or("Unknown"),
        "player_class": player.get("specialization")
            .or_else(|| player.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown"),
        "dps": round1(dps_mean),
        "dps_error": round1(dps_error_abs),
        "dps_error_pct": round2(error_pct),
        "fight_length": round1(fight_length),
        "desired_targets": desired_targets,
        "iterations": total_iterations,
        "elapsed_time_seconds": round2(elapsed_time),
        "target_error": target_error,
        "simc_version": extract_version(raw),
        "simc_git_revision": raw.get("git_revision").and_then(|v| v.as_str()).unwrap_or(""),
    });
    if let Some(setup) = extract_setup(sim, player) {
        result["setup"] = setup;
    }

    // Ability breakdown (player + pets)
    let mut abilities: Vec<Value> = Vec::new();
    extract_stats_into(&mut abilities, player.get("stats"));

    // Pet abilities: roll up each pet's full ability list into a single parent row
    // named after the pet, with the individual abilities as children. This matches
    // raidbots' presentation (one row per pet, expandable for the breakdown).
    let pet_icon = pet_icon_for_spec(
        player
            .get("specialization")
            .or_else(|| player.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or(""),
    );
    if let Some(stats_pets) = player.get("stats_pets").and_then(|p| p.as_object()) {
        for (pet_name, pet_stats) in stats_pets {
            let mut pet_abilities: Vec<Value> = Vec::new();
            extract_stats_into(&mut pet_abilities, Some(pet_stats));
            if pet_abilities.is_empty() {
                continue;
            }

            pet_abilities.sort_by(|a, b| {
                let a_dps = a["portion_dps"].as_f64().unwrap_or(0.0);
                let b_dps = b["portion_dps"].as_f64().unwrap_or(0.0);
                b_dps
                    .partial_cmp(&a_dps)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });

            let total_dps: f64 = pet_abilities
                .iter()
                .map(|a| a["portion_dps"].as_f64().unwrap_or(0.0))
                .sum();

            let display_name = title_case(&pet_name.replace('_', " "));
            let school = pet_abilities[0]["school"]
                .as_str()
                .unwrap_or("physical")
                .to_string();

            let mut pet_entry = json!({
                "name": display_name,
                "portion_dps": round1(total_dps),
                "school": school,
            });
            if let Some(icon) = pet_icon {
                pet_entry["icon"] = json!(icon);
            }
            if pet_abilities.len() > 1 {
                pet_entry["children"] = json!(pet_abilities);
            }
            abilities.push(pet_entry);
        }
    }

    if !abilities.is_empty() {
        abilities.sort_by(|a, b| {
            let a_dps = a["portion_dps"].as_f64().unwrap_or(0.0);
            let b_dps = b["portion_dps"].as_f64().unwrap_or(0.0);
            b_dps
                .partial_cmp(&a_dps)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        result["abilities"] = json!(abilities);
    }

    // Stat weights
    if let Some(scaling) = player.get("scale_factors").and_then(|s| s.as_object()) {
        let mut stat_weights: Vec<(String, f64)> = Vec::new();
        for (stat_name, value) in scaling {
            let v = value.as_f64().unwrap_or(0.0);
            if v != 0.0 {
                stat_weights.push((stat_name.clone(), round4(v)));
            }
        }
        if !stat_weights.is_empty() {
            stat_weights.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            let mut map = serde_json::Map::new();
            for (k, v) in stat_weights {
                map.insert(k, json!(v));
            }
            result["stat_weights"] = Value::Object(map);
        }
    }

    // Equipped gear
    let all_gear = extract_all_gear(player);
    if !all_gear.is_empty() {
        let equipped_gear: serde_json::Map<String, Value> = all_gear.into_iter().collect();
        result["equipped_gear"] = Value::Object(equipped_gear);
    }

    result
}

/// Build one `equipped_gear` entry from a SimC item string (`name,id=...,...`).
/// `name_hint` and `ilevel_hint` supply what the string itself may omit.
fn gear_entry(slot: &str, encoded: &str, name_hint: &str, ilevel_hint: u64) -> Value {
    static ILVL_RE: OnceLock<Regex> = OnceLock::new();
    let ilvl_re = ILVL_RE.get_or_init(|| Regex::new(r"ilevel=(\d+)").unwrap());

    let item_id = crate::simc_string::extract_item_id(encoded);

    let mut ilevel: u64 = ilvl_re
        .captures(encoded)
        .and_then(|c| c[1].parse().ok())
        .unwrap_or(0);
    if ilevel == 0 {
        ilevel = ilevel_hint;
    }

    let bonus_ids = crate::simc_string::extract_bonus_ids(encoded);
    let enchant_id = crate::simc_string::extract_enchant_id(encoded);
    let gem_ids: Vec<u64> = crate::simc_string::extract_gem_ids(encoded)
        .into_iter()
        .filter(|&id| id > 0)
        .collect();
    let gem_id: u64 = gem_ids.first().copied().unwrap_or(0);

    let name = title_case(&name_hint.replace('_', " "));

    let info = crate::item_db::get_item_info(item_id, Some(&bonus_ids));
    let sockets = info.as_ref().map(|i| i.sockets).unwrap_or(0);
    // Armory exports omit `ilevel=` when bonus ids already imply it, so resolve
    // it from those rather than reporting the item's unupgraded base level.
    if ilevel == 0 {
        ilevel = info.as_ref().map(|i| i.ilevel).unwrap_or(0);
    }

    let source_item_id = crate::simc_string::extract_redirected_base_stats(encoded);

    let mut entry = json!({
        "slot": slot,
        "item_id": item_id,
        "ilevel": ilevel,
        "name": name,
        "bonus_ids": bonus_ids,
        "enchant_id": enchant_id,
        "gem_id": gem_id,
        "gem_ids": gem_ids,
        "sockets": sockets,
        "is_kept": true,
    });
    if source_item_id > 0 {
        entry["source_item_id"] = json!(source_item_id);
    }
    entry
}

/// Fill `equipped_gear` holes from the profile we sent.
///
/// SimC's gear report skips any item whose `has_stats()` is false (`gear_to_json`
/// in report_json.cpp), and such an item appears nowhere else in its output, so a
/// worn stat-less piece is simply absent from the result and its slot renders
/// empty. The profile is the only surviving record of it.
///
/// Only slots SimC left out are touched, and only when we actually sent an item
/// id for them, so anything SimC did report always wins.
pub(crate) fn backfill_equipped_gear(parsed: &mut Value, simc_input: &str) {
    static GEAR_RE: OnceLock<Regex> = OnceLock::new();
    let gear_re = GEAR_RE.get_or_init(|| {
        Regex::new(&format!(
            r"^({})=(.*)",
            crate::types::class_data::GEAR_SLOTS.join("|")
        ))
        .unwrap()
    });

    let reported: HashSet<String> = parsed
        .get("equipped_gear")
        .and_then(|g| g.as_object())
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();

    // A later line overrides an earlier one and `slot=,` clears the slot — re-running
    // one Top Gear row appends the combo's overrides after the original gear, so a
    // two-hander row really does emit `off_hand=,` after an off-hand line.
    let mut latest: HashMap<String, Option<Value>> = HashMap::new();
    let mut actors_seen = 0usize;
    for line in simc_input.lines() {
        let trimmed = line.trim();
        // The result describes players[0], but raw input may declare several
        // actors; anything past the first one is a different character's gear.
        if crate::types::class_data::class_line_character(trimmed).is_some() {
            actors_seen += 1;
            if actors_seen > 1 {
                break;
            }
            continue;
        }
        let Some(caps) = gear_re.captures(trimmed) else {
            continue;
        };
        let slot = caps[1].to_lowercase();
        if reported.contains(&slot) {
            continue;
        }
        let encoded = &caps[2];
        if crate::simc_string::extract_item_id(encoded) == 0 {
            latest.insert(slot, None);
            continue;
        }
        // The profile carries a tokenized name ahead of the first comma; the
        // item level is left to the item DB when the line omits it.
        let name_hint = encoded.split(',').next().unwrap_or("");
        latest.insert(slot.clone(), Some(gear_entry(&slot, encoded, name_hint, 0)));
    }

    let missing: Vec<(String, Value)> = latest
        .into_iter()
        .filter_map(|(slot, entry)| entry.map(|e| (slot, e)))
        .collect();
    if missing.is_empty() {
        return;
    }
    if !parsed["equipped_gear"].is_object() {
        parsed["equipped_gear"] = json!({});
    }
    let gear = parsed["equipped_gear"].as_object_mut().unwrap();
    for (slot, entry) in missing {
        gear.insert(slot, entry);
    }
}

fn extract_all_gear(player: &Value) -> HashMap<String, Value> {
    let empty = json!({});
    let gear = player.get("gear").unwrap_or(&empty);
    let gear_obj = match gear.as_object() {
        Some(o) => o,
        None => return HashMap::new(),
    };

    let mut baseline: HashMap<String, Value> = HashMap::new();

    for (raw_slot, data) in gear_obj {
        // simc JSON output uses different slot names than simc input
        let slot = match raw_slot.as_str() {
            "shoulders" => "shoulder".to_string(),
            "wrists" => "wrist".to_string(),
            other => other.to_string(),
        };

        let encoded = data
            .get("encoded_item")
            .and_then(|e| e.as_str())
            .unwrap_or("");

        let name_hint = data.get("name").and_then(|n| n.as_str()).unwrap_or("");
        let ilevel_hint = data.get("ilevel").and_then(|i| i.as_u64()).unwrap_or(0);

        let entry = gear_entry(&slot, encoded, name_hint, ilevel_hint);
        baseline.insert(slot, entry);
    }

    baseline
}

/// Parse a profileset/gear-comparison SimC result (Top Gear, Drop Finder,
/// Upgrade Compare). `sim_type` is the wire string of the producing mode; it
/// lands in the returned payload as `"type"`.
pub fn parse_gear_comparison_result(
    raw: &Value,
    combo_metadata: Option<&HashMap<String, Vec<Value>>>,
    sim_type: &str,
) -> Value {
    let empty_meta = HashMap::new();
    let combo_metadata = combo_metadata.unwrap_or(&empty_meta);

    let empty = json!({});
    let sim = raw.get("sim").unwrap_or(&empty);
    let players = sim.get("players").and_then(|p| p.as_array());

    let players = match players {
        Some(p) if !p.is_empty() => p,
        _ => {
            return json!({"type": sim_type, "result_kind": "gear_comparison", "error": "No player data found"})
        }
    };

    let player = &players[0];
    let empty2 = json!({});
    let collected = player.get("collected_data").unwrap_or(&empty2);
    let base_dps = collected
        .get("dps")
        .and_then(|d| d.get("mean"))
        .and_then(|m| m.as_f64())
        .unwrap_or(0.0);

    let profilesets = sim
        .get("profilesets")
        .and_then(|p| p.get("results"))
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default();

    let mut results: Vec<Value> = Vec::new();

    for ps in &profilesets {
        let mean_dps = ps.get("mean").and_then(|m| m.as_f64()).unwrap_or(0.0);
        let combo_name = ps.get("name").and_then(|n| n.as_str()).unwrap_or("Unknown");

        let items = combo_metadata.get(combo_name).cloned().unwrap_or_default();

        // Extract talent_build name and spec from items metadata (if present)
        let talent_build = items
            .first()
            .and_then(|it| it.get("talent_build"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let talent_spec = items
            .first()
            .and_then(|it| it.get("talent_spec"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let folio_build = items
            .first()
            .and_then(|it| it.get("folio_build"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // 95% CI half-width as a percent of the mean. simc reports the
        // standard error of the mean in `mean_std_dev`; the half-width is
        // 1.96 × that. Smaller is better. For combos that were pruned at an
        // early stage the displayed mean carries this stage's looser CI,
        // which the UI surfaces so users can see how trustworthy a row is.
        let precision_pct = precision_pct_from_simc(ps, mean_dps);

        let mut entry = json!({
            "name": combo_name,
            "items": items,
            "dps": round1(mean_dps),
            "delta": round1(mean_dps - base_dps),
        });
        if let Some(p) = precision_pct {
            entry["precision_pct"] = json!(round2(p));
        }
        if !talent_build.is_empty() {
            entry["talent_build"] = json!(talent_build);
        }
        if !talent_spec.is_empty() {
            entry["talent_spec"] = json!(talent_spec);
        }
        if !folio_build.is_empty() {
            entry["folio_build"] = json!(folio_build);
        }
        results.push(entry);
    }

    // Add the base (equipped) profile — look for exact or prefixed key
    let baseline_key = combo_metadata
        .keys()
        .find(|k| k.starts_with("Currently Equipped"))
        .cloned();
    let baseline_items = baseline_key
        .as_deref()
        .and_then(|k| combo_metadata.get(k))
        .cloned()
        .unwrap_or_default();

    let baseline_talent = baseline_items
        .first()
        .and_then(|it| it.get("talent_build"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let baseline_talent_spec = baseline_items
        .first()
        .and_then(|it| it.get("talent_spec"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let baseline_folio = baseline_items
        .first()
        .and_then(|it| it.get("folio_build"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let baseline_items = if baseline_items.is_empty() {
        let all_gear = extract_all_gear(player);
        ["finger1", "finger2", "trinket1", "trinket2"]
            .iter()
            .filter_map(|s| all_gear.get(*s).cloned())
            .collect::<Vec<_>>()
    } else {
        baseline_items
    };

    let baseline_precision_pct = player
        .get("collected_data")
        .and_then(|c| c.get("dps"))
        .and_then(|d| precision_pct_from_simc(d, base_dps));
    let mut baseline_entry = json!({
        "name": baseline_key.as_deref().unwrap_or("Currently Equipped"),
        "items": baseline_items,
        "dps": round1(base_dps),
        "delta": 0,
    });
    if let Some(p) = baseline_precision_pct {
        baseline_entry["precision_pct"] = json!(round2(p));
    }
    if !baseline_talent.is_empty() {
        baseline_entry["talent_build"] = json!(baseline_talent);
    }
    if !baseline_talent_spec.is_empty() {
        baseline_entry["talent_spec"] = json!(baseline_talent_spec);
    }
    if !baseline_folio.is_empty() {
        baseline_entry["folio_build"] = json!(baseline_folio);
    }
    results.push(baseline_entry);

    results.sort_by(|a, b| {
        let a_dps = a["dps"].as_f64().unwrap_or(0.0);
        let b_dps = b["dps"].as_f64().unwrap_or(0.0);
        b_dps
            .partial_cmp(&a_dps)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Extract full equipped gear for gear overview
    let all_gear = extract_all_gear(player);
    let equipped_gear: serde_json::Map<String, Value> = all_gear.into_iter().collect();

    let statistics = sim.get("statistics").unwrap_or(&empty);
    let options = sim.get("options").unwrap_or(&empty);
    let total_iterations = collected
        .get("dps")
        .and_then(|d| d.get("count"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let elapsed_time = statistics
        .get("elapsed_time_seconds")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    // Cloud-merged results carry no `sim.statistics`; fall back to the configured
    // `max_time` (a fixed-length fight's mean ≈ max_time) so the footer shows the
    // fight length instead of 0. Local always has statistics, so this is a no-op.
    let fight_length = statistics
        .get("simulation_length")
        .and_then(|sl| sl.get("mean"))
        .and_then(|m| m.as_f64())
        .or_else(|| options.get("max_time").and_then(|v| v.as_f64()))
        .unwrap_or(0.0);
    let target_error = options
        .get("target_error")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let desired_targets = options
        .get("desired_targets")
        .and_then(|v| v.as_u64())
        .unwrap_or(1);
    let max_time = options
        .get("max_time")
        .and_then(|v| v.as_f64())
        .unwrap_or(300.0);
    // Achieved 95% CI half-width as % of mean — same formula as the per-row
    // precision badges so the hero card and the rows agree. Falls back to
    // target_error when mean_std_dev is missing.
    let dps_block = collected.get("dps").unwrap_or(&empty);
    let error_pct = precision_pct_from_simc(dps_block, base_dps).unwrap_or(target_error);
    let dps_error_abs = base_dps * error_pct / 100.0;

    let mut out = json!({
        "type": sim_type,
        "result_kind": "gear_comparison",
        "base_dps": round1(base_dps),
        "dps_error": round1(dps_error_abs),
        "dps_error_pct": round2(error_pct),
        "fight_length": round1(fight_length),
        "desired_targets": desired_targets,
        "max_time": round1(max_time),
        "iterations": total_iterations,
        "elapsed_time_seconds": round2(elapsed_time),
        "target_error": target_error,
        "player_name": player.get("name").and_then(|n| n.as_str()).unwrap_or("Unknown"),
        "player_class": player.get("specialization")
            .or_else(|| player.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown"),
        "simc_version": extract_version(raw),
        "simc_git_revision": raw.get("git_revision").and_then(|v| v.as_str()).unwrap_or(""),
        "results": results,
        "equipped_gear": Value::Object(equipped_gear),
    });
    if let Some(setup) = extract_setup(sim, player) {
        out["setup"] = setup;
    }
    out
}

/// Adds `setup` to a result stored before it existed, read from the job's raw SimC
/// JSON. Sets `null` when there is nothing to read, so a caller that persists the
/// result never tries again. Returns whether the result changed.
pub fn backfill_setup(result: &mut Value, raw_json: Option<&str>) -> bool {
    if result.get("setup").is_some() || !result.is_object() {
        return false;
    }
    let raw = raw_json.and_then(|s| serde_json::from_str::<Value>(s).ok());
    let setup = raw.as_ref().and_then(|raw| {
        let sim = &raw["sim"];
        let player = sim["players"].as_array().and_then(|p| p.first())?;
        extract_setup(sim, player)
    });
    result["setup"] = setup.unwrap_or(Value::Null);
    true
}

/// Consumables, raid buffs and fight shape SimC actually ran with (its own
/// defaults resolved), so result pages can show them.
fn extract_setup(sim: &Value, player: &Value) -> Option<Value> {
    // SimC token plus display name/icon from the consumable lists, when known.
    let describe = |token: Option<&str>, list: &[Value]| -> Value {
        let Some(token) = token
            .map(str::trim)
            .filter(|v| !v.is_empty() && *v != "disabled" && *v != "none")
        else {
            return Value::Null;
        };
        let mut entry = json!({ "value": token });
        if let Some(known) = list
            .iter()
            .find(|e| e.get("value").and_then(|v| v.as_str()) == Some(token))
        {
            for (from, to) in [
                ("name", "name"),
                ("icon", "icon"),
                ("itemId", "item_id"),
                ("craftingQuality", "quality"),
            ] {
                if let Some(v) = known.get(from) {
                    entry[to] = v.clone();
                }
            }
        }
        entry
    };
    let token = |key: &str| player.get(key).and_then(|v| v.as_str());
    // `temporary_enchant` is `main_hand:oil[/off_hand:oil]`; the main-hand oil is the rune.
    let weapon_rune = token("temporary_enchant").and_then(|s| {
        s.split('/')
            .find_map(|part| part.strip_prefix("main_hand:"))
    });
    let consumables = json!({
        "potion": describe(token("potion"), crate::game_data::list_potions()),
        "flask": describe(token("flask"), crate::game_data::list_flasks()),
        "food": describe(token("food"), crate::game_data::list_foods()),
        "augmentation": describe(token("augmentation"), crate::game_data::list_augments()),
        "weapon_rune": describe(weapon_rune, crate::game_data::list_temp_enchants()),
    });
    let raid_buffs: serde_json::Map<String, Value> = sim
        .get("overrides")
        .and_then(|o| o.as_object())
        .map(|o| {
            o.iter()
                .map(|(k, v)| (k.clone(), json!(v.as_f64().unwrap_or(0.0) != 0.0)))
                .collect()
        })
        .unwrap_or_default();
    if raid_buffs.is_empty() && consumables.as_object()?.values().all(Value::is_null) {
        return None;
    }
    let options = sim.get("options");
    Some(json!({
        "consumables": consumables,
        "raid_buffs": raid_buffs,
        "fight_style": options.and_then(|o| o.get("fight_style")).cloned().unwrap_or(Value::Null),
        "desired_targets": options.and_then(|o| o.get("desired_targets")).cloned().unwrap_or(Value::Null),
        "max_time": options.and_then(|o| o.get("max_time")).cloned().unwrap_or(Value::Null),
    }))
}

/// 95% CI half-width as a percent of the mean, read from a simc result block.
/// The two block shapes name the standard error differently: `collected_data.dps`
/// uses `mean_std_dev`, a `profilesets.results` entry uses `mean_stddev` (plus
/// `mean_error` = the 95% half-width already). Accept all three or the badge goes
/// `None` for every profileset row. Returns `None` if no error field or mean is 0.
fn precision_pct_from_simc(block: &Value, mean: f64) -> Option<f64> {
    if mean <= 0.0 {
        return None;
    }
    // Standard error of the mean, under either field name → 1.96× for 95% CI.
    if let Some(sem) = block
        .get("mean_std_dev")
        .or_else(|| block.get("mean_stddev"))
        .and_then(|v| v.as_f64())
    {
        return Some(1.96 * sem / mean * 100.0);
    }
    // `mean_error` is already the 95% half-width (absolute).
    let mean_error = block.get("mean_error").and_then(|v| v.as_f64())?;
    Some(mean_error / mean * 100.0)
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn round4(v: f64) -> f64 {
    (v * 10000.0).round() / 10000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find_row<'a>(parsed: &'a Value, name: &str) -> &'a Value {
        parsed["results"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["name"] == name)
            .expect("row present")
    }

    /// Regression: SimC profileset result rows name the standard error of the
    /// mean `mean_stddev` (NOT `mean_std_dev`, which is the main-actor spelling),
    /// so reading only `mean_std_dev` left every per-row precision badge `null`.
    /// Field values are a real simc profileset row from `simc.exe`.
    #[test]
    fn profileset_precision_badge_reads_mean_stddev() {
        let raw = json!({
            "sim": {
                "players": [{
                    "name": "Base",
                    "collected_data": { "dps": { "mean": 1000.0, "mean_std_dev": 2.0 } }
                }],
                "profilesets": { "results": [
                    { "name": "Combo 1", "mean": 399.4572212376752,
                      "mean_stddev": 1.4333896936395902, "mean_error": 2.809392176589867 }
                ] }
            }
        });
        let parsed = parse_gear_comparison_result(&raw, None, "top_gear");
        // 1.96 * 1.43339 / 399.457 * 100 = 0.70%
        assert_eq!(
            find_row(&parsed, "Combo 1")["precision_pct"].as_f64(),
            Some(0.70)
        );
    }

    /// Field values are a real simc.exe report: resolved consumables (SimC's own
    /// defaults included) and the raid-buff overrides, with Bloodlust switched off.
    #[test]
    fn setup_reports_consumables_and_raid_buffs_simc_used() {
        crate::test_support::ensure_game_data_loaded();
        let raw = json!({
            "sim": {
                "options": { "fight_style": "Patchwerk", "desired_targets": 1, "max_time": 300.0 },
                "overrides": { "arcane_intellect": 1, "bloodlust": 0 },
                "players": [{
                    "name": "Base",
                    "potion": "liquid_luster_2",
                    "flask": "flask_of_the_shattered_sun_2",
                    "food": "harandar_celebration",
                    "augmentation": "void_touched",
                    "temporary_enchant": "main_hand:thalassian_phoenix_oil_2",
                    "collected_data": { "dps": { "mean": 1000.0, "mean_std_dev": 2.0 } }
                }]
            }
        });
        for parsed in [
            parse_simc_result(&raw),
            parse_gear_comparison_result(&raw, None, "top_gear"),
        ] {
            let setup = &parsed["setup"];
            let flask = &setup["consumables"]["flask"];
            assert_eq!(flask["value"], "flask_of_the_shattered_sun_2");
            assert!(flask["name"].as_str().is_some_and(|n| !n.is_empty()));
            assert!(flask["icon"].as_str().is_some());
            assert_eq!(
                setup["consumables"]["weapon_rune"]["value"],
                "thalassian_phoenix_oil_2"
            );
            assert_eq!(setup["raid_buffs"]["bloodlust"], false);
            assert_eq!(setup["raid_buffs"]["arcane_intellect"], true);
            assert_eq!(setup["fight_style"], "Patchwerk");
        }
    }

    #[test]
    fn backfill_marks_a_result_with_nothing_to_read_so_it_is_not_retried() {
        let mut result = json!({"dps": 1.0});
        assert!(backfill_setup(&mut result, None));
        assert_eq!(result["setup"], Value::Null);
        assert!(!backfill_setup(&mut result, None));
    }

    #[test]
    fn setup_absent_when_simc_reports_nothing() {
        let raw = json!({
            "sim": { "players": [{
                "name": "Base",
                "temporary_enchant": "disabled",
                "collected_data": { "dps": { "mean": 1000.0 } }
            }] }
        });
        assert!(parse_simc_result(&raw).get("setup").is_none());
    }

    /// A folio combination is tagged on the combo's metadata, and the row has to
    /// carry it through or the results can't say which runes won.
    #[test]
    fn folio_build_reaches_the_result_row() {
        let raw = json!({
            "sim": {
                "players": [{
                    "name": "Base",
                    "collected_data": { "dps": { "mean": 1000.0, "mean_std_dev": 2.0 } }
                }],
                "profilesets": { "results": [
                    { "name": "Combo 2", "mean": 1100.0, "mean_error": 2.8 }
                ] }
            }
        });
        let mut meta = HashMap::new();
        meta.insert(
            "Combo 2".to_string(),
            vec![json!({ "slot": "head", "item_id": 100, "folio_build": "Echoes" })],
        );
        meta.insert(
            "Currently Equipped".to_string(),
            vec![json!({ "slot": "head", "item_id": 100, "folio_build": "Overload" })],
        );

        let parsed = parse_gear_comparison_result(&raw, Some(&meta), "top_gear");

        assert_eq!(find_row(&parsed, "Combo 2")["folio_build"], "Echoes");
        assert_eq!(
            find_row(&parsed, "Currently Equipped")["folio_build"],
            "Overload",
            "the baseline row names its folio too"
        );
    }

    /// Rows that carry only `mean_error` (the 95% half-width, absolute) still
    /// resolve a precision percent.
    #[test]
    fn profileset_precision_badge_falls_back_to_mean_error() {
        let raw = json!({
            "sim": {
                "players": [{
                    "name": "Base",
                    "collected_data": { "dps": { "mean": 1000.0, "mean_std_dev": 2.0 } }
                }],
                "profilesets": { "results": [
                    { "name": "Combo 1", "mean": 400.0, "mean_error": 2.8 }
                ] }
            }
        });
        let parsed = parse_gear_comparison_result(&raw, None, "top_gear");
        // 2.8 / 400 * 100 = 0.70%
        assert_eq!(
            find_row(&parsed, "Combo 1")["precision_pct"].as_f64(),
            Some(0.70)
        );
    }

    /// Cloud-merged results carry `sim.options` but no `sim.statistics`; the
    /// footer's fight length falls back to the configured `max_time` instead of 0.
    #[test]
    fn fight_length_falls_back_to_max_time_without_statistics() {
        let raw = json!({
            "sim": {
                "players": [{ "name": "Base", "collected_data": { "dps": { "mean": 1000.0 } } }],
                "profilesets": { "results": [] },
                "options": { "max_time": 300.0, "target_error": 0.1 }
            }
        });
        let parsed = parse_gear_comparison_result(&raw, None, "top_gear");
        assert_eq!(parsed["fight_length"].as_f64(), Some(300.0));
        assert_eq!(parsed["target_error"].as_f64(), Some(0.1));
    }
}

#[cfg(test)]
mod baseline_gear_tests {
    use super::*;
    use crate::test_support::ensure_game_data_loaded;

    #[test]
    fn baseline_gear_carries_source_item_id_without_catalyst_flag() {
        ensure_game_data_loaded();
        let player = json!({
            "gear": {
                "head": {
                    "encoded_item": "helm,id=250042,bonus_id=12849,redirected_base_stats=249629",
                    "ilevel": 600
                },
                "neck": { "encoded_item": "neck,id=100", "ilevel": 600 }
            }
        });
        let gear = extract_all_gear(&player);
        assert_eq!(gear["head"]["source_item_id"], 249629);
        assert!(gear["head"].get("is_catalyst").is_none());
        assert!(gear["neck"].get("source_item_id").is_none());
    }
}

#[cfg(test)]
mod backfill_tests {
    use super::*;
    use crate::test_support::ensure_game_data_loaded;

    /// SimC omits a stat-less item from its gear report and mentions it nowhere
    /// else, so the profile we sent is the only record of it.
    const PROFILE: &str = "\
warlock=T
head=helm,id=250042,bonus_id=12849
trinket1=freightrunners_flask,id=250215
trinket2=mindpiercers_sigil,id=250224
off_hand=
";

    fn reported_only_two_slots() -> Value {
        json!({
            "equipped_gear": {
                "head": { "slot": "head", "item_id": 250042, "name": "Helm" },
                "trinket1": { "slot": "trinket1", "item_id": 250215, "name": "Flask" }
            }
        })
    }

    #[test]
    fn fills_a_slot_simc_left_out_of_its_gear_report() {
        ensure_game_data_loaded();
        let mut parsed = reported_only_two_slots();
        backfill_equipped_gear(&mut parsed, PROFILE);

        let sigil = &parsed["equipped_gear"]["trinket2"];
        assert_eq!(sigil["item_id"], 250224);
        assert_eq!(sigil["slot"], "trinket2");
        assert_eq!(sigil["name"], "Mindpiercers Sigil");
        assert_eq!(sigil["is_kept"], true);
        // The profile carries no ilevel=, so the item DB supplies it.
        assert!(sigil["ilevel"].as_u64().unwrap_or(0) > 0);
    }

    #[test]
    fn never_overwrites_a_slot_simc_did_report() {
        ensure_game_data_loaded();
        let mut parsed = reported_only_two_slots();
        backfill_equipped_gear(&mut parsed, PROFILE);
        assert_eq!(parsed["equipped_gear"]["trinket1"]["name"], "Flask");
        assert_eq!(parsed["equipped_gear"]["head"]["name"], "Helm");
    }

    #[test]
    fn an_empty_slot_line_adds_nothing() {
        ensure_game_data_loaded();
        let mut parsed = reported_only_two_slots();
        backfill_equipped_gear(&mut parsed, PROFILE);
        assert!(parsed["equipped_gear"].get("off_hand").is_none());
    }

    #[test]
    fn builds_the_map_when_the_result_has_no_gear_at_all() {
        ensure_game_data_loaded();
        let mut parsed = json!({});
        backfill_equipped_gear(&mut parsed, PROFILE);
        let gear = parsed["equipped_gear"].as_object().expect("gear map");
        assert_eq!(
            gear.len(),
            3,
            "head + both trinkets, never the empty off_hand"
        );
    }

    /// Bonus ids, enchants and gems have to survive, or the restored tile would
    /// show the wrong item level and no gems.
    #[test]
    fn carries_bonus_enchant_and_gem_detail_across() {
        ensure_game_data_loaded();
        let mut parsed = json!({ "equipped_gear": {} });
        backfill_equipped_gear(
            &mut parsed,
            "neck=amulet,id=100,bonus_id=12/34,enchant_id=7364,gem_id=213743/213743,ilevel=678\n",
        );
        let neck = &parsed["equipped_gear"]["neck"];
        assert_eq!(neck["ilevel"], 678);
        assert_eq!(neck["bonus_ids"], json!([12, 34]));
        assert_eq!(neck["enchant_id"], 7364);
        assert_eq!(neck["gem_ids"], json!([213743, 213743]));
        assert_eq!(neck["gem_id"], 213743);
    }

    /// The generated input carries a combo's gear on `profileset."x"+=` lines and
    /// user edits on `# manual.` comments. Only the character's own gear lines,
    /// which start at column zero, describe what was equipped.
    #[test]
    fn ignores_profileset_and_comment_lines() {
        ensure_game_data_loaded();
        let mut parsed = json!({ "equipped_gear": {} });
        backfill_equipped_gear(
            &mut parsed,
            "trinket2=mindpiercers_sigil,id=250224\n\
             profileset.\"A\"+=trinket1=,id=999999\n\
             # manual.feet=,id=888888\n",
        );
        let gear = parsed["equipped_gear"].as_object().expect("gear map");
        // Each ignored line names a slot nothing else fills, so a false match
        // here cannot be masked by a later real line.
        assert_eq!(gear.len(), 1, "only the real gear line: {gear:?}");
        assert_eq!(gear["trinket2"]["item_id"], 250224);
    }

    /// Re-running one Top Gear row appends the combo's overrides to the original
    /// profile, so a two-hander emits `off_hand=,` after the original off-hand.
    /// SimC leaves the slot empty and the backfill must not put it back.
    #[test]
    fn an_override_that_empties_a_slot_beats_the_earlier_line() {
        ensure_game_data_loaded();
        let mut parsed = json!({ "equipped_gear": {} });
        backfill_equipped_gear(&mut parsed, "off_hand=shield,id=250215\noff_hand=,\n");
        assert!(
            parsed["equipped_gear"].get("off_hand").is_none(),
            "the cleared slot must stay empty: {:?}",
            parsed["equipped_gear"]
        );
    }

    #[test]
    fn a_later_override_for_the_same_slot_wins() {
        ensure_game_data_loaded();
        let mut parsed = json!({ "equipped_gear": {} });
        backfill_equipped_gear(&mut parsed, "trinket2=,id=250215\ntrinket2=,id=250224\n");
        assert_eq!(parsed["equipped_gear"]["trinket2"]["item_id"], 250224);
    }

    /// `parse_simc_result` reports players[0]; raw input can declare more actors
    /// and their gear must not leak into the first one's set.
    #[test]
    fn stops_at_the_second_actor() {
        ensure_game_data_loaded();
        let mut parsed = json!({ "equipped_gear": {} });
        backfill_equipped_gear(
            &mut parsed,
            "warlock=\"A\"\n\
             trinket2=mindpiercers_sigil,id=250224\n\
             mage=\"B\"\n\
             head=,id=250042\n",
        );
        let gear = parsed["equipped_gear"].as_object().expect("gear map");
        assert_eq!(gear.len(), 1, "only actor A's gear: {gear:?}");
        assert_eq!(gear["trinket2"]["item_id"], 250224);
    }

    /// An armory export omits `ilevel=` when the bonus ids already imply it.
    #[test]
    fn resolves_the_item_level_from_the_bonus_ids() {
        ensure_game_data_loaded();
        let mut parsed = json!({ "equipped_gear": {} });
        backfill_equipped_gear(&mut parsed, "trinket2=,id=250224,bonus_id=12849\n");

        let upgraded = crate::item_db::get_item_info(250224, Some(&[12849]))
            .map(|i| i.ilevel)
            .unwrap_or(0);
        let base = crate::item_db::get_item_info(250224, None)
            .map(|i| i.ilevel)
            .unwrap_or(0);
        assert!(upgraded > base, "fixture must actually upgrade the item");
        assert_eq!(parsed["equipped_gear"]["trinket2"]["ilevel"], upgraded);
    }
}
