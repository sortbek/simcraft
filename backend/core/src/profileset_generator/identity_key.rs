use std::collections::HashMap;
use std::sync::Arc;
use serde_json::Value;
use sha2::{Digest, Sha256};

/// Inputs needed to compute an identity_key for one profileset candidate.
/// The key reflects the EFFECTIVE profileset behavior, not the cursor —
/// see spec §2 formal definition.
pub struct IdentityInput<'a> {
    pub spec: &'a str,
    pub gear_set: &'a HashMap<String, Arc<Value>>,
    pub effective_enchants: &'a HashMap<String, u64>,
    pub effective_gems: &'a HashMap<String, u64>,
    pub talent_string: &'a str,
}

/// Compute a stable 32-char hex identity key for the candidate.
/// Two candidates produce the same key iff their effective profileset
/// behavior is identical (after gem socket-applicability filtering, 2H
/// off-hand normalization, enchant resolution, talent normalization).
pub fn compute_identity_key(input: &IdentityInput) -> String {
    let mut hasher = Sha256::new();

    hasher.update(b"spec=");
    hasher.update(input.spec.as_bytes());
    hasher.update(b"\n");

    // Gear: sorted by slot for determinism.
    let mut gear_slots: Vec<&String> = input.gear_set.keys().collect();
    gear_slots.sort();
    hasher.update(b"gear:\n");
    for slot in gear_slots {
        if let Some(item) = input.gear_set.get(slot) {
            let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            hasher.update(slot.as_bytes());
            hasher.update(b"=");
            hasher.update(item_id.to_string().as_bytes());
            // bonus_ids also matter (different upgrade tracks → different stats).
            if let Some(b_ids) = item.get("bonus_ids").and_then(|v| v.as_array()) {
                hasher.update(b"|");
                for b in b_ids {
                    hasher.update(b.to_string().as_bytes());
                    hasher.update(b",");
                }
            }
            hasher.update(b"\n");
        }
    }

    // Effective enchants: sorted by slot.
    let mut enchant_slots: Vec<&String> = input.effective_enchants.keys().collect();
    enchant_slots.sort();
    hasher.update(b"enchants:\n");
    for slot in enchant_slots {
        hasher.update(slot.as_bytes());
        hasher.update(b"=");
        hasher.update(input.effective_enchants[slot].to_string().as_bytes());
        hasher.update(b"\n");
    }

    // Effective gems: sorted by slot.
    let mut gem_slots: Vec<&String> = input.effective_gems.keys().collect();
    gem_slots.sort();
    hasher.update(b"gems:\n");
    for slot in gem_slots {
        hasher.update(slot.as_bytes());
        hasher.update(b"=");
        hasher.update(input.effective_gems[slot].to_string().as_bytes());
        hasher.update(b"\n");
    }

    hasher.update(b"talents=");
    hasher.update(input.talent_string.as_bytes());

    let digest = hasher.finalize();
    // 16 bytes of the 32-byte digest = 32 hex chars. Sufficient for per-job uniqueness
    // at billion-combo scale (collision probability < 2^-64 per pair).
    hex::encode(&digest[..16])
}

