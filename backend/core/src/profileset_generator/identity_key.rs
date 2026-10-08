use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

/// Inputs for one candidate's identity_key. The key reflects EFFECTIVE
/// profileset behavior, not the cursor (spec §2). Per-slot gems are sorted
/// before hashing so `gem_id=A/B` and `B/A` collapse to one identity.
pub struct IdentityInput<'a> {
    pub spec: &'a str,
    pub gear_set: &'a HashMap<String, Arc<Value>>,
    pub effective_enchants: &'a HashMap<String, u64>,
    pub effective_gems: &'a HashMap<String, Vec<u64>>,
    pub talent_string: &'a str,
    /// `omnium_talents=` override, empty when the actor uses the base folio.
    pub omnium_string: &'a str,
    /// Consumable overrides, empty when the actor uses the base consumables.
    pub consumables: &'a BTreeMap<String, String>,
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

    // Effective gems: sorted by slot, each slot's list sorted so `gem_id=A/B`
    // and `B/A` hash equal (canonical form is needed across resume + dedup, not
    // just the combo generator).
    let mut gem_slots: Vec<&String> = input.effective_gems.keys().collect();
    gem_slots.sort();
    hasher.update(b"gems:\n");
    for slot in gem_slots {
        hasher.update(slot.as_bytes());
        hasher.update(b"=");
        let mut sorted: Vec<u64> = input.effective_gems[slot].clone();
        sorted.sort();
        for (i, gid) in sorted.iter().enumerate() {
            if i > 0 {
                hasher.update(b"/");
            }
            hasher.update(gid.to_string().as_bytes());
        }
        hasher.update(b"\n");
    }

    hasher.update(b"talents=");
    hasher.update(input.talent_string.as_bytes());

    // Appended only when set, so keys for folio-less runs (and the resume
    // checkpoints holding them) are byte-identical to before the folio axis.
    // Runes are sorted first: the same folio listed in a different order is the
    // same actor, exactly like the per-slot gem lists above.
    if !input.omnium_string.is_empty() {
        let mut runes: Vec<&str> = input
            .omnium_string
            .split('/')
            .filter(|p| !p.is_empty())
            .collect();
        runes.sort_unstable();
        hasher.update(b"\nomnium=");
        hasher.update(runes.join("/").as_bytes());
    }

    // Also appended only when set, for the same checkpoint stability.
    if !input.consumables.is_empty() {
        hasher.update(b"\nconsumables=");
        for (slot, value) in input.consumables {
            hasher.update(slot.as_bytes());
            hasher.update(b":");
            hasher.update(value.as_bytes());
            hasher.update(b";");
        }
    }

    let digest = hasher.finalize();
    // 16 of 32 digest bytes = 32 hex chars; collision prob < 2^-64 per pair,
    // ample at billion-combo scale.
    hex::encode(&digest[..16])
}

