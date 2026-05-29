use serde_json::{json, Value};
use std::collections::HashMap;

use super::base_profile::{item_meta, parse_base_profile};
use super::{ProfilesetResult, MAX_COMBINATIONS};
use crate::types::class_data::GEAR_SLOTS;

pub fn generate_upgrade_compare_input(
    base_profile: &str,
    upgraded_options_by_slot: &HashMap<String, Vec<Value>>,
    upgrade_budget: &HashMap<u64, u64>,
    max_combos_override: Option<usize>,
) -> ProfilesetResult {
    let (base_lines, equipped_gear, talents_string, _spec) = parse_base_profile(base_profile);

    let mut slots: Vec<String> = upgraded_options_by_slot
        .keys()
        .filter(|s| !upgraded_options_by_slot[*s].is_empty())
        .cloned()
        .collect();
    slots.sort();
    if slots.is_empty() {
        return Err("No upgradeable equipped items were selected.".to_string());
    }

    let limit =
        max_combos_override.unwrap_or(MAX_COMBINATIONS.load(std::sync::atomic::Ordering::Relaxed));

    // DFS: explore upgrade choices per slot within budget
    struct Combo {
        choices: Vec<(String, usize)>, // (slot, option_index)
    }

    struct DfsCtx<'a> {
        slots: &'a [String],
        options: &'a HashMap<String, Vec<Value>>,
        budget: &'a HashMap<u64, u64>,
        limit: usize,
        best_spend: u64,
        retained: Vec<Combo>,
        spent: HashMap<u64, u64>,
        current: Vec<(String, usize)>,
    }

    impl DfsCtx<'_> {
        fn within_budget(&self, cost: &HashMap<u64, u64>) -> bool {
            cost.iter().all(|(cid, amount)| {
                let next = self.spent.get(cid).copied().unwrap_or(0) + amount;
                next <= self.budget.get(cid).copied().unwrap_or(0)
            })
        }

        fn dfs(&mut self, idx: usize) {
            if idx == self.slots.len() {
                let total: u64 = self.spent.values().sum();
                if total > self.best_spend {
                    self.best_spend = total;
                    self.retained.clear();
                }
                if total >= self.best_spend {
                    self.retained.push(Combo {
                        choices: self.current.clone(),
                    });
                }
                return;
            }

            let slot = self.slots[idx].clone();
            let slot_opts: Option<Vec<Value>> = self.options.get(&slot).cloned();

            let Some(slot_opts) = slot_opts else {
                self.current.push((slot, 0));
                self.dfs(idx + 1);
                self.current.pop();
                return;
            };

            // Option 0: keep current (no upgrade)
            self.current.push((slot.clone(), 0));
            self.dfs(idx + 1);
            self.current.pop();

            // Options 1..N: upgrade to each level
            for (i, opt) in slot_opts.iter().enumerate() {
                let costs: HashMap<u64, u64> = opt
                    .get("upgrade_costs")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();

                if !self.within_budget(&costs) {
                    continue;
                }

                for (cid, amount) in &costs {
                    *self.spent.entry(*cid).or_insert(0) += amount;
                }
                self.current.push((slot.clone(), i + 1));

                self.dfs(idx + 1);

                self.current.pop();
                for (cid, amount) in &costs {
                    let entry = self.spent.entry(*cid).or_insert(0);
                    *entry = entry.saturating_sub(*amount);
                }

                if self.limit > 0 && self.retained.len() > self.limit * 2 {
                    return;
                }
            }
        }
    }

    let mut ctx = DfsCtx {
        slots: &slots,
        options: upgraded_options_by_slot,
        budget: upgrade_budget,
        limit,
        best_spend: 0,
        retained: Vec::new(),
        spent: HashMap::new(),
        current: Vec::new(),
    };
    ctx.dfs(0);

    let retained = ctx.retained;

    if limit > 0 && retained.len() > limit {
        return Err(format!(
            "Too many upgrade combinations ({}). Maximum is {}. Please deselect some items.",
            retained.len(),
            limit
        ));
    }

    // Build profileset output
    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: HashMap<String, Vec<Value>> = HashMap::new();

    // Base actor
    lines.push("# Base Actor".to_string());
    lines.extend(base_lines);
    lines.push("### Combo 1".to_string());
    for slot in GEAR_SLOTS {
        if let Some(gear) = equipped_gear.get(*slot) {
            lines.push(format!("{}={}", slot, gear));
        } else if *slot == "off_hand" {
            lines.push("off_hand=,".to_string());
        }
    }
    if !talents_string.is_empty() {
        lines.push(format!("talents={}", talents_string));
    }
    lines.push(String::new());

    let mut combo_idx = 2usize;

    for combo in &retained {
        // Check if all choices are "keep" (no upgrades)
        if combo.choices.iter().all(|(_, idx)| *idx == 0) {
            continue;
        }

        let combo_name = format!("Combo {}", combo_idx);
        let mut items_meta: Vec<Value> = Vec::new();

        lines.push(format!("### {}", combo_name));

        for (slot, choice_idx) in &combo.choices {
            if *choice_idx == 0 {
                continue; // Keep equipped
            }
            let opt = &upgraded_options_by_slot[slot][*choice_idx - 1];
            let simc = opt
                .get("simc_string")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !simc.is_empty() {
                lines.push(format!("profileset.\"{}\"+={}={}", combo_name, slot, simc));
            }

            let mut meta = item_meta(opt, slot);
            meta["is_kept"] = json!(false);
            meta["upgrade_levels"] = opt.get("upgrade_levels").cloned().unwrap_or(json!(0));
            items_meta.push(meta);
        }

        if !talents_string.is_empty() {
            lines.push(format!(
                "profileset.\"{}\"+=talents={}",
                combo_name, talents_string
            ));
        }
        lines.push(String::new());

        combo_metadata.insert(combo_name, items_meta);
        combo_idx += 1;
    }

    let combo_count = combo_idx - 2;
    Ok((lines.join("\n"), combo_count, combo_metadata))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn option(simc_str: &str, costs: HashMap<u64, u64>, levels: u64) -> Value {
        json!({
            "simc_string": simc_str,
            "upgrade_costs": costs,
            "upgrade_levels": levels,
            "item_id": 100,
            "ilevel": 600,
            "name": "Upgraded",
            "bonus_ids": [],
            "enchant_id": 0,
            "gem_id": 0,
        })
    }

    #[test]
    fn returns_error_when_no_slot_options() {
        let result = generate_upgrade_compare_input(
            "mage=test\nhead=,id=100\n",
            &HashMap::new(),
            &HashMap::new(),
            Some(10),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No upgradeable"));
    }

    #[test]
    fn returns_error_when_all_slots_empty() {
        let mut options = HashMap::new();
        options.insert("head".to_string(), vec![]);
        let result = generate_upgrade_compare_input(
            "mage=test\nhead=,id=100\n",
            &options,
            &HashMap::new(),
            Some(10),
        );
        assert!(result.is_err());
    }

    #[test]
    fn single_slot_single_upgrade_emits_one_combo() {
        let mut options = HashMap::new();
        options.insert(
            "head".to_string(),
            vec![option(
                ",id=100,bonus_id=200",
                HashMap::from([(1u64, 10u64)]),
                1,
            )],
        );
        let mut budget = HashMap::new();
        budget.insert(1, 10);

        let (input, count, metadata) = generate_upgrade_compare_input(
            "mage=test\nhead=,id=100\n",
            &options,
            &budget,
            Some(10),
        )
        .unwrap();
        assert_eq!(count, 1);
        assert!(input.contains("profileset.\"Combo 2\"+=head=,id=100,bonus_id=200"));
        assert!(metadata.contains_key("Combo 2"));
    }

    #[test]
    fn upgrade_excluded_when_over_budget() {
        let mut options = HashMap::new();
        options.insert(
            "head".to_string(),
            vec![option(
                ",id=100,bonus_id=200",
                HashMap::from([(1u64, 100u64)]),
                1,
            )],
        );
        let mut budget = HashMap::new();
        budget.insert(1, 10); // budget 10, cost 100 — over budget

        let result = generate_upgrade_compare_input(
            "mage=test\nhead=,id=100\n",
            &options,
            &budget,
            Some(10),
        )
        .unwrap();
        // No upgrade fits — only "keep" combo, which is filtered out.
        assert_eq!(result.1, 0);
    }

    #[test]
    fn dfs_prunes_to_max_budget_spend() {
        // Two slots; budget allows upgrading exactly one of them.
        let mut options = HashMap::new();
        options.insert(
            "head".to_string(),
            vec![option(
                ",id=100,bonus_id=200",
                HashMap::from([(1u64, 5u64)]),
                1,
            )],
        );
        options.insert(
            "chest".to_string(),
            vec![option(
                ",id=101,bonus_id=300",
                HashMap::from([(1u64, 5u64)]),
                1,
            )],
        );
        let mut budget = HashMap::new();
        budget.insert(1, 5); // can only afford one upgrade

        let (input, count, _) = generate_upgrade_compare_input(
            "mage=test\nhead=,id=100\nchest=,id=101\n",
            &options,
            &budget,
            Some(20),
        )
        .unwrap();
        // Best spend = 5 (either head or chest, not both).
        // DFS retains all max-spend combos: 2.
        assert_eq!(count, 2);
        assert!(
            input.contains("head=,id=100,bonus_id=200")
                || input.contains("chest=,id=101,bonus_id=300")
        );
    }

    #[test]
    fn upgrade_compare_baseline_in_input() {
        let mut options = HashMap::new();
        options.insert(
            "head".to_string(),
            vec![option(
                ",id=100,bonus_id=200",
                HashMap::from([(1u64, 5u64)]),
                1,
            )],
        );
        let mut budget = HashMap::new();
        budget.insert(1, 5);

        let (input, _, _) = generate_upgrade_compare_input(
            "mage=test\nhead=,id=100\n",
            &options,
            &budget,
            Some(10),
        )
        .unwrap();
        assert!(
            input.contains("### Combo 1"),
            "missing baseline combo header"
        );
        assert!(
            input.contains("head=,id=100\n"),
            "baseline should show equipped head"
        );
    }

    #[test]
    fn upgrade_metadata_marks_not_kept_and_carries_levels() {
        let mut options = HashMap::new();
        options.insert(
            "head".to_string(),
            vec![option(
                ",id=100,bonus_id=200",
                HashMap::from([(1u64, 5u64)]),
                3, // upgrade_levels = 3
            )],
        );
        let mut budget = HashMap::new();
        budget.insert(1, 5);

        let (_, _, metadata) = generate_upgrade_compare_input(
            "mage=test\nhead=,id=100\n",
            &options,
            &budget,
            Some(10),
        )
        .unwrap();
        let combo = metadata.get("Combo 2").expect("missing combo");
        let head_meta = combo
            .iter()
            .find(|i| i["slot"] == "head")
            .expect("missing head meta");
        assert_eq!(head_meta["is_kept"], false);
        assert_eq!(head_meta["upgrade_levels"], 3);
    }
}
