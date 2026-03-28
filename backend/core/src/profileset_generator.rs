use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use crate::game_data;
use crate::types::class_data::{self, ARMOR_SLOTS, GEAR_SLOTS, UNIQUE_SLOT_PAIRS};

use once_cell::sync::Lazy;

type ProfilesetResult = Result<(String, usize, HashMap<String, Vec<Value>>), String>;

/// Maximum gear combinations for Top Gear. Override with MAX_COMBINATIONS env var.
pub static MAX_COMBINATIONS: Lazy<usize> = Lazy::new(|| {
    if let Ok(val) = std::env::var("MAX_COMBINATIONS") {
        if let Ok(n) = val.parse() {
            return n;
        }
    }
    500
});

/// Build a UID from a legacy item JSON Value, matching gear_resolver::make_uid format:
/// "item_id:sorted_bonus_ids:origin:slot"
fn make_item_uid(item: &Value) -> String {
    let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
    let mut bonus_ids: Vec<u64> = item
        .get("bonus_ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
        .unwrap_or_default();
    bonus_ids.sort();
    let bonus_key = bonus_ids
        .iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(":");
    let origin = item
        .get("origin")
        .and_then(|v| v.as_str())
        .unwrap_or("bags");
    let slot = item.get("slot").and_then(|v| v.as_str()).unwrap_or("");
    format!("{}:{}:{}:{}", item_id, bonus_key, origin, slot)
}

/// Generate a simc input string with full-set profilesets for Top Gear.
///
/// Returns (simc_input_string, combination_count, combo_metadata).
/// combo_metadata maps "Combo N" -> list of item metadata values.
pub fn generate_top_gear_input(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
    max_combos_override: Option<usize>,
) -> ProfilesetResult {
    // Extract base profile info (non-gear lines) and equipped gear
    let (base_lines, equipped_gear, talents_string, spec) = parse_base_profile(base_profile);

    let slot_item_lists = build_slot_candidates(base_profile, items_by_slot, selected_items);

    // Find slots that have alternatives (more than just equipped)
    let varying_slots: Vec<String> = slot_item_lists
        .iter()
        .filter(|(_, items)| items.len() > 1)
        .map(|(slot, _)| slot.clone())
        .collect();

    // Sort for deterministic ordering
    let mut varying_slots = varying_slots;
    varying_slots.sort();

    if varying_slots.is_empty() {
        return Ok((base_profile.to_string(), 0, HashMap::new()));
    }

    // Build cartesian product across varying slots
    let option_lists: Vec<&Vec<Value>> = varying_slots
        .iter()
        .map(|slot| slot_item_lists.get(slot).unwrap())
        .collect();

    // Generate all combos via iterative cartesian product
    let mut all_combos: Vec<Vec<usize>> = vec![vec![]];
    for opts in &option_lists {
        let mut new_combos = Vec::new();
        for combo in &all_combos {
            for i in 0..opts.len() {
                let mut new = combo.clone();
                new.push(i);
                new_combos.push(new);
            }
        }
        all_combos = new_combos;
    }

    // Filter invalid combos and build gear sets
    let mut valid_combos: Vec<HashMap<String, Value>> = Vec::new();

    for combo_indices in &all_combos {
        // Build full gear set: start with equipped, override varying slots
        let mut gear_set: HashMap<String, Value> = HashMap::new();
        for slot in GEAR_SLOTS {
            let slot = slot.to_string();
            if let Some(items) = slot_item_lists.get(&slot) {
                // Use equipped item as default
                let default = items
                    .iter()
                    .find(|it| {
                        it.get("is_equipped")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false)
                    })
                    .unwrap_or(&items[0]);
                gear_set.insert(slot, default.clone());
            }
        }

        // Apply the combo choices
        for (i, slot) in varying_slots.iter().enumerate() {
            let item = &option_lists[i][combo_indices[i]];
            gear_set.insert(slot.clone(), item.clone());
        }

        // Validate unique-equipped constraints
        if !validate_unique_equipped(&gear_set) {
            continue;
        }

        // Vault constraint: only one vault item can be picked
        if !validate_vault_constraint(&gear_set) {
            continue;
        }

        // Weapon constraint: two-hander in main_hand cannot pair with off_hand
        if !validate_weapon_constraint(&gear_set, &spec) {
            continue;
        }

        // Check if this is identical to baseline (all equipped)
        let is_baseline = GEAR_SLOTS.iter().all(|slot| {
            gear_set
                .get(*slot)
                .and_then(|item| item.get("is_equipped"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true)
        });
        if is_baseline {
            continue;
        }

        valid_combos.push(gear_set);
    }

    let combo_count = valid_combos.len();
    let limit = max_combos_override.unwrap_or(*MAX_COMBINATIONS);
    if combo_count > limit {
        return Err(format!(
            "Too many combinations ({}). Maximum is {}. Please deselect some items.",
            combo_count, limit
        ));
    }

    if combo_count == 0 {
        return Ok((base_profile.to_string(), 0, HashMap::new()));
    }

    // Build output: base profile as Combo 1, then profilesets
    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: HashMap<String, Vec<Value>> = HashMap::new();

    // Write clean base profile (non-gear lines + equipped gear)
    lines.push("# Base Actor".to_string());
    lines.extend(base_lines.clone());
    lines.push("### Combo 1".to_string());
    for slot in GEAR_SLOTS {
        let slot_str = slot.to_string();
        if let Some(gear_val) = equipped_gear.get(&slot_str) {
            lines.push(format!("{}={}", slot, gear_val));
        } else if *slot == "off_hand" {
            lines.push("off_hand=,".to_string());
        }
    }
    if !talents_string.is_empty() {
        lines.push(format!("talents={}", talents_string));
    }
    lines.push(String::new());

    // Build baseline metadata for "Currently Equipped"
    let paired_display_slots = ["finger1", "finger2", "trinket1", "trinket2"];
    let mut baseline_items: Vec<Value> = Vec::new();
    for slot in &paired_display_slots {
        let slot = slot.to_string();
        if let Some(items) = slot_item_lists.get(&slot) {
            if !items.is_empty() {
                baseline_items.push(item_meta(&items[0], &slot));
            }
        }
    }
    combo_metadata.insert("Currently Equipped".to_string(), baseline_items);

    // Generate profilesets for each combo
    for (combo_idx, gear_set) in valid_combos.iter().enumerate() {
        let combo_name = format!("Combo {}", combo_idx + 2);
        lines.push(format!("### {}", combo_name));

        let mut combo_mh_is_two_hand = false;
        for slot in GEAR_SLOTS {
            let slot_str = slot.to_string();
            if let Some(item) = gear_set.get(&slot_str) {
                // If main_hand is a two-hander, clear off_hand instead of outputting it
                if *slot == "main_hand" {
                    let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
                    let bonus_ids: Vec<u64> = item
                        .get("bonus_ids")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
                        .unwrap_or_default();
                    let inv_type = game_data::get_item_info(item_id, Some(&bonus_ids))
                        .and_then(|info| info.get("inventory_type").and_then(|v| v.as_u64()))
                        .unwrap_or(0);
                    if inv_type == 17 && spec != "fury" {
                        combo_mh_is_two_hand = true;
                    }
                }
                if *slot == "off_hand" && combo_mh_is_two_hand {
                    lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
                } else {
                    let simc_str = item
                        .get("simc_string")
                        .and_then(|s| s.as_str())
                        .unwrap_or("");
                    lines.push(format!(
                        "profileset.\"{}\"+={}={}",
                        combo_name, slot, simc_str
                    ));
                }
            } else if *slot == "off_hand" {
                lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
            }
        }

        if !talents_string.is_empty() {
            lines.push(format!(
                "profileset.\"{}\"+=talents={}",
                combo_name, talents_string
            ));
        }
        lines.push(String::new());

        // Build metadata: track paired slots + changed non-paired slots
        let mut combo_items: Vec<Value> = Vec::new();
        for slot in &paired_display_slots {
            let slot = slot.to_string();
            if let Some(item) = gear_set.get(&slot) {
                let mut meta = item_meta(item, &slot);
                meta["is_kept"] = json!(item
                    .get("is_equipped")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false));
                combo_items.push(meta);
            }
        }

        // Also include non-paired slots that changed
        for slot in GEAR_SLOTS {
            if paired_display_slots.contains(slot) {
                continue;
            }
            let slot_str = slot.to_string();
            if let Some(item) = gear_set.get(&slot_str) {
                let is_equipped = item
                    .get("is_equipped")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                if !is_equipped {
                    combo_items.push(item_meta(item, &slot_str));
                }
            }
        }

        combo_metadata.insert(combo_name, combo_items);
    }

    Ok((lines.join("\n"), combo_count, combo_metadata))
}

