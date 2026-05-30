//! Reconstruct a ProfilesetIteratorConfig from a stored normalized
//! `request_json` envelope. Used by Phase 2 resume to rebuild the exact
//! same iterator the original sim was using.
//!
//! Only `sim_type = "top_gear"` is supported in Phase 2. Other sim types
//! either don't use the streaming iterator (Inline mode) or don't have a
//! resumable workflow.

use serde_json::Value;
use std::collections::{HashMap, HashSet};

use super::iterator::ProfilesetIteratorConfig;
use super::GemEnchantOptions;
use crate::server::request_json::NormalizedRequest;

/// Rebuild a `ProfilesetIteratorConfig` from a stored normalized request envelope.
/// The envelope shape is `{ sim_type, version, payload }` per
/// [crate::server::request_json::NormalizedRequest].
pub fn build_iterator_from_request_json(json: &str) -> Result<ProfilesetIteratorConfig, String> {
    let envelope: NormalizedRequest =
        serde_json::from_str(json).map_err(|e| format!("Invalid request_json: {}", e))?;
    if envelope.sim_type != "top_gear" {
        return Err(format!(
            "Resume not supported for sim_type={} (only top_gear in Phase 2)",
            envelope.sim_type
        ));
    }
    let payload = &envelope.payload;

    let base_profile = payload
        .get("base_profile")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "payload missing base_profile".to_string())?
        .to_string();

    let items_by_slot: HashMap<String, Vec<Value>> = payload
        .get("items_by_slot")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .ok_or_else(|| "payload missing items_by_slot".to_string())?;

    let selected_items: HashMap<String, Vec<String>> = payload
        .get("selected_items")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let enchant_selections: HashMap<String, Vec<u64>> = payload
        .get("enchant_selections")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let gem_options: Vec<u64> = payload
        .get("gem_options")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // socketed_item_ids was serialized as a Vec<u64> for JSON portability.
    let socketed_item_ids: HashSet<u64> = payload
        .get("socketed_item_ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
        .unwrap_or_default();

    let replace_gems = payload
        .get("replace_gems")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let diamond_always_use = payload
        .get("diamond_always_use")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let max_colors = payload
        .get("max_colors")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let talent_builds: Vec<(String, String)> = payload
        .get("talent_builds")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    // Stored as either [name, talent_string] tuples or { name, talent_string }
                    // — check both shapes.
                    if let Some(pair) = t.as_array() {
                        if pair.len() == 2 {
                            return Some((
                                pair[0].as_str().unwrap_or("").to_string(),
                                pair[1].as_str().unwrap_or("").to_string(),
                            ));
                        }
                    }
                    if let Some(obj) = t.as_object() {
                        let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let ts = obj
                            .get("talent_string")
                            .and_then(|v| v.as_str())
                            .or_else(|| obj.get("ts").and_then(|v| v.as_str()))
                            .unwrap_or("");
                        return Some((name.to_string(), ts.to_string()));
                    }
                    None
                })
                .collect()
        })
        .unwrap_or_default();

    // Catalyst budget is stored in the streaming envelope under "catalyst_charges"
    // (written by streaming_top_gear.rs). `None` is preserved when the original
    // request had no catalyst budget so the resumed job is identical.
    let catalyst_charges: Option<u32> = payload
        .get("catalyst_charges")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);

    // Delegate to the shared builder in top_gear.rs.
    // build_iterator_config takes a GemEnchantOptions struct (not flat args), so
    // we construct one here — Option A: match the existing signature unchanged.
    let gem_opts = GemEnchantOptions {
        enchant_selections: Some(&enchant_selections),
        gem_options: &gem_options,
        socketed_item_ids: Some(&socketed_item_ids),
        replace_gems,
        diamond_always_use,
        max_colors,
    };

    Ok(super::top_gear::build_iterator_config(
        &base_profile,
        &items_by_slot,
        &selected_items,
        &talent_builds,
        &gem_opts,
        catalyst_charges,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn unwrap_err(result: Result<ProfilesetIteratorConfig, String>) -> String {
        match result {
            Err(e) => e,
            Ok(_) => panic!("expected Err but got Ok"),
        }
    }

    #[test]
    fn rejects_unsupported_sim_type() {
        let envelope = json!({
            "sim_type": "quick",
            "version": 1,
            "payload": {}
        });
        let err = unwrap_err(build_iterator_from_request_json(&envelope.to_string()));
        assert!(err.contains("sim_type=quick"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_invalid_json() {
        let err = unwrap_err(build_iterator_from_request_json("{not json"));
        assert!(
            err.contains("Invalid request_json"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn rejects_missing_payload() {
        let envelope = json!({
            "sim_type": "top_gear",
            "version": 1
        });
        let err = unwrap_err(build_iterator_from_request_json(&envelope.to_string()));
        assert!(err.contains("payload"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_missing_base_profile() {
        let envelope = json!({
            "sim_type": "top_gear",
            "version": 1,
            "payload": { "items_by_slot": {} }
        });
        let err = unwrap_err(build_iterator_from_request_json(&envelope.to_string()));
        assert!(err.contains("base_profile"), "unexpected error: {err}");
    }

    #[test]
    fn resume_rebuild_carries_catalyst_budget() {
        use crate::test_support::ensure_game_data_loaded;
        ensure_game_data_loaded();

        // Minimal valid envelope with a catalyst budget of 2.
        let envelope = json!({
            "sim_type": "top_gear",
            "version": 1,
            "payload": {
                "base_profile": "",
                "items_by_slot": {},
                "catalyst_charges": 2u32,
            }
        });
        let cfg = build_iterator_from_request_json(&envelope.to_string())
            .expect("rebuild should succeed");
        assert_eq!(
            cfg.max_catalyst_charges,
            Some(2),
            "resumed config must carry the catalyst budget from the stored envelope"
        );
    }

    #[test]
    fn resume_rebuild_no_catalyst_budget_is_none() {
        use crate::test_support::ensure_game_data_loaded;
        ensure_game_data_loaded();

        // Envelope with no catalyst_charges key at all.
        let envelope = json!({
            "sim_type": "top_gear",
            "version": 1,
            "payload": {
                "base_profile": "",
                "items_by_slot": {},
            }
        });
        let cfg = build_iterator_from_request_json(&envelope.to_string())
            .expect("rebuild should succeed");
        assert_eq!(
            cfg.max_catalyst_charges,
            None,
            "resumed config without catalyst_charges must be None"
        );
    }
}
