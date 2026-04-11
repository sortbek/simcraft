use regex::Regex;
use std::collections::HashMap;

use crate::types::class_data::{self, GEAR_SLOTS};
use crate::types::{CharacterInfo, ItemOrigin, ParseResult, RawParsedItem, TalentLoadout};

struct ItemProps {
    item_id: u64,
    ilevel: u64,
    name: String,
    bonus_ids: Vec<u64>,
    enchant_id: u64,
    gem_id: u64,
}

fn parse_item_props(item_str: &str) -> ItemProps {
    let mut props = ItemProps {
        item_id: 0,
        ilevel: 0,
        name: String::new(),
        bonus_ids: Vec::new(),
        enchant_id: 0,
        gem_id: 0,
    };

    if let Some(caps) = Regex::new(r"id=(\d+)").unwrap().captures(item_str) {
        props.item_id = caps[1].parse().unwrap_or(0);
    }
    if let Some(caps) = Regex::new(r"(?:ilevel|ilvl)=(\d+)")
        .unwrap()
        .captures(item_str)
    {
        props.ilevel = caps[1].parse().unwrap_or(0);
    }
    if let Some(caps) = Regex::new(r"bonus_id=([0-9/:]+)")
        .unwrap()
        .captures(item_str)
    {
        props.bonus_ids = caps[1]
            .split(&['/', ':'][..])
            .filter_map(|s| s.parse().ok())
            .collect();
    }
    if let Some(caps) = Regex::new(r"enchant_id=(\d+)").unwrap().captures(item_str) {
        props.enchant_id = caps[1].parse().unwrap_or(0);
    }
    if let Some(caps) = Regex::new(r"gem_id=(\d+)").unwrap().captures(item_str) {
        props.gem_id = caps[1].parse().unwrap_or(0);
    }
    if let Some(caps) = Regex::new(r"name=([^,]+)").unwrap().captures(item_str) {
        props.name = class_data::title_case(&caps[1].replace('_', " "));
    }
    if props.name.is_empty() {
        if let Some(caps) = Regex::new(r"^([a-z_]+),").unwrap().captures(item_str) {
            props.name = class_data::title_case(&caps[1].replace('_', " "));
        }
    }
    props
}

