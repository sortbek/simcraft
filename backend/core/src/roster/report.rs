use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// Per-member identity passed in by the caller (from the roster).
#[derive(Debug, Clone)]
pub struct MemberMeta {
    pub member_id: String,
    pub name: String,
    pub class: String,
    pub spec: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerEntry {
    pub member_id: String,
    pub name: String,
    pub class: String,
    pub spec: String,
    pub base_dps: f64,
    pub status: String, // "ok" | "sim_failed"
    /// Absent on "ok" members and on reports cached before reasons existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemResult {
    pub member_id: String,
    pub dps: f64,
    pub upgrade_pct: f64,
    pub abs_gain: f64,
    pub is_downgrade: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemEntry {
    /// Variant-aware identity (item_id + Void Forged / Catalyst marker). A Void
    /// Forged item shares its base item's `item_id`, so the report keys on this
    /// instead to keep the two rows distinct.
    pub uid: String,
    pub boss: String,
    pub item_id: u64,
    pub name: String,
    pub slot: String,
    pub ilevel: u64,
    #[serde(default)]
    pub is_void_forge: bool,
    #[serde(default)]
    pub is_catalyst: bool,
    pub results: Vec<ItemResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RosterReport {
    pub roster_id: String,
    pub instance_id: i64,
    pub difficulty: String,
    pub players: Vec<PlayerEntry>,
    pub items: Vec<ItemEntry>,
}

/// Item metadata captured the first time an item_id is seen, plus the best combo
/// (max delta) recorded per member.
struct ItemAccum {
    item_id: u64,
    boss: String,
    name: String,
    slot: String,
    ilevel: u64,
    is_void_forge: bool,
    is_catalyst: bool,
    /// member_id -> (dps, delta) of that member's best combo for this item.
    best: HashMap<String, (f64, f64)>,
    /// first-seen order of items, tracked by the caller (see aggregate_report).
    order: usize,
}

/// Aggregate per-member droptimizer results into the pivoted report.
/// Each input is (member, Some(result_json), None) or (member, None, why) when
/// that member's sim failed / was skipped — `why` is the caller's reason, if it
/// knows one. For each item, keep each member's BEST combo (max delta), then
/// rank members within the item by upgrade_pct descending.
pub fn aggregate_report(
    roster_id: &str,
    instance_id: i64,
    difficulty: &str,
    inputs: &[(MemberMeta, Option<Value>, Option<String>)],
) -> RosterReport {
    let mut players: Vec<PlayerEntry> = Vec::with_capacity(inputs.len());
    let mut items: HashMap<String, ItemAccum> = HashMap::new();
    let mut next_order: usize = 0;

    for (member, result, why) in inputs {
        let base = result
            .as_ref()
            .and_then(|r| r.get("base_dps"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        // A member is "ok" only when we have a result with a usable base DPS.
        // base <= 0.0 means we cannot compute upgrade percentages, so we treat
        // the member as failed and skip their combos.
        let ok = result.is_some() && base > 0.0;

        // Never leave a failed member without an explanation.
        let error = if ok {
            None
        } else {
            why.clone().or_else(|| {
                Some(if result.is_none() {
                    "Sim produced no result.".into()
                } else {
                    "Sim returned no baseline DPS.".into()
                })
            })
        };

        players.push(PlayerEntry {
            member_id: member.member_id.clone(),
            name: member.name.clone(),
            class: member.class.clone(),
            spec: member.spec.clone(),
            base_dps: if ok { base } else { 0.0 },
            status: if ok { "ok".into() } else { "sim_failed".into() },
            error,
        });

        if !ok {
            continue;
        }

        let combos = result
            .as_ref()
            .and_then(|r| r.get("results"))
            .and_then(|v| v.as_array());
        let Some(combos) = combos else { continue };

        for combo in combos {
            // Skip the "Currently Equipped" baseline — parse_gear_comparison_result
            // pushes it into `results[]`, but its items are the player's equipped
            // gear, not a dropped item, so it must not appear in the loot report.
            let combo_name = combo.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if combo_name.starts_with("Currently Equipped") {
                continue;
            }
            let Some(item) = combo
                .get("items")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
            else {
                continue;
            };
            let Some(item_id) = item.get("item_id").and_then(|v| v.as_u64()) else {
                continue;
            };
            let delta = combo.get("delta").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let dps = combo.get("dps").and_then(|v| v.as_f64()).unwrap_or(0.0);

            // A Void Forged variant keeps the base item_id, so key on a variant-aware
            // uid (mirrors the frontend `dropUid`) to keep base/variant rows distinct.
            let is_void_forge = item
                .get("is_void_forge")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let is_catalyst = item
                .get("is_catalyst")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let uid = if is_void_forge {
                format!("{item_id}:vf")
            } else if is_catalyst {
                let source = item
                    .get("source_item_id")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                format!("{item_id}:cat:{source}")
            } else {
                item_id.to_string()
            };

            let accum = items.entry(uid).or_insert_with(|| {
                let order = next_order;
                next_order += 1;
                ItemAccum {
                    item_id,
                    boss: item
                        .get("encounter")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    name: item
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    slot: item
                        .get("slot")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    ilevel: item.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0),
                    is_void_forge,
                    is_catalyst,
                    best: HashMap::new(),
                    order,
                }
            });

            accum
                .best
                .entry(member.member_id.clone())
                .and_modify(|cur| {
                    if delta > cur.1 {
                        *cur = (dps, delta);
                    }
                })
                .or_insert((dps, delta));
        }
    }

    // Build a member_id -> base_dps map for upgrade_pct computation at flatten time.
    let member_base: HashMap<String, f64> = players
        .iter()
        .filter(|p| p.status == "ok")
        .map(|p| (p.member_id.clone(), p.base_dps))
        .collect();

    // Flatten accumulators into ItemEntry list.
    let mut item_entries: Vec<(usize, ItemEntry)> = items
        .into_iter()
        .map(|(uid, accum)| {
            let mut results: Vec<ItemResult> = accum
                .best
                .iter()
                .map(|(member_id, (dps, delta))| {
                    let base = member_base.get(member_id.as_str()).copied().unwrap_or(0.0);
                    let upgrade_pct = if base > 0.0 {
                        delta / base * 100.0
                    } else {
                        0.0
                    };
                    ItemResult {
                        member_id: member_id.clone(),
                        dps: *dps,
                        upgrade_pct,
                        abs_gain: *delta,
                        is_downgrade: *delta < 0.0,
                    }
                })
                .collect();

            // Rank members within the item by upgrade_pct desc; tie-break by member_id.
            results.sort_by(|a, b| {
                b.upgrade_pct
                    .partial_cmp(&a.upgrade_pct)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.member_id.cmp(&b.member_id))
            });

            (
                accum.order,
                ItemEntry {
                    uid,
                    boss: accum.boss,
                    item_id: accum.item_id,
                    name: accum.name,
                    slot: accum.slot,
                    ilevel: accum.ilevel,
                    is_void_forge: accum.is_void_forge,
                    is_catalyst: accum.is_catalyst,
                    results,
                },
            )
        })
        .collect();

    // Deterministic item ordering: by boss, then name (tie-break by first-seen order).
    item_entries.sort_by(|(ord_a, a), (ord_b, b)| {
        a.boss
            .cmp(&b.boss)
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| ord_a.cmp(ord_b))
    });

    let items = item_entries.into_iter().map(|(_, e)| e).collect();

    RosterReport {
        roster_id: roster_id.to_string(),
        instance_id,
        difficulty: difficulty.to_string(),
        players,
        items,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn member(id: &str, name: &str) -> MemberMeta {
        MemberMeta {
            member_id: id.into(),
            name: name.into(),
            class: "mage".into(),
            spec: "frost".into(),
        }
    }

    #[test]
    fn excludes_currently_equipped_baseline() {
        // parse_gear_comparison_result pushes a "Currently Equipped" entry into
        // results[]; its items are the player's equipped gear and must NOT show up
        // as dropped loot in the report.
        let inputs = vec![(
            member("a", "Alice"),
            Some(json!({
                "base_dps": 1000.0,
                "results": [
                    {"name":"Currently Equipped","items":[{"item_id":999,"slot":"finger1","ilevel":289,"name":"Equipped Ring","encounter":""}],"dps":1000.0,"delta":0.0},
                    {"name":"Combo 2","items":[{"item_id":111,"slot":"trinket1","ilevel":600,"name":"Whorl","encounter":"Ovinax"}],"dps":1048.0,"delta":48.0}
                ]
            })),
            None,
        )];
        let report = aggregate_report("r", 1, "heroic", &inputs);
        assert!(
            report.items.iter().all(|i| i.item_id != 999),
            "equipped baseline item leaked into report: {:?}",
            report.items.iter().map(|i| i.item_id).collect::<Vec<_>>()
        );
        assert!(
            report.items.iter().any(|i| i.item_id == 111),
            "drop should be present"
        );
        assert_eq!(report.items.len(), 1);
    }

    #[test]
    fn pivots_by_item_with_per_player_upgrade_pct() {
        let inputs = vec![
            (
                member("a", "Alice"),
                Some(json!({
                    "base_dps": 1000.0,
                    "results": [
                        {"items":[{"item_id":111,"slot":"trinket1","ilevel":600,"name":"Whorl","encounter":"Ovinax"}],"dps":1048.0,"delta":48.0},
                        {"items":[{"item_id":222,"slot":"head","ilevel":600,"name":"Hood","encounter":"Ovinax"}],"dps":990.0,"delta":-10.0}
                    ]
                })),
                None,
            ),
            (
                member("b", "Bob"),
                Some(json!({
                    "base_dps": 2000.0,
                    "results": [
                        {"items":[{"item_id":111,"slot":"trinket1","ilevel":600,"name":"Whorl","encounter":"Ovinax"}],"dps":2040.0,"delta":40.0}
                    ]
                })),
                None,
            ),
        ];
        let report = aggregate_report("roster1", 1234, "heroic", &inputs);

        assert_eq!(report.players.len(), 2);
        assert!(report.players.iter().all(|p| p.status == "ok"));

        // item 111: both players, ranked desc by upgrade_pct (Alice 4.8% > Bob 2.0%)
        let whorl = report.items.iter().find(|i| i.item_id == 111).unwrap();
        assert_eq!(whorl.results.len(), 2);
        assert_eq!(whorl.results[0].member_id, "a");
        assert!((whorl.results[0].upgrade_pct - 4.8).abs() < 1e-6);
        assert_eq!(whorl.results[1].member_id, "b");
        assert!((whorl.results[1].upgrade_pct - 2.0).abs() < 1e-6);
        assert!((whorl.results[0].abs_gain - 48.0).abs() < 1e-6);

        // item 222: downgrade for Alice
        let hood = report.items.iter().find(|i| i.item_id == 222).unwrap();
        assert_eq!(hood.results.len(), 1);
        assert!(hood.results[0].is_downgrade);
        assert!(hood.results[0].upgrade_pct < 0.0);
    }

    #[test]
    fn keeps_best_combo_per_item_per_member() {
        // Same item_id 111 in two slots for one member -> keep the max-delta combo.
        let inputs = vec![(
            member("a", "Alice"),
            Some(json!({
                "base_dps": 1000.0,
                "results": [
                    {"items":[{"item_id":111,"slot":"finger1","ilevel":600,"name":"Ring","encounter":"Boss"}],"dps":1010.0,"delta":10.0},
                    {"items":[{"item_id":111,"slot":"finger2","ilevel":600,"name":"Ring","encounter":"Boss"}],"dps":1030.0,"delta":30.0}
                ]
            })),
            None,
        )];
        let report = aggregate_report("r", 1, "heroic", &inputs);
        let ring = report.items.iter().find(|i| i.item_id == 111).unwrap();
        assert_eq!(ring.results.len(), 1);
        assert!((ring.results[0].abs_gain - 30.0).abs() < 1e-6);
    }

    #[test]
    fn void_forge_variant_is_separate_row_from_base() {
        // Base item 111 and its Void Forged variant share item_id 111; the
        // variant marker must key them into distinct rows, not merge them.
        let inputs = vec![(
            member("a", "Alice"),
            Some(json!({
                "base_dps": 1000.0,
                "results": [
                    {"items":[{"item_id":111,"slot":"trinket1","ilevel":620,"name":"Whorl","encounter":"Ovinax"}],"dps":1048.0,"delta":48.0},
                    {"items":[{"item_id":111,"slot":"trinket1","ilevel":639,"name":"Whorl","encounter":"Ovinax","is_void_forge":true,"source_item_id":111}],"dps":1080.0,"delta":80.0}
                ]
            })),
            None,
        )];
        let report = aggregate_report("r", 1, "heroic", &inputs);
        assert_eq!(
            report.items.len(),
            2,
            "base + void forge must be separate rows"
        );
        let vf = report
            .items
            .iter()
            .find(|i| i.is_void_forge)
            .expect("vf row");
        assert_eq!(vf.item_id, 111);
        assert_eq!(vf.uid, "111:vf");
        let base = report
            .items
            .iter()
            .find(|i| !i.is_void_forge && !i.is_catalyst)
            .expect("base row");
        assert_eq!(base.uid, "111");
    }

    #[test]
    fn failed_member_recorded_without_items() {
        let inputs = vec![(member("a", "Alice"), None, None)];
        let report = aggregate_report("r", 1, "mythic", &inputs);
        assert_eq!(report.players.len(), 1);
        assert_eq!(report.players[0].status, "sim_failed");
        assert_eq!(report.players[0].base_dps, 0.0);
        assert!(report.items.is_empty());
    }

    #[test]
    fn failed_member_carries_the_callers_reason() {
        let inputs = vec![(
            member("a", "Alice"),
            None,
            Some("Simmit rate-limited — try again shortly.".to_string()),
        )];
        let report = aggregate_report("r", 1, "mythic", &inputs);
        assert_eq!(
            report.players[0].error.as_deref(),
            Some("Simmit rate-limited — try again shortly.")
        );
    }

    #[test]
    fn failed_member_without_a_reason_still_gets_one() {
        // No caller reason: the report explains itself from what it has.
        let no_result = vec![(member("a", "Alice"), None, None)];
        assert_eq!(
            aggregate_report("r", 1, "mythic", &no_result).players[0]
                .error
                .as_deref(),
            Some("Sim produced no result.")
        );

        // A result that arrived but carries no usable baseline is a distinct case.
        let zero_base = vec![(member("b", "Bob"), Some(json!({"base_dps": 0.0})), None)];
        assert_eq!(
            aggregate_report("r", 1, "mythic", &zero_base).players[0]
                .error
                .as_deref(),
            Some("Sim returned no baseline DPS.")
        );
    }

    #[test]
    fn ok_member_has_no_error() {
        let inputs = vec![(
            member("a", "Alice"),
            Some(json!({"base_dps": 1000.0})),
            None,
        )];
        let report = aggregate_report("r", 1, "mythic", &inputs);
        assert_eq!(report.players[0].status, "ok");
        assert!(report.players[0].error.is_none());
    }

    #[test]
    fn cached_reports_without_error_field_still_deserialize() {
        // report_json rows written before this field existed must keep loading.
        let old = r#"{"member_id":"a","name":"Alice","class":"mage","spec":"frost","base_dps":0.0,"status":"sim_failed"}"#;
        let p: PlayerEntry = serde_json::from_str(old).unwrap();
        assert!(p.error.is_none());
    }
}
