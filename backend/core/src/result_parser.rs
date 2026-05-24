use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;

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
    // Achieved 95% CI half-width as a percent of the mean (matches the
    // semantics of the user's `target_error` input). When simc hits target
    // this equals target_error; when it undershoots (iteration budget), the
    // displayed number is honestly larger. Same formula as the per-row badges
    // so the hero card and the rows agree.
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

fn extract_all_gear(player: &Value) -> HashMap<String, Value> {
    let empty = json!({});
    let gear = player.get("gear").unwrap_or(&empty);
    let gear_obj = match gear.as_object() {
        Some(o) => o,
        None => return HashMap::new(),
    };

    let ilvl_re = Regex::new(r"ilevel=(\d+)").unwrap();

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

        let item_id = crate::simc_string::extract_item_id(encoded);

        let mut ilevel: u64 = ilvl_re
            .captures(encoded)
            .and_then(|c| c[1].parse().ok())
            .unwrap_or(0);

        if ilevel == 0 {
            ilevel = data.get("ilevel").and_then(|i| i.as_u64()).unwrap_or(0);
        }

        let bonus_ids = crate::simc_string::extract_bonus_ids(encoded);
        let enchant_id = crate::simc_string::extract_enchant_id(encoded);
        let gem_ids: Vec<u64> = crate::simc_string::extract_gem_ids(encoded)
            .into_iter()
            .filter(|&id| id > 0)
            .collect();
        let gem_id: u64 = gem_ids.first().copied().unwrap_or(0);

        let name = data
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .replace('_', " ");
        let name = title_case(&name);

        let sockets = crate::item_db::get_item_info(item_id, Some(&bonus_ids))
            .map(|info| info.sockets)
            .unwrap_or(0);

        baseline.insert(
            slot.clone(),
            json!({
                "slot": &slot,
                "item_id": item_id,
                "ilevel": ilevel,
                "name": name,
                "bonus_ids": bonus_ids,
                "enchant_id": enchant_id,
                "gem_id": gem_id,
                "gem_ids": gem_ids,
                "sockets": sockets,
                "is_kept": true,
            }),
        );
    }

    baseline
}

/// Extract profileset results from simc JSON output for Top Gear.
pub fn parse_top_gear_result(
    raw: &Value,
    combo_metadata: Option<&HashMap<String, Vec<Value>>>,
) -> Value {
    let empty_meta = HashMap::new();
    let combo_metadata = combo_metadata.unwrap_or(&empty_meta);

    let empty = json!({});
    let sim = raw.get("sim").unwrap_or(&empty);
    let players = sim.get("players").and_then(|p| p.as_array());

    let players = match players {
        Some(p) if !p.is_empty() => p,
        _ => return json!({"type": "top_gear", "error": "No player data found"}),
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
    let fight_length = statistics
        .get("simulation_length")
        .and_then(|sl| sl.get("mean"))
        .and_then(|m| m.as_f64())
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

    json!({
        "type": "top_gear",
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
    })
}

/// 95% CI half-width as a percent of the mean, read from a simc result block
/// that carries a `mean_std_dev` field (works for both player.collected_data.dps
/// and individual profileset entries — same shape). Returns `None` when the
/// input lacks the field or the mean is zero.
fn precision_pct_from_simc(block: &Value, mean: f64) -> Option<f64> {
    if mean <= 0.0 {
        return None;
    }
    let mean_std_dev = block.get("mean_std_dev").and_then(|v| v.as_f64())?;
    Some(1.96 * mean_std_dev / mean * 100.0)
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