/// Parse simc addon text into a flat list of items + character info.
///
/// This is a PURE parser: no slot assignment, no crossover, no dedup, no filtering.
/// Those responsibilities belong to `gear_resolver`.
pub fn parse_simc_input(simc_input: &str) -> ParseResult {
    let slot_pattern = format!(r"^({})=(.*)", GEAR_SLOTS.join("|"));
    let slot_re = Regex::new(&slot_pattern).unwrap();
    let header_re = Regex::new(r"^#+\s*(.+?)\s*\(?(\d+)\)?\s*$").unwrap();
    let talents_re = Regex::new(r"^talents=(.+)").unwrap();

    let character = CharacterInfo {
        class_name: class_data::detect_class(simc_input),
        spec: class_data::detect_spec(simc_input),
    };

    let mut items: Vec<RawParsedItem> = Vec::new();
    let mut base_profile_lines: Vec<String> = Vec::new();
    let mut talent_loadouts: Vec<TalentLoadout> = Vec::new();
    let mut pending_name = String::new();
    let mut pending_ilevel: u64 = 0;
    let mut in_vault_section = false;
    let mut in_loot_section = false;
    let mut pending_label = String::new();

    for raw_line in simc_input.lines() {
        let stripped = raw_line.trim();

        if stripped.starts_with('#') {
            let clean = stripped.trim_start_matches('#').trim();

            // Vault section boundaries
            if clean.eq_ignore_ascii_case("Weekly Reward Choices") {
                in_vault_section = true;
                pending_name.clear();
                pending_ilevel = 0;
                continue;
            }
            if clean.eq_ignore_ascii_case("End of Weekly Reward Choices") {
                in_vault_section = false;
                pending_name.clear();
                pending_ilevel = 0;
                continue;
            }

            // Loot section boundaries
            if clean.eq_ignore_ascii_case("Group Loot") {
                in_loot_section = true;
                pending_name.clear();
                pending_ilevel = 0;
                continue;
            }
            if clean.eq_ignore_ascii_case("End of Group Loot") {
                in_loot_section = false;
                pending_name.clear();
                pending_ilevel = 0;
                continue;
            }

            // Commented-out talent loadout
            if let Some(caps) = talents_re.captures(clean) {
                let name = if pending_label.is_empty() {
                    format!("Loadout {}", talent_loadouts.len() + 1)
                } else {
                    pending_label.clone()
                };
                talent_loadouts.push(TalentLoadout {
                    name,
                    talent_string: caps[1].to_string(),
                    is_active: false,
                });
                pending_label.clear();
                continue;
            }

            // Commented-out gear line → bag/vault item
            if let Some(caps) = slot_re.captures(clean) {
                let slot = caps[1].to_lowercase();
                let item_str = caps[2].to_string();
                let mut props = parse_item_props(&item_str);

                if props.name.is_empty() && !pending_name.is_empty() {
                    props.name = pending_name.clone();
                }
                if props.ilevel == 0 && pending_ilevel > 0 {
                    props.ilevel = pending_ilevel;
                }
                pending_name.clear();
                pending_ilevel = 0;

                let origin = if in_vault_section {
                    ItemOrigin::Vault
                } else if in_loot_section {
                    ItemOrigin::Loot
                } else {
                    ItemOrigin::Bags
                };

                items.push(RawParsedItem {
                    raw_slot: slot,
                    simc_string: item_str,
                    item_id: props.item_id,
                    ilevel: props.ilevel,
                    name: props.name,
                    bonus_ids: props.bonus_ids,
                    enchant_id: props.enchant_id,
                    gem_id: props.gem_id,
                    origin,
                });
            } else if let Some(caps) = header_re.captures(stripped) {
                pending_name = caps[1].to_string();
                pending_ilevel = caps[2].parse().unwrap_or(0);
            } else {
                // Potential loadout label (short non-gear, non-header comment)
                let candidate = clean.to_string();
                if !candidate.is_empty()
                    && candidate.len() < 60
                    && !slot_re.is_match(&candidate)
                    && !header_re.is_match(stripped)
                    && !candidate.starts_with("gear_")
                {
                    pending_label = candidate;
                } else {
                    pending_label.clear();
                }
                pending_name.clear();
                pending_ilevel = 0;
            }
        } else {
            base_profile_lines.push(stripped.to_string());

            // Active talent line
            if let Some(caps) = talents_re.captures(stripped) {
                let name = if pending_label.is_empty() {
                    "Active".to_string()
                } else {
                    pending_label.clone()
                };
                talent_loadouts.insert(
                    0,
                    TalentLoadout {
                        name,
                        talent_string: caps[1].to_string(),
                        is_active: true,
                    },
                );
                pending_label.clear();
                continue;
            }

            // Active gear line → equipped item
            if let Some(caps) = slot_re.captures(stripped) {
                let slot = caps[1].to_lowercase();
                let item_str = caps[2].to_string();
                let mut props = parse_item_props(&item_str);

                if props.name.is_empty() && !pending_name.is_empty() {
                    props.name = pending_name.clone();
                }
                if props.ilevel == 0 && pending_ilevel > 0 {
                    props.ilevel = pending_ilevel;
                }
                pending_name.clear();
                pending_ilevel = 0;

                items.push(RawParsedItem {
                    raw_slot: slot,
                    simc_string: item_str,
                    item_id: props.item_id,
                    ilevel: props.ilevel,
                    name: props.name,
                    bonus_ids: props.bonus_ids,
                    enchant_id: props.enchant_id,
                    gem_id: props.gem_id,
                    origin: ItemOrigin::Equipped,
                });
            }
            pending_label.clear();
        }
    }

    ParseResult {
        items,
        character,
        base_profile: base_profile_lines.join("\n"),
        talent_loadouts,
    }
}

/// Extract upgrade currency budget from a SimC addon string.
///
/// Parses lines like: `# upgrade_currencies = 3068:80/3069:100`
/// Returns a map of currency_id → amount.
pub fn parse_upgrade_currencies(simc_input: &str) -> HashMap<u64, u64> {
    let line_re = Regex::new(r"(?i)^#?\s*upgrade_currencies\s*=\s*(.+)$").unwrap();
    // Only match c:ID:AMOUNT entries (currencies), skip i:ID:AMOUNT (items)
    let pair_re = Regex::new(r"c:(\d+):(\d+)").unwrap();

    let mut currencies = HashMap::new();
    for line in simc_input.lines() {
        if let Some(caps) = line_re.captures(line.trim()) {
            let rhs = &caps[1];
            for pair in pair_re.captures_iter(rhs) {
                let id: u64 = pair[1].parse().unwrap_or(0);
                let amount: u64 = pair[2].parse().unwrap_or(0);
                if id > 0 {
                    currencies.insert(id, amount);
                }
            }
            break;
        }
    }
    currencies
}

/// Extract catalyst charge count from a SimC addon string.
///
/// Parses lines like: `# catalyst_currencies=3269:8/3378:5/2813:8/3116:8`
/// Returns the charge count for the given currency_id (e.g. 3378 for Midnight Catalyst).
pub fn parse_catalyst_charges(simc_input: &str, currency_id: u64) -> Option<u32> {
    let line_re = Regex::new(r"(?i)^#?\s*catalyst_currencies\s*=\s*(.+)$").unwrap();
    for line in simc_input.lines() {
        if let Some(caps) = line_re.captures(line.trim()) {
            let rhs = &caps[1];
            for entry in rhs.split('/') {
                let parts: Vec<&str> = entry.split(':').collect();
                if parts.len() == 2 {
                    let id: u64 = parts[0].trim().parse().unwrap_or(0);
                    let count: u32 = parts[1].trim().parse().unwrap_or(0);
                    if id == currency_id {
                        return Some(count);
                    }
                }
            }
            break;
        }
    }
    None
}
