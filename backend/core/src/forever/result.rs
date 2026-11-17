//! Engine RaidSimResult / BulkSimResult to the result shapes the result pages already render.

use serde_json::{json, Map, Value};

use super::data::ForeverData;
use super::spec::{spec_label, SLOT_NAMES};

pub struct ResultMeta {
    pub player_name: String,
    pub spec_key: String,
    pub fight_length: f64,
    pub iterations: u32,
    pub engine_commit: String,
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// 95% confidence half-width, as retail's dps_error.
fn error95(stdev: f64, n: f64) -> f64 {
    if n > 0.0 {
        1.96 * stdev / n.sqrt()
    } else {
        0.0
    }
}

pub fn engine_error(raw: &Value) -> Option<String> {
    raw.get("error")
        .and_then(|e| e.get("message"))
        .and_then(Value::as_str)
        .filter(|m| !m.is_empty())
        .map(str::to_string)
}

fn action_name(id: &Value, data: &ForeverData) -> String {
    if let Some(spell) = id.get("spellId").and_then(Value::as_u64) {
        return data
            .spells
            .get(&(spell as u32))
            .cloned()
            .unwrap_or_else(|| format!("Spell {spell}"));
    }
    if let Some(item) = id.get("itemId").and_then(Value::as_u64) {
        return data
            .items
            .get(&(item as u32))
            .map(|i| i.name.clone())
            .unwrap_or_else(|| format!("Item {item}"));
    }
    match id.get("otherId").and_then(Value::as_str) {
        Some(other) => other.trim_start_matches("OtherAction").to_string(),
        None => "Unknown".into(),
    }
}

/// The icon of an action: its spell's or item's, or a stock one for a weapon swing or shot.
fn action_icon(id: &Value, data: &ForeverData) -> Option<String> {
    if let Some(spell) = id.get("spellId").and_then(Value::as_u64) {
        return data.spell_icons.get(&(spell as u32)).cloned();
    }
    if let Some(item) = id.get("itemId").and_then(Value::as_u64) {
        return data
            .items
            .get(&(item as u32))
            .map(|i| i.icon.clone())
            .filter(|icon| !icon.is_empty());
    }
    Some(
        match id.get("otherId").and_then(Value::as_str)? {
            "OtherActionShoot" => "ability_marksmanship",
            "OtherActionAttack" => "ability_meleedamage",
            _ => return None,
        }
        .to_string(),
    )
}

/// "hps" for a healer, else "dps": the unit metric and the ability rows follow it.
fn metric_of(spec_key: &str) -> &'static str {
    if super::spec::is_healer(spec_key) {
        "hps"
    } else {
        "dps"
    }
}

/// An action's damage, or for a healer its healing and absorbs.
fn action_amount(action: &Value, metric: &str) -> f64 {
    let fields: &[&str] = if metric == "hps" {
        &["healing", "shielding"]
    } else {
        &["damage"]
    };
    action["targets"]
        .as_array()
        .map(|ts| {
            ts.iter()
                .flat_map(|t| fields.iter().filter_map(|f| t[*f].as_f64()))
                .sum()
        })
        .unwrap_or(0.0)
}

/// One row per action, damage share of `unit_dps`; ranks of one spell merge into one row.
fn unit_abilities(unit: &Value, unit_dps: f64, metric: &str, data: &ForeverData) -> Vec<Value> {
    let action_damage = |a: &Value| action_amount(a, metric);
    let actions = unit["actions"].as_array().cloned().unwrap_or_default();
    let total: f64 = actions.iter().map(&action_damage).sum();
    if total <= 0.0 {
        return Vec::new();
    }
    let mut rows: Vec<(String, Option<Value>, Option<String>, f64)> = Vec::new();
    for a in actions.iter().filter(|a| action_damage(a) > 0.0) {
        let name = action_name(&a["id"], data);
        let share = unit_dps * action_damage(a) / total;
        match rows.iter_mut().find(|(n, ..)| *n == name) {
            Some(row) => row.3 += share,
            None => rows.push((
                name,
                a["id"].get("spellId").cloned(),
                action_icon(&a["id"], data),
                share,
            )),
        }
    }
    rows.sort_by(|a, b| b.3.total_cmp(&a.3));
    rows.into_iter()
        .map(|(name, spell_id, icon, dps)| {
            let mut row = json!({ "name": name, "portion_dps": round1(dps), "school": "" });
            if let Some(id) = spell_id {
                row["spell_id"] = id;
            }
            if let Some(icon) = icon {
                row["icon"] = json!(icon);
            }
            row
        })
        .collect()
}