/// Filter a nominal gem assignment to slots whose CHOSEN item actually has
/// sockets (inherent or via a crafted-socket bonus in `socketed_item_ids`), and
/// truncate each list to that item's socket count — so a 2-multiset on a slot
/// that resolved to a 1-socket alt keeps one gem and drops the rest.
pub fn effective_gems(
    gear_set: &HashMap<String, Arc<Value>>,
    nominal_gems: &HashMap<String, Vec<u64>>,
    socketed_item_ids: &std::collections::HashSet<u64>,
) -> HashMap<String, Vec<u64>> {
    let mut out = HashMap::new();
    for (slot, gem_ids) in nominal_gems {
        let Some(item) = gear_set.get(slot) else {
            continue;
        };
        let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
        let inherent_sockets = item.get("sockets").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        let socketable = inherent_sockets > 0 || socketed_item_ids.contains(&item_id);
        if !socketable {
            continue;
        }
        let cap = if inherent_sockets > 0 {
            inherent_sockets
        } else {
            gem_ids.len()
        };
        let kept: Vec<u64> = gem_ids
            .iter()
            .take(cap)
            .copied()
            .filter(|g| *g > 0)
            .collect();
        if !kept.is_empty() {
            out.insert(slot.clone(), kept);
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
        gems.insert("head".to_string(), vec![5001u64]);

        let input = IdentityInput {
            spec: "mistweaver",
            gear_set: &gear,
            effective_enchants: &enchants,
            effective_gems: &gems,
            talent_string: "BoG...",
            omnium_string: "",
            consumables: &BTreeMap::new(),
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
        let no_gems: HashMap<String, Vec<u64>> = HashMap::new();

        let k1 = compute_identity_key(&IdentityInput {
            spec: "mistweaver",
            gear_set: &gear1,
            effective_enchants: &no_enchants,
            effective_gems: &no_gems,
            talent_string: "",
            omnium_string: "",
            consumables: &BTreeMap::new(),
        });
        let k2 = compute_identity_key(&IdentityInput {
            spec: "mistweaver",
            gear_set: &gear2,
            effective_enchants: &no_enchants,
            effective_gems: &no_gems,
            talent_string: "",
            omnium_string: "",
            consumables: &BTreeMap::new(),
        });
        assert_ne!(k1, k2);
    }

    #[test]
    fn gems_on_socketless_slots_dont_affect_key() {
        let mut gear = HashMap::new();
        gear.insert("head".to_string(), arc_item(100, 0)); // no sockets
        let nominal_gems_a = HashMap::from_iter([("head".to_string(), vec![5001u64])]);
        let nominal_gems_b = HashMap::from_iter([("head".to_string(), vec![5002u64])]);

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
            omnium_string: "",
            consumables: &BTreeMap::new(),
        });
        let k_b = compute_identity_key(&IdentityInput {
            spec: "mistweaver",
            gear_set: &gear,
            effective_enchants: &no_enchants,
            effective_gems: &eff_b,
            talent_string: "",
            omnium_string: "",
            consumables: &BTreeMap::new(),
        });
        assert_eq!(
            k_a, k_b,
            "effective gems differ in nominal but not effective; keys must match"
        );
    }

    #[test]
    fn talent_changes_change_key() {
        let gear: HashMap<String, Arc<Value>> = HashMap::new();
        let no_enchants: HashMap<String, u64> = HashMap::new();
        let no_gems: HashMap<String, Vec<u64>> = HashMap::new();

        let k1 = compute_identity_key(&IdentityInput {
            spec: "mistweaver",
            gear_set: &gear,
            effective_enchants: &no_enchants,
            effective_gems: &no_gems,
            talent_string: "BuildA",
            omnium_string: "",
            consumables: &BTreeMap::new(),
        });
        let k2 = compute_identity_key(&IdentityInput {
            spec: "mistweaver",
            gear_set: &gear,
            effective_enchants: &no_enchants,
            effective_gems: &no_gems,
            talent_string: "BuildB",
            omnium_string: "",
            consumables: &BTreeMap::new(),
        });
        assert_ne!(k1, k2);
    }

    #[test]
    fn different_folios_hash_to_different_keys() {
        // Two profilesets with identical gear but different folio runes are
        // different actors — dedup must not collapse them.
        let gear: HashMap<String, Arc<Value>> = HashMap::new();
        let no_enchants: HashMap<String, u64> = HashMap::new();
        let no_gems: HashMap<String, Vec<u64>> = HashMap::new();

        let k1 = compute_identity_key(&IdentityInput {
            spec: "beast_mastery",
            gear_set: &gear,
            effective_enchants: &no_enchants,
            effective_gems: &no_gems,
            talent_string: "BuildA",
            omnium_string: "136814:1",
            consumables: &BTreeMap::new(),
        });
        let k2 = compute_identity_key(&IdentityInput {
            spec: "beast_mastery",
            gear_set: &gear,
            effective_enchants: &no_enchants,
            effective_gems: &no_gems,
            talent_string: "BuildA",
            omnium_string: "136824:1",
            consumables: &BTreeMap::new(),
        });
        assert_ne!(k1, k2);
    }

    #[test]
    fn consumable_mixes_hash_to_different_keys() {
        let gear: HashMap<String, Arc<Value>> = HashMap::new();
        let no_enchants: HashMap<String, u64> = HashMap::new();
        let no_gems: HashMap<String, Vec<u64>> = HashMap::new();
        let key = |consumables: &BTreeMap<String, String>| {
            compute_identity_key(&IdentityInput {
                spec: "beast_mastery",
                gear_set: &gear,
                effective_enchants: &no_enchants,
                effective_gems: &no_gems,
                talent_string: "BuildA",
                omnium_string: "",
                consumables,
            })
        };
        let flask = |v: &str| BTreeMap::from([("flask".to_string(), v.to_string())]);
        assert_ne!(key(&BTreeMap::new()), key(&flask("a")));
        assert_ne!(key(&flask("a")), key(&flask("b")));
        assert_eq!(key(&flask("a")), key(&flask("a")));
    }

    #[test]
    fn folio_rune_orderings_hash_to_same_key() {
        // Same runes listed in a different order are the same SimC actor, so
        // dedup must collapse them — as it already does for multi-socket gems.
        let gear: HashMap<String, Arc<Value>> = HashMap::new();
        let no_enchants: HashMap<String, u64> = HashMap::new();
        let no_gems: HashMap<String, Vec<u64>> = HashMap::new();
        let key = |omnium: &str| {
            compute_identity_key(&IdentityInput {
                spec: "beast_mastery",
                gear_set: &gear,
                effective_enchants: &no_enchants,
                effective_gems: &no_gems,
                talent_string: "BuildA",
                omnium_string: omnium,
                consumables: &BTreeMap::new(),
            })
        };
        assert_eq!(key("136814:1/136818:1"), key("136818:1/136814:1"));
    }

    #[test]
    fn multi_socket_gem_orderings_hash_to_same_key() {
        // `gem_id=A/B` and `B/A` are the same SimC actor → dedup must collapse
        // them to one identity.
        let mut gear = HashMap::new();
        gear.insert("neck".to_string(), arc_item(700, 2));
        let no_enchants: HashMap<String, u64> = HashMap::new();
        let ab = HashMap::from_iter([("neck".to_string(), vec![1u64, 2u64])]);
        let ba = HashMap::from_iter([("neck".to_string(), vec![2u64, 1u64])]);
        let k_ab = compute_identity_key(&IdentityInput {
            spec: "mistweaver",
            gear_set: &gear,
            effective_enchants: &no_enchants,
            effective_gems: &ab,
            talent_string: "",
            omnium_string: "",
            consumables: &BTreeMap::new(),
        });
        let k_ba = compute_identity_key(&IdentityInput {
            spec: "mistweaver",
            gear_set: &gear,
            effective_enchants: &no_enchants,
            effective_gems: &ba,
            talent_string: "",
            omnium_string: "",
            consumables: &BTreeMap::new(),
        });
        assert_eq!(k_ab, k_ba);
    }

    #[test]
    fn effective_gems_truncates_to_item_socket_count() {
        // 2-multiset on a 1-socket item → second gem dropped so identity matches
        // a 1-socket assignment.
        let mut gear = HashMap::new();
        gear.insert("neck".to_string(), arc_item(100, 1));
        let nominal = HashMap::from_iter([("neck".to_string(), vec![10u64, 20u64])]);
        let eff = effective_gems(&gear, &nominal, &HashSet::new());
        assert_eq!(eff.get("neck"), Some(&vec![10u64]));
    }
}
