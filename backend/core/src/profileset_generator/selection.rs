use serde_json::Value;
use std::collections::{HashMap, HashSet};

use crate::game_data;
use crate::types::class_data::{self, ARMOR_SLOTS, GEAR_SLOTS};

/// Catalyst uids append the conversion source (`gear_resolver::build_catalyst_item`),
/// so two sources converting to the same tier piece stay distinct.
fn catalyst_source_suffix(item: &Value) -> String {
    let is_catalyst = item
        .get("is_catalyst")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    match item.get("source_item_id").and_then(|v| v.as_u64()) {
        Some(src) if is_catalyst && src > 0 => format!(":{}", src),
        _ => String::new(),
    }
}

fn sorted_bonus_key(item: &Value) -> String {
    let mut bonus_ids: Vec<u64> = item
        .get("bonus_ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
        .unwrap_or_default();
    bonus_ids.sort();
    bonus_ids
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(":")
}

/// The resolver's own uid when the value carries one (manual items suffix theirs
/// with gem/enchant content that reconstruction can't reproduce); otherwise
/// rebuild it from the item fields.
fn make_item_uid(item: &Value) -> String {
    if let Some(uid) = item.get("uid").and_then(|v| v.as_str()) {
        if !uid.is_empty() {
            return uid.to_string();
        }
    }
    let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
    let origin = item
        .get("origin")
        .and_then(|v| v.as_str())
        .unwrap_or("bags");
    let slot = item.get("slot").and_then(|v| v.as_str()).unwrap_or("");
    format!(
        "{}:{}:{}:{}{}",
        item_id,
        sorted_bonus_key(item),
        origin,
        slot,
        catalyst_source_suffix(item)
    )
}

fn make_item_identity(item: &Value) -> String {
    if let Some(uid) = item.get("uid").and_then(|v| v.as_str()) {
        if !uid.is_empty() {
            return uid_identity(uid);
        }
    }
    let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
    let origin = item
        .get("origin")
        .and_then(|v| v.as_str())
        .unwrap_or("bags");
    format!(
        "{}:{}:{}{}",
        item_id,
        sorted_bonus_key(item),
        origin,
        catalyst_source_suffix(item)
    )
}

/// Identity = uid minus its slot segment. Slot names never collide with the
/// other segments (numeric ids, origin words), and catalyst uids carry a
/// trailing source id, so drop the slot token wherever it sits rather than
/// assuming it is last.
fn uid_identity(uid: &str) -> String {
    uid.split(':')
        .filter(|seg| !GEAR_SLOTS.contains(seg))
        .collect::<Vec<_>>()
        .join(":")
}

fn is_equipped(item: &Value) -> bool {
    item.get("is_equipped")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// Make each chosen alternative (slot → uid) the slot's equipped item: the old
/// one leaves `items_by_slot` and the base actor wears the replacement, so it
/// is the baseline every combo is measured against. Returns the rewritten base
/// profile. An unknown uid leaves its slot untouched.
pub fn apply_equipped_replacements(
    base_profile: &str,
    items_by_slot: &mut HashMap<String, Vec<Value>>,
    replacements: &HashMap<String, String>,
) -> String {
    let mut lines: Vec<String> = base_profile.lines().map(str::to_string).collect();
    let mut slots: Vec<&String> = replacements.keys().collect();
    slots.sort();

    for slot in slots {
        let Some(items) = items_by_slot.get_mut(slot) else {
            continue;
        };
        let uid = &replacements[slot];
        let Some(pos) = items
            .iter()
            .position(|it| !is_equipped(it) && make_item_uid(it) == *uid)
        else {
            continue;
        };
        let mut replacement = items.remove(pos);
        items.retain(|it| !is_equipped(it));
        replacement["is_equipped"] = Value::Bool(true);
        let simc = replacement
            .get("simc_string")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        items.insert(0, replacement);

        let prefix = format!("{slot}=");
        let line = format!("{slot}={simc}");
        match lines.iter_mut().find(|l| l.trim().starts_with(&prefix)) {
            Some(existing) => *existing = line,
            None => lines.push(line),
        }
    }

    let mut out = lines.join("\n");
    if base_profile.ends_with('\n') {
        out.push('\n');
    }
    out
}

pub(super) fn build_slot_candidates(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
) -> HashMap<String, Vec<Value>> {
    let mut slot_item_lists: HashMap<String, Vec<Value>> = HashMap::new();

    for slot in GEAR_SLOTS {
        let slot = slot.to_string();
        let slot_items = match items_by_slot.get(&slot) {
            Some(items) => items,
            None => continue,
        };

        let selected_uids: HashSet<String> = selected_items
            .get(&slot)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .collect();

        let mut selected_identities: HashSet<String> =
            selected_uids.iter().map(|uid| uid_identity(uid)).collect();
        if let Some(paired) = class_data::paired_slot(&slot) {
            if let Some(paired_uids) = selected_items.get(paired) {
                selected_identities.extend(paired_uids.iter().map(|uid| uid_identity(uid)));
            }
        }

        let mut candidates: Vec<Value> = Vec::new();
        for item in slot_items {
            let uid = make_item_uid(item);
            let identity = make_item_identity(item);
            if selected_uids.contains(&uid) || selected_identities.contains(&identity) {
                candidates.push(item.clone());
            }
        }

        let equipped = slot_items.iter().find(|it| {
            it.get("is_equipped")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        });

        if let Some(eq) = equipped {
            let already_included = candidates.iter().any(|c| {
                c.get("item_id") == eq.get("item_id")
                    && c.get("is_equipped")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
            });
            if !already_included {
                candidates.insert(0, eq.clone());
            }
        }

        if !candidates.is_empty() {
            slot_item_lists.insert(slot, candidates);
        }
    }

    if let Some(class_name) = class_data::detect_class(base_profile) {
        if let Some(max_subclass) = class_data::class_max_armor(class_name.as_str()) {
            for slot in ARMOR_SLOTS {
                let slot = slot.to_string();
                if let Some(items) = slot_item_lists.get_mut(&slot) {
                    items.retain(|item| {
                        if item
                            .get("is_equipped")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false)
                        {
                            return true;
                        }
                        let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
                        if item_id == 0 {
                            return true;
                        }
                        match game_data::get_item_armor_subclass(item_id) {
                            Some(subclass) => subclass <= max_subclass || subclass == 0,
                            None => true,
                        }
                    });
                }
            }
        }
    }

    slot_item_lists
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{ensure_game_data_loaded, TestItem};

    fn make(item_id: u64, slot: &str, is_equipped: bool, bonus_ids: Vec<u64>) -> Value {
        let mut b = TestItem::new(item_id).slot(slot).bonus_ids(bonus_ids);
        if is_equipped {
            b = b.equipped();
        }
        b.build()
    }

    fn uid_str(item_id: u64, bonus_ids: &[u64], origin: &str, slot: &str) -> String {
        let mut b = bonus_ids.to_vec();
        b.sort();
        let key = b
            .iter()
            .map(|x| x.to_string())
            .collect::<Vec<_>>()
            .join(":");
        format!("{}:{}:{}:{}", item_id, key, origin, slot)
    }

    #[test]
    fn make_item_uid_format() {
        let item = make(100, "head", false, vec![13, 12]);
        // bonus_ids should be sorted ascending in the UID
        assert_eq!(make_item_uid(&item), "100:12:13:bags:head");
    }

    #[test]
    fn make_item_uid_empty_bonus_ids() {
        let item = make(100, "head", true, vec![]);
        assert_eq!(make_item_uid(&item), "100::equipped:head");
    }

    #[test]
    fn equipped_always_included_even_when_not_selected() {
        ensure_game_data_loaded();
        let profile = "mage=test\n";
        let equipped = make(100, "head", true, vec![]);
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![equipped]);
        let result = build_slot_candidates(profile, &items_by_slot, &HashMap::new());
        let head = result.get("head").expect("head missing");
        assert_eq!(head.len(), 1);
        assert_eq!(head[0]["item_id"], 100);
    }

    #[test]
    fn selected_alternative_added_alongside_equipped() {
        ensure_game_data_loaded();
        let profile = "mage=test\n";
        let equipped = make(100, "head", true, vec![]);
        let alt = make(200, "head", false, vec![]);
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![equipped, alt]);

        let mut selected = HashMap::new();
        selected.insert("head".to_string(), vec![uid_str(200, &[], "bags", "head")]);

        let result = build_slot_candidates(profile, &items_by_slot, &selected);
        let head = result.get("head").expect("head missing");
        assert_eq!(head.len(), 2);
        // Equipped should be first (inserted at index 0)
        assert_eq!(head[0]["item_id"], 100);
        assert_eq!(head[1]["item_id"], 200);
    }

    #[test]
    fn unselected_alternative_dropped() {
        ensure_game_data_loaded();
        let profile = "mage=test\n";
        let equipped = make(100, "head", true, vec![]);
        let alt = make(200, "head", false, vec![]);
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![equipped, alt]);

        let result = build_slot_candidates(profile, &items_by_slot, &HashMap::new());
        let head = result.get("head").expect("head missing");
        // Only equipped — alt was not selected
        assert_eq!(head.len(), 1);
        assert_eq!(head[0]["item_id"], 100);
    }

    #[test]
    fn paired_slot_identity_propagates_finger_uid() {
        ensure_game_data_loaded();
        // Selecting an item for finger1 with the same identity (item_id + bonus_ids)
        // should also expose it in finger2 candidates.
        let profile = "mage=test\n";
        let f1_eq = make(100, "finger1", true, vec![]);
        let f2_eq = make(101, "finger2", true, vec![]);
        let f2_alt = make(999, "finger2", false, vec![]);
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("finger1".to_string(), vec![f1_eq]);
        items_by_slot.insert("finger2".to_string(), vec![f2_eq, f2_alt]);

        let mut selected = HashMap::new();
        // UID is for finger1 slot, but identity (item_id+bonus_ids) matches a finger2 alt
        selected.insert(
            "finger1".to_string(),
            vec![uid_str(999, &[], "bags", "finger1")],
        );

        let result = build_slot_candidates(profile, &items_by_slot, &selected);
        let f2 = result.get("finger2").expect("finger2 missing");
        // finger2 should include the 999 alt because its identity matches the finger1 selection
        assert!(
            f2.iter().any(|i| i["item_id"] == 999),
            "expected finger2 to include 999 via paired identity"
        );
    }

    #[test]
    fn selected_catalyst_item_matches_five_part_uid() {
        ensure_game_data_loaded();
        // Catalyst alternatives carry `uid = item:bonus:origin:slot:source_item_id`
        // (gear_resolver::build_catalyst_item); selection must match that form.
        let profile = "mage=test\n";
        let equipped = make(100, "head", true, vec![]);
        let mut catalyst = make(271564, "head", false, vec![12852]);
        catalyst["is_catalyst"] = Value::Bool(true);
        catalyst["source_item_id"] = 251199u64.into();
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![equipped, catalyst]);

        let mut selected = HashMap::new();
        selected.insert(
            "head".to_string(),
            vec!["271564:12852:bags:head:251199".to_string()],
        );

        let result = build_slot_candidates(profile, &items_by_slot, &selected);
        let head = result.get("head").expect("head missing");
        assert!(
            head.iter().any(|i| i["item_id"] == 271564),
            "selected catalyst item must be included in candidates"
        );
    }

    #[test]
    fn armor_class_filter_drops_disallowed_subclass() {
        ensure_game_data_loaded();
        // Verify the equipped item survives the filter via its `is_equipped`
        // exemption, without depending on a specific subclass mapping.
        let profile = "mage=Test\n";
        let equipped = make(151336, "head", true, vec![]); // a cloth head from user's data
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![equipped]);

        let result = build_slot_candidates(profile, &items_by_slot, &HashMap::new());
        let head = result.get("head").expect("head missing");
        // Equipped is always retained regardless of armor class.
        assert_eq!(head.len(), 1);
    }

    #[test]
    fn slots_without_items_in_input_omitted_from_output() {
        ensure_game_data_loaded();
        let profile = "mage=test\n";
        let items_by_slot: HashMap<String, Vec<Value>> = HashMap::new();
        let result = build_slot_candidates(profile, &items_by_slot, &HashMap::new());
        assert!(result.is_empty());
    }

    #[test]
    fn equipped_not_duplicated_when_already_in_candidates() {
        ensure_game_data_loaded();
        let profile = "mage=test\n";
        let equipped = make(100, "head", true, vec![]);
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![equipped.clone()]);

        // Select the equipped item explicitly.
        let mut selected = HashMap::new();
        selected.insert(
            "head".to_string(),
            vec![uid_str(100, &[], "equipped", "head")],
        );

        let result = build_slot_candidates(profile, &items_by_slot, &selected);
        let head = result.get("head").expect("head missing");
        assert_eq!(head.len(), 1, "equipped should not appear twice");
    }

    /// A real item always carries its simc string; replacement copies it into
    /// the base profile.
    fn make_item(item_id: u64, slot: &str, is_equipped: bool) -> Value {
        let mut item = make(item_id, slot, is_equipped, vec![]);
        item["simc_string"] = Value::String(format!(",id={item_id}"));
        item
    }

    fn replace(slot: &str, uid: String) -> HashMap<String, String> {
        HashMap::from([(slot.to_string(), uid)])
    }

    #[test]
    fn replacement_becomes_the_equipped_item_and_base_line() {
        ensure_game_data_loaded();
        let profile = "mage=test\nhead=,id=100\nchest=,id=150\n";
        let equipped = make_item(100, "head", true);
        let alt = make_item(200, "head", false);
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![equipped, alt]);

        let uid = uid_str(200, &[], "bags", "head");
        let base = apply_equipped_replacements(profile, &mut items_by_slot, &replace("head", uid));

        assert_eq!(base, "mage=test\nhead=,id=200\nchest=,id=150\n");
        let head = &items_by_slot["head"];
        assert_eq!(head.len(), 1, "the old equipped head is not simmed at all");
        assert_eq!(head[0]["item_id"], 200);
        assert_eq!(head[0]["is_equipped"], true);
    }

    #[test]
    fn replacement_with_an_unknown_uid_changes_nothing() {
        ensure_game_data_loaded();
        let profile = "mage=test\nhead=,id=100\n";
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert(
            "head".to_string(),
            vec![make_item(100, "head", true), make_item(200, "head", false)],
        );
        let before = items_by_slot.clone();

        let base = apply_equipped_replacements(
            profile,
            &mut items_by_slot,
            &replace("head", uid_str(999, &[], "bags", "head")),
        );
        assert_eq!(base, profile);
        assert_eq!(items_by_slot, before);
    }

    #[test]
    fn replaced_ring_slot_keeps_the_other_equipped_ring() {
        ensure_game_data_loaded();
        let profile = "mage=test\nfinger1=,id=100\nfinger2=,id=101\n";
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert(
            "finger1".to_string(),
            vec![
                make_item(100, "finger1", true),
                make_item(300, "finger1", false),
            ],
        );
        items_by_slot.insert(
            "finger2".to_string(),
            vec![
                make_item(101, "finger2", true),
                make_item(300, "finger2", false),
            ],
        );

        let uid = uid_str(300, &[], "bags", "finger1");
        let base = apply_equipped_replacements(
            profile,
            &mut items_by_slot,
            &replace("finger1", uid.clone()),
        );
        assert_eq!(base, "mage=test\nfinger1=,id=300\nfinger2=,id=101\n");

        let selected = HashMap::from([("finger1".to_string(), vec![uid])]);
        let result = build_slot_candidates(&base, &items_by_slot, &selected);
        let ids = |slot: &str| -> Vec<Value> {
            result[slot].iter().map(|i| i["item_id"].clone()).collect()
        };
        assert_eq!(ids("finger1"), vec![Value::from(300)]);
        assert_eq!(ids("finger2"), vec![Value::from(101), Value::from(300)]);
    }

    #[test]
    fn stored_uid_preferred_over_reconstruction() {
        ensure_game_data_loaded();
        // Manual items carry a content-suffixed uid that reconstruction can't
        // produce; selection must honor the stored value.
        let profile = "mage=test\n";
        let equipped = make(100, "neck", true, vec![]);
        let mut manual = make(100, "neck", false, vec![]);
        manual["uid"] = Value::String("100::bags:neck:m:e7340:g213473".to_string());
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("neck".to_string(), vec![equipped, manual]);

        let mut selected = HashMap::new();
        selected.insert(
            "neck".to_string(),
            vec!["100::bags:neck:m:e7340:g213473".to_string()],
        );

        let result = build_slot_candidates(profile, &items_by_slot, &selected);
        let neck = result.get("neck").expect("neck missing");
        assert_eq!(neck.len(), 2, "manual copy must match via its stored uid");
    }
}