pub fn quick_result(raw: &Value, data: &ForeverData, meta: &ResultMeta) -> Value {
    let metric = metric_of(&meta.spec_key);
    let unit = &raw["raidMetrics"]["parties"][0]["players"][0];
    let dps = unit[metric]["avg"].as_f64().unwrap_or(0.0);
    let n = raw["iterationsDone"]
        .as_f64()
        .filter(|n| *n > 0.0)
        .unwrap_or(meta.iterations as f64);
    let err = error95(unit[metric]["stdev"].as_f64().unwrap_or(0.0), n);
    let pets = unit["pets"].as_array().cloned().unwrap_or_default();
    let pet_dps: f64 = pets.iter().filter_map(|p| p[metric]["avg"].as_f64()).sum();
    let mut abilities = unit_abilities(unit, dps - pet_dps, metric, data);
    for pet in &pets {
        let pd = pet[metric]["avg"].as_f64().unwrap_or(0.0);
        if pd > 0.0 {
            abilities.push(json!({
                "name": pet["name"].as_str().unwrap_or("Pet"),
                "icon": "ability_hunter_beastcall",
                "portion_dps": round1(pd),
                "school": "",
                "children": unit_abilities(pet, pd, metric, data),
            }));
        }
    }
    abilities.sort_by(|a, b| {
        b["portion_dps"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["portion_dps"].as_f64().unwrap_or(0.0))
    });
    let fight_length = raw["avgIterationDuration"]
        .as_f64()
        .filter(|d| *d > 0.0)
        .unwrap_or(meta.fight_length);
    json!({
        "player_name": meta.player_name,
        "player_class": spec_label(&meta.spec_key),
        "dps": round1(dps),
        "dps_error": round1(err),
        "dps_error_pct": if dps > 0.0 { round2(err / dps * 100.0) } else { 0.0 },
        "fight_length": round1(fight_length),
        "desired_targets": 1,
        "iterations": n as u64,
        "abilities": abilities,
        "metric": metric,
        "setup": null,
        "engine": "forever",
        "engine_version": meta.engine_commit,
    })
}

fn gear_entry(slot: usize, spec: &Value, data: &ForeverData, kept: bool) -> Value {
    let id = spec["id"].as_u64().unwrap_or(0) as u32;
    let known = data.items.get(&id);
    json!({
        "slot": SLOT_NAMES[slot],
        "item_id": id,
        "ilevel": known.map(|i| i.ilvl).unwrap_or(0),
        "name": known.map(|i| i.name.clone()).unwrap_or_else(|| format!("Item {id}")),
        "icon": known.map(|i| i.icon.clone()).unwrap_or_default(),
        "quality": known.map(|i| i.quality).unwrap_or(1),
        "bonus_ids": [],
        "enchant_id": spec["enchant"].as_u64().unwrap_or(0),
        "gem_id": 0,
        "is_kept": kept,
        "origin": if kept { "equipped" } else { "bags" },
    })
}

fn item_key(spec: &Value) -> (u64, u64) {
    (
        spec["id"].as_u64().unwrap_or(0),
        spec["enchant"].as_u64().unwrap_or(0),
    )
}

fn gear_items(gear: &Value) -> Vec<Value> {
    gear["items"].as_array().cloned().unwrap_or_default()
}

fn metrics_n(metrics: &Value, fallback: u32) -> f64 {
    metrics["aggregatorData"]["n"]
        .as_f64()
        .filter(|n| *n > 0.0)
        .unwrap_or(fallback as f64)
}

fn precision_pct(metrics: &Value, fallback_n: u32) -> f64 {
    let avg = metrics["avg"].as_f64().unwrap_or(0.0);
    if avg <= 0.0 {
        return 0.0;
    }
    round2(
        error95(
            metrics["stdev"].as_f64().unwrap_or(0.0),
            metrics_n(metrics, fallback_n),
        ) / avg
            * 100.0,
    )
}