fn parse_base_profile(
    base_profile: &str,
) -> (Vec<String>, HashMap<String, String>, String, String) {
    let mut non_gear_lines: Vec<String> = Vec::new();
    let mut equipped_gear: HashMap<String, String> = HashMap::new();
    let mut talents_string = String::new();
    let mut spec_string = String::new();

    let gear_pattern = format!(r"^({})=(.*)", GEAR_SLOTS.join("|"));
    let gear_re = Regex::new(&gear_pattern).unwrap();
    let talents_re = Regex::new(r"^talents=(.+)").unwrap();
    let spec_re = Regex::new(r"^spec=(\w+)").unwrap();

    for line in base_profile.lines() {
        let stripped = line.trim();
        if stripped.is_empty() {
            continue;
        }

        // Extract talents
        if let Some(caps) = talents_re.captures(stripped) {
            talents_string = caps[1].to_string();
            continue;
        }

        // Extract spec
        if let Some(caps) = spec_re.captures(stripped) {
            spec_string = caps[1].to_lowercase();
        }

        // Extract gear lines
        if let Some(caps) = gear_re.captures(stripped) {
            let slot = caps[1].to_lowercase();
            let value = caps[2].to_string();
            equipped_gear.insert(slot, value);
            continue;
        }

        // Keep everything else
        non_gear_lines.push(stripped.to_string());
    }

    (non_gear_lines, equipped_gear, talents_string, spec_string)
}

