//! Shared request-preprocessing + serialization helpers for the sim-create and
//! combo-count handlers. Extracted to kill the verbatim duplication the
//! architecture audit (#8) flagged across 5+ handler files.

use serde_json::Value;
use std::collections::HashSet;

use super::helpers::{apply_spec_override, apply_talent_override};

/// Apply the standard talent-override → spec-override → talent-normalize chain
/// that every sim handler runs before parsing the simc input. Single source of
/// truth so the ordering can't drift between handlers.
pub(super) fn preprocess_simc_input(simc_input: &str, talents: &str, spec_override: &str) -> String {
    let with_overrides = apply_spec_override(
        &apply_talent_override(simc_input, talents),
        spec_override,
    );
    crate::talent_normalize::normalize_simc_talents(&with_overrides)
}

/// Clamp a client-requested max-combinations against the server-configured cap.
/// `MAX_COMBINATIONS == 0` means "unlimited" on the server side.
pub(super) fn capped_max_combinations(requested: Option<usize>) -> Option<usize> {
    let server_max = crate::db::MAX_COMBINATIONS.load(std::sync::atomic::Ordering::Relaxed);
    match (requested, server_max) {
        (Some(client), max) if max > 0 => Some(client.min(max)),
        (None, max) if max > 0 => Some(max),
        (client, _) => client,
    }
}

/// Collect item IDs that carry at least one socket (equipped + alternatives)
/// from a resolved-gear response. Feeds the gem-axis socket-count logic.
pub(super) fn socketed_item_ids(resolved: &crate::types::ResolveGearResponse) -> HashSet<u64> {
    resolved
        .slots
        .values()
        .flat_map(|res| {
            let mut ids = Vec::new();
            if let Some(eq) = &res.equipped {
                if eq.sockets > 0 {
                    ids.push(eq.item_id);
                }
            }
            for alt in &res.alternatives {
                if alt.sockets > 0 {
                    ids.push(alt.item_id);
                }
            }
            ids
        })
        .collect()
}

/// Serialize a `HashMap<String, Vec<Value>>` combo-metadata map into the
/// `(combo_name, json_string)` pairs `ProfilesetSubmission` expects. Used by
/// top_gear / enchant_gem / upgrade_compare (delta-list shape).
pub(super) fn serialize_combo_metadata_vec(
    combo_metadata: &std::collections::HashMap<String, Vec<Value>>,
) -> Vec<(String, String)> {
    combo_metadata
        .iter()
        .map(|(name, deltas)| {
            (
                name.clone(),
                serde_json::to_string(deltas).unwrap_or_else(|_| "[]".to_string()),
            )
        })
        .collect()
}

/// Serialize a `HashMap<String, Value>` combo-metadata map (droptimizer shape:
/// one Value per combo, not a Vec) into `(combo_name, json_string)` pairs.
pub(super) fn serialize_combo_metadata_value(
    combo_metadata: &std::collections::HashMap<String, Value>,
) -> Vec<(String, String)> {
    combo_metadata
        .iter()
        .map(|(name, val)| {
            (
                name.clone(),
                serde_json::to_string(val).unwrap_or_else(|_| "null".to_string()),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preprocess_applies_talent_then_spec_override() {
        let input = "warrior=t\nspec=arms\nhead=,id=1\n";
        let out = preprocess_simc_input(input, "ABBA", "fury");
        assert!(out.contains("talents=ABBA"), "talents override missing: {out}");
        assert!(out.contains("spec=fury"), "spec override missing: {out}");
    }

    #[test]
    fn preprocess_empty_overrides_are_noops() {
        let input = "warrior=t\nspec=arms\nhead=,id=1\n";
        let out = preprocess_simc_input(input, "", "");
        // No talents= / spec= lines were forced in by empty overrides.
        assert!(!out.contains("talents="), "empty talents must not inject: {out}");
        assert!(out.contains("spec=arms"), "original spec must survive: {out}");
    }

    #[test]
    fn capped_zero_server_max_passes_client_through() {
        // With server_max default (0 = unlimited) the client value is returned as-is.
        assert_eq!(capped_max_combinations(Some(42)), Some(42));
        assert_eq!(capped_max_combinations(None), None);
    }

    #[test]
    fn serialize_vec_metadata_round_trips() {
        let mut m = std::collections::HashMap::new();
        m.insert("Combo 2".to_string(), vec![serde_json::json!({"slot":"head"})]);
        let out = serialize_combo_metadata_vec(&m);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "Combo 2");
        assert!(out[0].1.contains("\"slot\":\"head\""));
    }
}