pub fn gear_result(raw: &Value, data: &ForeverData, meta: &ResultMeta) -> Value {
    let baseline = &raw["baseline"];
    let base_metrics = &baseline["dpsMetrics"];
    let base_dps = base_metrics["avg"].as_f64().unwrap_or(0.0);
    let base_gear = gear_items(&baseline["gear"]);
    let base_keys: Vec<(u64, u64)> = base_gear
        .iter()
        .filter(|s| s["id"].as_u64().unwrap_or(0) > 0)
        .map(item_key)
        .collect();
    let mut equipped = Map::new();
    for (slot, spec) in base_gear.iter().enumerate().take(SLOT_NAMES.len()) {
        if spec["id"].as_u64().unwrap_or(0) > 0 {
            equipped.insert(
                SLOT_NAMES[slot].to_string(),
                gear_entry(slot, spec, data, true),
            );
        }
    }
    let mut results: Vec<Value> = raw["topResults"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .filter_map(|(i, r)| {
            // Changed = not among the baseline's items, wherever the engine slotted them.
            let mut kept = base_keys.clone();
            let changed: Vec<Value> = gear_items(&r["gear"])
                .iter()
                .enumerate()
                .take(SLOT_NAMES.len())
                .filter(|(_, spec)| spec["id"].as_u64().unwrap_or(0) > 0)
                .filter(
                    |(_, spec)| match kept.iter().position(|k| *k == item_key(spec)) {
                        Some(i) => {
                            kept.swap_remove(i);
                            false
                        }
                        None => true,
                    },
                )
                .map(|(slot, spec)| gear_entry(slot, spec, data, false))
                .collect();
            if changed.is_empty() {
                return None; // the baseline itself
            }
            let dps = r["dpsMetrics"]["avg"].as_f64().unwrap_or(0.0);
            Some(json!({
                "name": format!("Combo {}", i + 1),
                "items": changed,
                "dps": round1(dps),
                "delta": round1(dps - base_dps) + 0.0, // no -0.0
                "precision_pct": precision_pct(&r["dpsMetrics"], meta.iterations),
            }))
        })
        .collect();
    results.push(json!({
        "name": "Currently Equipped",
        "items": [],
        "dps": round1(base_dps),
        "delta": 0.0,
        "precision_pct": precision_pct(base_metrics, meta.iterations),
    }));
    results.sort_by(|a, b| {
        b["dps"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["dps"].as_f64().unwrap_or(0.0))
    });
    let base_err = error95(
        base_metrics["stdev"].as_f64().unwrap_or(0.0),
        metrics_n(base_metrics, meta.iterations),
    );
    json!({
        "type": "top_gear",
        "result_kind": "gear_comparison",
        "base_dps": round1(base_dps),
        "dps_error": round1(base_err),
        "dps_error_pct": if base_dps > 0.0 { round2(base_err / base_dps * 100.0) } else { 0.0 },
        "fight_length": meta.fight_length,
        "desired_targets": 1,
        "iterations": metrics_n(base_metrics, meta.iterations) as u64,
        "player_name": meta.player_name,
        "player_class": spec_label(&meta.spec_key),
        "results": results,
        "equipped_gear": equipped,
        "metric": metric_of(&meta.spec_key),
        "setup": null,
        "engine": "forever",
        "engine_version": meta.engine_commit,
    })
}

/// Talent builds ranked against the first one, in the gear comparison shape the result page shows.
pub fn compare_result(raw: &Value, meta: &ResultMeta) -> Result<Value, String> {
    let rows: Vec<&Value> = raw["results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|r| r["metrics"].is_object())
        .collect();
    let Some(base) = rows.first() else {
        let reason = raw["results"][0]["error"]
            .as_str()
            .unwrap_or("no build could be simmed");
        return Err(reason.to_string());
    };
    let base_metrics = &base["metrics"];
    let base_dps = base_metrics["avg"].as_f64().unwrap_or(0.0);
    let mut results: Vec<Value> = rows
        .iter()
        .map(|r| {
            let dps = r["metrics"]["avg"].as_f64().unwrap_or(0.0);
            json!({
                "name": r["name"],
                "items": [],
                "talents_string": r["talentsString"],
                "dps": round1(dps),
                "delta": round1(dps - base_dps) + 0.0,
                "precision_pct": precision_pct(&r["metrics"], meta.iterations),
            })
        })
        .collect();
    results.sort_by(|a, b| {
        b["dps"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["dps"].as_f64().unwrap_or(0.0))
    });
    let skipped: Vec<Value> = raw["results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|r| r["error"].is_string())
        .map(|r| json!({ "name": r["name"], "error": r["error"] }))
        .collect();
    let base_err = error95(
        base_metrics["stdev"].as_f64().unwrap_or(0.0),
        metrics_n(base_metrics, meta.iterations),
    );
    Ok(json!({
        "type": "talent_compare",
        "result_kind": "gear_comparison",
        "base_dps": round1(base_dps),
        "dps_error": round1(base_err),
        "dps_error_pct": if base_dps > 0.0 { round2(base_err / base_dps * 100.0) } else { 0.0 },
        "fight_length": meta.fight_length,
        "desired_targets": 1,
        "iterations": metrics_n(base_metrics, meta.iterations) as u64,
        "player_name": meta.player_name,
        "player_class": spec_label(&meta.spec_key),
        "results": results,
        "skipped": skipped,
        "equipped_gear": {},
        "metric": metric_of(&meta.spec_key),
        "setup": null,
        "engine": "forever",
        "engine_version": meta.engine_commit,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta() -> ResultMeta {
        ResultMeta {
            player_name: "Sylfrey".into(),
            spec_key: "retributionPaladin".into(),
            fight_length: 120.0,
            iterations: 200,
            engine_commit: "e3b44d0".into(),
        }
    }

    #[test]
    fn compare_ranks_builds_against_the_first_and_lists_the_refused() {
        let raw = json!({ "results": [
            { "name": "Current", "talentsString": "5", "metrics": { "avg": 500.0, "stdev": 20.0 } },
            { "name": "Deep", "talentsString": "55", "metrics": { "avg": 540.0, "stdev": 20.0 } },
            { "name": "Broken", "talentsString": "9", "error": "Redoubt has 5 ranks" },
        ]});
        let r = compare_result(&raw, &meta()).unwrap();
        assert_eq!(
            (&r["type"], &r["result_kind"]),
            (&json!("talent_compare"), &json!("gear_comparison"))
        );
        assert_eq!(r["base_dps"], 500.0);
        let rows = r["results"].as_array().unwrap();
        assert_eq!(
            (&rows[0]["name"], &rows[0]["delta"]),
            (&json!("Deep"), &json!(40.0))
        );
        assert_eq!(
            (&rows[1]["name"], &rows[1]["delta"]),
            (&json!("Current"), &json!(0.0))
        );
        assert_eq!(r["skipped"][0]["name"], "Broken");
        let none = compare_result(
            &json!({ "results": [{ "name": "x", "error": "boom" }] }),
            &meta(),
        );
        assert_eq!(none.unwrap_err(), "boom");
    }

    #[test]
    fn a_healer_reads_healing_and_absorbs() {
        let raw = json!({
            "iterationsDone": 100,
            "raidMetrics": { "parties": [{ "players": [{
                "dps": { "avg": 5.0, "stdev": 1.0 },
                "hps": { "avg": 300.0, "stdev": 10.0 },
                "actions": [
                    { "id": { "spellId": 1 }, "targets": [{ "damage": 99.0, "healing": 200.0, "shielding": 100.0 }] },
                ],
            }] }] },
        });
        let healer = ResultMeta {
            spec_key: "holyPaladin".into(),
            ..meta()
        };
        let r = quick_result(&raw, crate::forever::test_data(), &healer);
        assert_eq!((&r["metric"], &r["dps"]), (&json!("hps"), &json!(300.0)));
        assert_eq!(r["abilities"][0]["portion_dps"], 300.0);
        let damage = quick_result(&raw, crate::forever::test_data(), &meta());
        assert_eq!(
            (&damage["metric"], &damage["dps"]),
            (&json!("dps"), &json!(5.0))
        );
    }

    #[test]
    fn quick_result_matches_the_single_actor_shape() {
        let raw: Value = serde_json::from_str(include_str!("testdata/raid_result.json")).unwrap();
        let r = quick_result(&raw, crate::forever::test_data(), &meta());
        let dps = r["dps"].as_f64().unwrap();
        assert!(dps > 0.0);
        let stdev = raw["raidMetrics"]["parties"][0]["players"][0]["dps"]["stdev"]
            .as_f64()
            .unwrap();
        let n = raw["iterationsDone"].as_f64().unwrap();
        assert!(
            (r["dps_error"].as_f64().unwrap() - (1.96 * stdev / n.sqrt() * 10.0).round() / 10.0)
                .abs()
                < 0.11
        );
        assert_eq!(r["player_name"], "Sylfrey");
        assert_eq!(r["player_class"], "Retribution Paladin");
        assert_eq!(r["engine"], "forever");
        assert!(r["setup"].is_null());
        let abilities = r["abilities"].as_array().unwrap();
        let total: f64 = abilities
            .iter()
            .map(|a| a["portion_dps"].as_f64().unwrap())
            .sum();
        assert!((total - dps).abs() / dps < 0.01, "abilities sum to dps");
        assert!(abilities
            .iter()
            .all(|a| !a["name"].as_str().unwrap().is_empty()));
    }

    #[test]
    fn gear_result_rows_are_sorted_with_the_baseline_among_them() {
        let raw: Value = serde_json::from_str(include_str!("testdata/bulk_result.json")).unwrap();
        let r = gear_result(&raw, crate::forever::test_data(), &meta());
        assert_eq!(r["result_kind"], "gear_comparison");
        assert_eq!(r["type"], "top_gear");
        let results = r["results"].as_array().unwrap();
        assert!(results
            .iter()
            .any(|row| row["name"] == "Currently Equipped" && row["delta"] == 0.0));
        let dps: Vec<f64> = results
            .iter()
            .map(|row| row["dps"].as_f64().unwrap())
            .collect();
        assert!(
            dps.windows(2).all(|w| w[0] >= w[1]),
            "sorted by dps: {dps:?}"
        );
        let base = r["base_dps"].as_f64().unwrap();
        for row in results {
            assert!(
                (row["delta"].as_f64().unwrap() - (row["dps"].as_f64().unwrap() - base)).abs()
                    < 0.11
            );
            for item in row["items"].as_array().unwrap() {
                assert!(item["quality"].is_u64() && item["icon"].is_string());
            }
        }
        assert!(r["equipped_gear"].is_object());
    }

    #[test]
    fn items_kept_from_the_baseline_are_not_changes() {
        // The engine re-slots the baseline (this fixture's libram sits in main_hand); a combo of
        // baseline items in other slots is the baseline, and kept items never show as changed.
        let raw: Value = serde_json::from_str(include_str!("testdata/bulk_result.json")).unwrap();
        let r = gear_result(&raw, crate::forever::test_data(), &meta());
        let results = r["results"].as_array().unwrap();
        assert_eq!(
            results
                .iter()
                .filter(|row| row["items"].as_array().unwrap().is_empty())
                .count(),
            1
        );
        for row in results {
            assert!(
                row["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|i| i["item_id"] != 22400),
                "{row}"
            );
            assert_ne!(row["delta"].to_string(), "-0.0");
        }
    }

    #[test]
    fn abilities_and_pet_abilities_have_names() {
        let raw: Value = serde_json::from_str(include_str!("testdata/raid_result.json")).unwrap();
        let r = quick_result(&raw, crate::forever::test_data(), &meta());
        let mut names = Vec::new();
        for a in r["abilities"].as_array().unwrap() {
            names.push(a["name"].as_str().unwrap().to_string());
            for c in a["children"].as_array().into_iter().flatten() {
                names.push(c["name"].as_str().unwrap().to_string());
            }
        }
        assert!(names.iter().all(|n| !n.starts_with("Spell ")), "{names:?}");
    }

    #[test]
    fn engine_error_result_is_an_error() {
        let raw = serde_json::json!({ "error": { "message": "boom" } });
        assert_eq!(engine_error(&raw).as_deref(), Some("boom"));
        assert_eq!(engine_error(&serde_json::json!({ "error": null })), None);
    }
}