fn item_meta(item: &Value, slot: &str) -> Value {
    json!({
        "slot": slot,
        "item_id": item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0),
        "ilevel": item.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0),
        "name": item.get("name").and_then(|v| v.as_str()).unwrap_or(""),
        "bonus_ids": item.get("bonus_ids").cloned().unwrap_or(json!([])),
        "enchant_id": item.get("enchant_id").and_then(|v| v.as_u64()).unwrap_or(0),
        "gem_id": item.get("gem_id").and_then(|v| v.as_u64()).unwrap_or(0),
        "is_kept": item.get("is_equipped").and_then(|v| v.as_bool()).unwrap_or(false),
        "origin": item.get("origin").and_then(|v| v.as_str()).unwrap_or("bags"),
    })
}

// can_dual_wield and inv_type_to_slots now live in types::class_data

pub fn generate_droptimizer_input(
    base_profile: &str,
    drop_items: &[Value],
) -> (String, usize, HashMap<String, Value>) {
    let (base_lines, equipped_gear, talents_string, spec) = parse_base_profile(base_profile);

    let mut lines: Vec<String> = Vec::new();
    let mut combo_metadata: HashMap<String, Value> = HashMap::new();

    // Write base profile
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

    // Detect if currently using a two-hander (no off-hand or empty off-hand)
    let has_two_hand_equipped = {
        let oh = equipped_gear.get("off_hand").map(|s| s.trim());
        oh.is_none() || oh == Some("") || oh == Some(",")
    };

    // Extract enchant/runeforge from equipped gear to copy onto drop items.
    // Gems are NOT copied because drop items may not have sockets.
    let enchant_re = Regex::new(r"(enchant_id=\d+)").unwrap();

    let mut combo_idx = 2usize;
    for item in drop_items {
        let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
        let ilevel = item.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0);
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let encounter = item
            .get("encounter")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let inv_type = item
            .get("inventory_type")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let bonus_ids: Vec<u64> = item
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
            .unwrap_or_default();
        let mut slots = class_data::inv_type_to_slots(inv_type, &spec);

        // If the character has a two-hander equipped, nothing can go in the
        // off-hand — except two-handers for Fury warriors (Titan's Grip).
        if has_two_hand_equipped && !(spec == "fury" && inv_type == 17) {
            slots.retain(|s| *s != "off_hand");
        }

        if slots.is_empty() {
            continue;
        }

        let mut base_simc_str = format!(",id={},ilevel={}", item_id, ilevel);
        if !bonus_ids.is_empty() {
            let bonus_str = bonus_ids
                .iter()
                .map(|b| b.to_string())
                .collect::<Vec<_>>()
                .join("/");
            base_simc_str.push_str(&format!(",bonus_id={}", bonus_str));
        }

        for slot in &slots {
            // Copy enchants/gems from the currently equipped item in this slot
            let mut simc_str = base_simc_str.clone();
            if let Some(equipped) = equipped_gear.get(*slot) {
                if let Some(caps) = enchant_re.captures(equipped) {
                    simc_str.push_str(&format!(",{}", &caps[1]));
                }
            }

            let combo_name = format!("Combo {}", combo_idx);
            lines.push(format!("### {}", combo_name));
            lines.push(format!(
                "profileset.\"{}\"+={}={}",
                combo_name, slot, simc_str
            ));
            if inv_type == 17 && *slot == "main_hand" && spec != "fury" {
                lines.push(format!("profileset.\"{}\"+=off_hand=,", combo_name));
            }
            if !talents_string.is_empty() {
                lines.push(format!(
                    "profileset.\"{}\"+=talents={}",
                    combo_name, talents_string
                ));
            }
            lines.push(String::new());

            combo_metadata.insert(
                combo_name.clone(),
                json!([{
                    "slot": slot,
                    "item_id": item_id,
                    "ilevel": ilevel,
                    "name": name,
                    "bonus_ids": bonus_ids,
                    "enchant_id": 0,
                    "gem_id": 0,
                    "is_kept": false,
                    "encounter": encounter,
                }]),
            );
            combo_idx += 1;
        }
    }

    let combo_count = combo_idx - 2;
    (lines.join("\n"), combo_count, combo_metadata)
}

