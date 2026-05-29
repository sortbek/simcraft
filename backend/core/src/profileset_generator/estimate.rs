use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// Upper-bound estimate of the profileset count for a Top Gear request,
/// computed in O(axes) time without enumerating any combos. The result
/// is conservative: filters (unique-equipped, vault, weapon, catalyst,
/// item-limit, baseline) only reduce the actual count, so this is safe
/// to use as a gate for "is this job large enough to need Triage?".
pub fn estimate_top_gear_combo_count(
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
    enchant_selections: &HashMap<String, Vec<u64>>,
    gem_options: &[u64],
    socketed_item_ids: &HashSet<u64>,
    talent_builds_count: usize,
) -> u64 {
    let gear_axis = gear_axis_size(items_by_slot, selected_items);
    let enchant_axis = enchant_axis_size(enchant_selections);
    let gem_axis = gem_axis_size_upper_bound(gem_options, socketed_item_ids, items_by_slot);
    let talents = talent_builds_count.max(1) as u64;

    // Spec §1: total = gear × (enchant+1) × (gem+1) × talent
    gear_axis
        .saturating_mul(enchant_axis.saturating_add(1))
        .saturating_mul(gem_axis.saturating_add(1))
        .saturating_mul(talents)
}

fn gear_axis_size(
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
) -> u64 {
    // For each slot in selected_items: number of selected alternatives + 1 (equipped).
    // For each slot NOT in selected_items: 1 (equipped only).
    let mut prod: u64 = 1;
    for slot in items_by_slot.keys() {
        let selected = selected_items.get(slot).map(|v| v.len()).unwrap_or(0);
        let axis = if selected == 0 {
            1
        } else {
            selected as u64 + 1
        };
        prod = prod.saturating_mul(axis);
    }
    prod
}

fn enchant_axis_size(enchant_selections: &HashMap<String, Vec<u64>>) -> u64 {
    // Product over slots, each axis is options.len() + 1 for equipped baseline.
    let mut prod: u64 = 1;
    for opts in enchant_selections.values() {
        if !opts.is_empty() {
            prod = prod.saturating_mul(opts.len() as u64 + 1);
        }
    }
    // -1 because the all-equipped baseline is subtracted elsewhere.
    prod.saturating_sub(1)
}

fn gem_axis_size_upper_bound(
    gem_options: &[u64],
    socketed_item_ids: &HashSet<u64>,
    items_by_slot: &HashMap<String, Vec<Value>>,
) -> u64 {
    if gem_options.is_empty() {
        return 0;
    }
    // Upper bound: count slots that contain at least one item which CAN have sockets.
    let mut socketed_slots: u64 = 0;
    for items in items_by_slot.values() {
        let any_socketed = items.iter().any(|it| {
            it.get("item_id")
                .and_then(|v| v.as_u64())
                .map(|id| socketed_item_ids.contains(&id))
                .unwrap_or(false)
        });
        if any_socketed {
            socketed_slots += 1;
        }
    }
    if socketed_slots == 0 {
        return 0;
    }
    // gem_options^socketed_slots is the cartesian upper bound.
    let mut prod: u64 = 1;
    let g = gem_options.len() as u64;
    for _ in 0..socketed_slots {
        prod = prod.saturating_mul(g);
        if prod == u64::MAX {
            break;
        }
    }
    prod
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_item(item_id: u64) -> Value {
        json!({ "item_id": item_id, "simc_string": format!(",id={}", item_id) })
    }

    #[test]
    fn no_alternatives_gives_count_one() {
        let mut items = HashMap::new();
        items.insert("head".to_string(), vec![make_item(1)]);
        let selected = HashMap::new();
        let count = estimate_top_gear_combo_count(
            &items,
            &selected,
            &HashMap::new(),
            &[],
            &HashSet::new(),
            1,
        );
        assert_eq!(count, 1);
    }

    #[test]
    fn gear_only_axis() {
        // 2 selectable alternatives in head -> axis 3 (2 selected + 1 equipped)
        let mut items = HashMap::new();
        items.insert(
            "head".to_string(),
            vec![make_item(1), make_item(2), make_item(3)],
        );
        let mut selected = HashMap::new();
        selected.insert("head".to_string(), vec!["2".to_string(), "3".to_string()]);
        let count = estimate_top_gear_combo_count(
            &items,
            &selected,
            &HashMap::new(),
            &[],
            &HashSet::new(),
            1,
        );
        assert_eq!(count, 3);
    }

    #[test]
    fn talent_axis_multiplies() {
        let mut items = HashMap::new();
        items.insert("head".to_string(), vec![make_item(1), make_item(2)]);
        let mut selected = HashMap::new();
        selected.insert("head".to_string(), vec!["2".to_string()]);
        let count = estimate_top_gear_combo_count(
            &items,
            &selected,
            &HashMap::new(),
            &[],
            &HashSet::new(),
            3,
        );
        assert_eq!(count, 2 * 3);
    }

    #[test]
    fn does_not_overflow_on_huge_input() {
        // 30 slots, each with 10 alternatives, plus 10 gems on 10 socketed slots.
        let mut items = HashMap::new();
        let mut selected = HashMap::new();
        for i in 0..30 {
            let slot = format!("slot_{i}");
            items.insert(slot.clone(), (0..10).map(make_item).collect());
            selected.insert(slot, (1..10).map(|n| n.to_string()).collect());
        }
        let count = estimate_top_gear_combo_count(
            &items,
            &selected,
            &HashMap::new(),
            &[],
            &HashSet::new(),
            1,
        );
        // 10^30 is way beyond u64::MAX; estimator must saturate, not panic.
        assert_eq!(count, u64::MAX);
    }
}