/// Filter a nominal gem assignment down to slots that ACTUALLY have sockets,
/// given the chosen items. Inputs:
/// - gear_set: chosen items per slot
/// - nominal_gems: gem_id per slot from the cursor
/// - socketed_item_ids: set of item_ids known to have sockets (or to be socketable
///   via a crafted-socket bonus)
pub fn effective_gems(
    gear_set: &HashMap<String, Arc<Value>>,
    nominal_gems: &HashMap<String, u64>,
    socketed_item_ids: &std::collections::HashSet<u64>,
) -> HashMap<String, u64> {
    let mut out = HashMap::new();
    for (slot, &gem_id) in nominal_gems {
        if gem_id == 0 {
            continue;
        }
        let Some(item) = gear_set.get(slot) else { continue };
        let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
        let inherent_sockets = item.get("sockets").and_then(|v| v.as_u64()).unwrap_or(0);
        let socketable = inherent_sockets > 0 || socketed_item_ids.contains(&item_id);
        if socketable {
            out.insert(slot.clone(), gem_id);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashSet;

    fn arc_item(id: u64, sockets: u64) -> Arc<Value> {
        Arc::new(json!({ "item_id": id, "sockets": sockets, "bonus_ids": [] }))
    }

    #[test]
    fn identical_inputs_produce_identical_keys() {
        let mut gear = HashMap::new();
        gear.insert("head".to_string(), arc_item(100, 1));
        let enchants = HashMap::new();
        let mut gems = HashMap::new();
        gems.insert("head".to_string(), 5001u64);

        let input = IdentityInput {
            spec: "mistweaver",
            gear_set: &gear,
            effective_enchants: &enchants,
            effective_gems: &gems,
            talent_string: "BoG...",
        };

        let k1 = compute_identity_key(&input);
        let k2 = compute_identity_key(&input);
        assert_eq!(k1, k2);
    }

    #[test]
    fn different_gear_produces_different_keys() {
        let mut gear1 = HashMap::new();
        gear1.insert("head".to_string(), arc_item(100, 1));
        let mut gear2 = HashMap::new();
        gear2.insert("head".to_string(), arc_item(200, 1));
        let no_enchants: HashMap<String, u64> = HashMap::new();
        let no_gems: HashMap<String, u64> = HashMap::new();

        let k1 = compute_identity_key(&IdentityInput {
            spec: "mistweaver",
            gear_set: &gear1,
            effective_enchants: &no_enchants,
            effective_gems: &no_gems,
            talent_string: "",
        });
        let k2 = compute_identity_key(&IdentityInput {
            spec: "mistweaver",
            gear_set: &gear2,
            effective_enchants: &no_enchants,
            effective_gems: &no_gems,
            talent_string: "",
        });
        assert_ne!(k1, k2);
    }

    #[test]
    fn gems_on_socketless_slots_dont_affect_key() {
        let mut gear = HashMap::new();
        gear.insert("head".to_string(), arc_item(100, 0));  // no sockets
        let nominal_gems_a = HashMap::from_iter([("head".to_string(), 5001u64)]);
        let nominal_gems_b = HashMap::from_iter([("head".to_string(), 5002u64)]);

        let sockets = HashSet::new();
        let eff_a = effective_gems(&gear, &nominal_gems_a, &sockets);
        let eff_b = effective_gems(&gear, &nominal_gems_b, &sockets);

        assert!(eff_a.is_empty(), "socketless slot should filter out");
        assert!(eff_b.is_empty());

        let no_enchants: HashMap<String, u64> = HashMap::new();
        let k_a = compute_identity_key(&IdentityInput {
            spec: "mistweaver",
            gear_set: &gear,
            effective_enchants: &no_enchants,
            effective_gems: &eff_a,
            talent_string: "",
        });
        let k_b = compute_identity_key(&IdentityInput {
            spec: "mistweaver",
            gear_set: &gear,
            effective_enchants: &no_enchants,
            effective_gems: &eff_b,
            talent_string: "",
        });
        assert_eq!(k_a, k_b, "effective gems differ in nominal but not effective; keys must match");
    }

    #[test]
    fn talent_changes_change_key() {
        let gear: HashMap<String, Arc<Value>> = HashMap::new();
        let no_enchants: HashMap<String, u64> = HashMap::new();
        let no_gems: HashMap<String, u64> = HashMap::new();

        let k1 = compute_identity_key(&IdentityInput {
            spec: "mistweaver",
            gear_set: &gear,
            effective_enchants: &no_enchants,
            effective_gems: &no_gems,
            talent_string: "BuildA",
        });
        let k2 = compute_identity_key(&IdentityInput {
            spec: "mistweaver",
            gear_set: &gear,
            effective_enchants: &no_enchants,
            effective_gems: &no_gems,
            talent_string: "BuildB",
        });
        assert_ne!(k1, k2);
    }
}