// ---- Upgrade Compare ----

/// Generate profileset input for upgrade comparison.
///
/// Uses DFS to enumerate all valid combinations of item upgrades
/// within the given currency budget. Each combination is a profileset
/// where selected items are upgraded to different levels.
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

    let limit = max_combos_override.unwrap_or(*MAX_COMBINATIONS);

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

                if self.retained.len() > self.limit * 2 {
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

    if retained.len() > limit {
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

/// Vault constraint: at most one vault item across all slots.
/// An item and its upgraded copy (same item_id) count as a single vault pick.
fn validate_vault_constraint(gear_set: &HashMap<String, Value>) -> bool {
    let mut vault_item_ids: HashSet<u64> = HashSet::new();
    for item in gear_set.values() {
        if item.get("origin").and_then(|v| v.as_str()) == Some("vault") {
            let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            vault_item_ids.insert(item_id);
            if vault_item_ids.len() > 1 {
                return false;
            }
        }
    }
    true
}

/// Weapon constraint: a two-hander (inventory_type 17) in main_hand cannot be
/// paired with an off_hand item, unless the spec is fury (Titan's Grip).
fn validate_weapon_constraint(gear_set: &HashMap<String, Value>, spec: &str) -> bool {
    if spec == "fury" {
        return true;
    }
    let Some(mh) = gear_set.get("main_hand") else {
        return true;
    };
    let mh_item_id = mh.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
    if mh_item_id == 0 {
        return true;
    }
    let mh_bonus_ids: Vec<u64> = mh
        .get("bonus_ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
        .unwrap_or_default();
    let inv_type = game_data::get_item_info(mh_item_id, Some(&mh_bonus_ids))
        .and_then(|info| info.get("inventory_type").and_then(|v| v.as_u64()))
        .unwrap_or(0);
    if inv_type != 17 {
        return true;
    }
    // Main hand is a two-hander — off_hand must be empty
    let oh = gear_set.get("off_hand");
    match oh {
        None => true,
        Some(oh_item) => {
            let oh_id = oh_item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            oh_id == 0
        }
    }
}

/// Count valid Top Gear combinations without generating the full simc output.
pub fn count_top_gear_combos(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
    max_combos_override: Option<usize>,
) -> Result<usize, String> {
    let (_, _, _, spec) = parse_base_profile(base_profile);
    let slot_item_lists = build_slot_candidates(base_profile, items_by_slot, selected_items);
    count_valid_combos(&slot_item_lists, max_combos_override, &spec)
}

/// Build per-slot candidate lists from items_by_slot and selected UIDs.
fn build_slot_candidates(
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

        let selected_uids = selected_items.get(&slot).cloned().unwrap_or_default();

        let mut candidates: Vec<Value> = Vec::new();
        for item in slot_items {
            let uid = make_item_uid(item);
            if selected_uids.contains(&uid) {
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

    // Armor type filtering
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

/// Count valid combos from slot candidate lists, applying all constraints.
fn count_valid_combos(
    slot_item_lists: &HashMap<String, Vec<Value>>,
    max_combos_override: Option<usize>,
    spec: &str,
) -> Result<usize, String> {
    let mut varying_slots: Vec<String> = slot_item_lists
        .iter()
        .filter(|(_, items)| items.len() > 1)
        .map(|(slot, _)| slot.clone())
        .collect();
    varying_slots.sort();

    if varying_slots.is_empty() {
        return Ok(0);
    }

    let option_lists: Vec<&Vec<Value>> = varying_slots
        .iter()
        .map(|slot| slot_item_lists.get(slot).unwrap())
        .collect();

    // Early check: bail before allocating if the raw cartesian product is too large
    let limit = max_combos_override.unwrap_or(*MAX_COMBINATIONS);
    let raw_total: usize = option_lists
        .iter()
        .try_fold(1usize, |acc, opts| acc.checked_mul(opts.len()))
        .unwrap_or(usize::MAX);
    if raw_total > limit * 10 {
        return Err(format!(
            "Too many gear combinations to evaluate ({}). Maximum is {}. Please deselect some items.",
            raw_total, limit
        ));
    }

    let mut all_combos: Vec<Vec<usize>> = vec![vec![]];
    for opts in &option_lists {
        let mut new_combos = Vec::new();
        for combo in &all_combos {
            for i in 0..opts.len() {
                let mut new = combo.clone();
                new.push(i);
                new_combos.push(new);
            }
        }
        all_combos = new_combos;
    }

    let mut count = 0usize;
    for combo_indices in &all_combos {
        let mut gear_set: HashMap<String, Value> = HashMap::new();
        for slot in GEAR_SLOTS {
            let slot = slot.to_string();
            if let Some(items) = slot_item_lists.get(&slot) {
                let default = items
                    .iter()
                    .find(|it| {
                        it.get("is_equipped")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false)
                    })
                    .unwrap_or(&items[0]);
                gear_set.insert(slot, default.clone());
            }
        }

        for (i, slot) in varying_slots.iter().enumerate() {
            let item = &option_lists[i][combo_indices[i]];
            gear_set.insert(slot.clone(), item.clone());
        }

        if !validate_unique_equipped(&gear_set) {
            continue;
        }
        if !validate_vault_constraint(&gear_set) {
            continue;
        }
        if !validate_weapon_constraint(&gear_set, spec) {
            continue;
        }

        let is_baseline = GEAR_SLOTS.iter().all(|slot| {
            gear_set
                .get(*slot)
                .and_then(|item| item.get("is_equipped"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true)
        });
        if is_baseline {
            continue;
        }

        count += 1;
    }

    if count > limit {
        return Err(format!(
            "Too many combinations ({}). Maximum is {}. Please deselect some items.",
            count, limit
        ));
    }

    Ok(count)
}

fn validate_unique_equipped(gear_set: &HashMap<String, Value>) -> bool {
    for (slot1, slot2) in UNIQUE_SLOT_PAIRS {
        let item1 = gear_set.get(*slot1);
        let item2 = gear_set.get(*slot2);
        if let (Some(i1), Some(i2)) = (item1, item2) {
            let id1 = i1.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            let id2 = i2.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
            if id1 != 0 && id2 != 0 && id1 == id2 {
                return false;
            }
        }
    }
    true
}
