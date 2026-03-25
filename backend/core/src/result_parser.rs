use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::types::class_data::title_case;

fn extract_version(raw: &Value) -> String {
    let version = raw.get("version").and_then(|v| v.as_str()).unwrap_or("");
    let git_rev = raw.get("git_revision").and_then(|v| v.as_str()).unwrap_or("");
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

/// Extract ability stats from a player or pet stats array into the abilities list.
/// If `pet_name` is Some, abilities are prefixed with the pet name.
fn extract_stats_into(abilities: &mut Vec<Value>, stats: Option<&Value>, pet_name: Option<&str>) {
    let stats = match stats.and_then(|s| s.as_array()) {
        Some(s) => s,
        None => return,
    };
    for stat in stats {
        let raw_name = stat.get("name").and_then(|n| n.as_str()).unwrap_or("");
        let dps_contribution = if let Some(portion_aps) = stat.get("portion_aps") {
            if let Some(obj) = portion_aps.as_object() {
                obj.get("mean").and_then(|m| m.as_f64()).unwrap_or(0.0)
            } else {
                portion_aps.as_f64().unwrap_or(0.0)
            }
        } else {
            0.0
        };
        let school = stat
            .get("school")
            .and_then(|s| s.as_str())
            .unwrap_or("physical");

        if !raw_name.is_empty() && dps_contribution > 0.0 {
            let display_name = match pet_name {
                Some(pn) => format!("{}: {}", title_case(&pn.replace('_', " ")), raw_name),
                None => raw_name.to_string(),
            };
            let spell_id = stat.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
            let mut ability = json!({
                "name": display_name,
                "portion_dps": round1(dps_contribution),
                "school": school,
            });
            if spell_id > 0 {
                ability["spell_id"] = json!(spell_id);
            }
            if spell_id == 0 {
                if let Some(children) = stat.get("children").and_then(|c| c.as_array()) {
                    if let Some(child) = children.first() {
                        let child_id = child.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                        if child_id > 0 {
                            ability["spell_id"] = json!(child_id);
                        }
                    }
                }
            }
            abilities.push(ability);
        }
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
    let dps_error = dps_data
        .get("mean_std_dev")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

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
    let target_error = sim
        .get("options")
        .and_then(|o| o.get("target_error"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let error_pct = if dps_mean > 0.0 { (dps_error / dps_mean) * 100.0 } else { 0.0 };

    let mut result = json!({
        "player_name": player.get("name").and_then(|n| n.as_str()).unwrap_or("Unknown"),
        "player_class": player.get("specialization")
            .or_else(|| player.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown"),
        "dps": round1(dps_mean),
        "dps_error": round1(dps_error),
        "dps_error_pct": round2(error_pct),
        "fight_length": round1(fight_length),
        "iterations": total_iterations,
        "elapsed_time_seconds": round2(elapsed_time),
        "target_error": target_error,
        "simc_version": extract_version(raw),
        "simc_git_revision": raw.get("git_revision").and_then(|v| v.as_str()).unwrap_or(""),
    });

    // Ability breakdown (player + pets)
    let mut abilities: Vec<Value> = Vec::new();
    extract_stats_into(&mut abilities, player.get("stats"), None);

    // Pet abilities (simc stores these as stats_pets: { pet_name: [stats...] })
    if let Some(stats_pets) = player.get("stats_pets").and_then(|p| p.as_object()) {
        for (pet_name, pet_stats) in stats_pets {
            extract_stats_into(&mut abilities, Some(pet_stats), Some(pet_name));
        }
    }

    if !abilities.is_empty() {
        abilities.sort_by(|a, b| {
            let a_dps = a["portion_dps"].as_f64().unwrap_or(0.0);
            let b_dps = b["portion_dps"].as_f64().unwrap_or(0.0);
            b_dps.partial_cmp(&a_dps).unwrap_or(std::cmp::Ordering::Equal)
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
            stat_weights.sort_by(|a, b| {
                b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal)
            });
            let mut map = serde_json::Map::new();
            for (k, v) in stat_weights {
                map.insert(k, json!(v));
            }
            result["stat_weights"] = Value::Object(map);
        }
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

    let id_re = Regex::new(r"id=(\d+)").unwrap();
    let ilvl_re = Regex::new(r"ilevel=(\d+)").unwrap();
    let bonus_re = Regex::new(r"bonus_id=([0-9/:]+)").unwrap();
    let enchant_re = Regex::new(r"enchant_id=(\d+)").unwrap();
    let gem_re = Regex::new(r"gem_id=(\d+)").unwrap();

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

        let item_id: u64 = id_re
            .captures(encoded)
            .and_then(|c| c[1].parse().ok())
            .unwrap_or(0);

        let mut ilevel: u64 = ilvl_re
            .captures(encoded)
            .and_then(|c| c[1].parse().ok())
            .unwrap_or(0);

        if ilevel == 0 {
            ilevel = data
                .get("ilevel")
                .and_then(|i| i.as_u64())
                .unwrap_or(0);
        }

        let bonus_ids: Vec<u64> = bonus_re
            .captures(encoded)
            .map(|c| {
                c[1].split(&['/', ':'][..])
                    .filter_map(|s| s.parse().ok())
                    .collect()
            })
            .unwrap_or_default();

        let enchant_id: u64 = enchant_re
            .captures(encoded)
            .and_then(|c| c[1].parse().ok())
            .unwrap_or(0);

        let gem_id: u64 = gem_re
            .captures(encoded)
            .and_then(|c| c[1].parse().ok())
            .unwrap_or(0);

        let name = data
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .replace('_', " ");
        let name = title_case(&name);

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
        let combo_name = ps
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("Unknown");

        let items = combo_metadata
            .get(combo_name)
            .cloned()
            .unwrap_or_default();

        results.push(json!({
            "name": combo_name,
            "items": items,
            "dps": round1(mean_dps),
            "delta": round1(mean_dps - base_dps),
        }));
    }

    // Add the base (equipped) profile
    let baseline_items = combo_metadata
        .get("Currently Equipped")
        .cloned()
        .unwrap_or_default();

    let baseline_items = if baseline_items.is_empty() {
        let all_gear = extract_all_gear(player);
        ["finger1", "finger2", "trinket1", "trinket2"]
            .iter()
            .filter_map(|s| all_gear.get(*s).cloned())
            .collect::<Vec<_>>()
    } else {
        baseline_items
    };

    results.push(json!({
        "name": "Currently Equipped",
        "items": baseline_items,
        "dps": round1(base_dps),
        "delta": 0,
    }));

    results.sort_by(|a, b| {
        let a_dps = a["dps"].as_f64().unwrap_or(0.0);
        let b_dps = b["dps"].as_f64().unwrap_or(0.0);
        b_dps.partial_cmp(&a_dps).unwrap_or(std::cmp::Ordering::Equal)
    });

    // Extract full equipped gear for gear overview
    let all_gear = extract_all_gear(player);
    let equipped_gear: serde_json::Map<String, Value> = all_gear.into_iter().collect();

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
    let target_error = sim
        .get("options")
        .and_then(|o| o.get("target_error"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let dps_error = collected
        .get("dps")
        .and_then(|d| d.get("mean_std_dev"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let error_pct = if base_dps > 0.0 { (dps_error / base_dps) * 100.0 } else { 0.0 };

    json!({
        "type": "top_gear",
        "base_dps": round1(base_dps),
        "dps_error": round1(dps_error),
        "dps_error_pct": round2(error_pct),
        "iterations": total_iterations,
        "elapsed_time_seconds": round2(elapsed_time),
        "target_error": target_error,
        "player_name": player.get("name").and_then(|n| n.as_str()).unwrap_or("Unknown"),
        "player_class": player.get("specialization")
            .or_else(|| player.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown"),
        "simc_version": extract_version(raw),
        "results": results,
        "equipped_gear": Value::Object(equipped_gear),
    })
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
