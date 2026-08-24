//! Pure request-shaping transforms: sanitize and inject SimC text, and convert a
//! resolved-gear response into the `items_by_slot` shape the generators expect.
//! No I/O, no job state — every function here is a value-in/value-out transform.

use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::collections::HashMap;

use super::types::SimOptions;
use crate::types::ResolveGearResponse;

// Hot-path regexes compiled once at startup.
static RE_BLOCKED_DIRECTIVES: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"(?mi)^\s*(output|html|json2?|xml)\s*=").unwrap());
static RE_TALENTS_LINE: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"(?m)^talents=.+$").unwrap());
static RE_SPEC_LINE: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"(?m)^spec=.+$").unwrap());

/// Sanitize user-provided custom SimC input by stripping dangerous directives.
pub(super) fn sanitize_custom_simc(input: &str) -> String {
    input
        .lines()
        .filter(|line| !RE_BLOCKED_DIRECTIVES.is_match(line))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Inject expert mode fields at the correct positions in the SimC profile.
///
/// Profileset sims (has `# Base Actor` + `### Combo` markers): header → base lines →
/// base_player → Combo 1 → gear → raid_actors → Combo 2..N → post_combos → footer.
/// Quick sim (no markers): header → raw input → base_player → raid_actors →
/// post_combos → footer.
pub(super) fn inject_expert_fields(simc_input: &str, options: &SimOptions) -> String {
    let header = sanitize_custom_simc(&options.simc_header);
    let base_player = sanitize_custom_simc(&options.simc_base_player);
    let custom_apl = sanitize_custom_simc(&options.custom_apl);
    let raid_actors = sanitize_custom_simc(&options.simc_raid_actors);
    let post_combos = sanitize_custom_simc(&options.simc_post_combos);
    let footer = sanitize_custom_simc(&options.simc_footer);

    // A dungeon-route custom_apl ends with `enemy=`/`raid_events`; if injected
    // before the combo gear (like ordinary custom_apl), that gear binds to the
    // enemy actor. So it's appended at the very end instead — after all profilesets.
    let custom_apl_is_route = crate::simc_runner::is_dungeon_route_input(&custom_apl);

    let all_empty = header.trim().is_empty()
        && base_player.trim().is_empty()
        && custom_apl.trim().is_empty()
        && raid_actors.trim().is_empty()
        && post_combos.trim().is_empty()
        && footer.trim().is_empty();

    if all_empty {
        return simc_input.to_string();
    }

    let lines: Vec<&str> = simc_input.lines().collect();
    let has_base_actor = lines.iter().any(|l| l.trim() == "# Base Actor");

    if !has_base_actor {
        // Quick Sim: no markers, just concatenate in order
        let mut parts: Vec<&str> = Vec::new();
        if !header.trim().is_empty() {
            parts.push("# Header");
            parts.push(&header);
            parts.push("");
        }
        parts.push(simc_input);
        if !base_player.trim().is_empty() {
            parts.push("");
            parts.push("# Base Player Customization");
            parts.push(&base_player);
        }
        if !custom_apl.trim().is_empty() {
            parts.push("");
            parts.push("# Custom APL");
            parts.push(&custom_apl);
        }
        if !raid_actors.trim().is_empty() {
            parts.push("");
            parts.push("# Raid Actors");
            parts.push(&raid_actors);
        }
        if !post_combos.trim().is_empty() {
            parts.push("");
            parts.push("# Post Combination Actors");
            parts.push(&post_combos);
        }
        if !footer.trim().is_empty() {
            parts.push("");
            parts.push("# Footer");
            parts.push(&footer);
        }
        return parts.join("\n");
    }

    // Profileset sim: find markers and inject at the right positions
    let mut result: Vec<String> = Vec::new();
    let mut i = 0;
    let mut injected_base_player = false;
    let mut injected_raid_actors = false;
    let mut _last_combo_end = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim();

        // Inject header before "# Base Actor"
        if trimmed == "# Base Actor" && !header.trim().is_empty() {
            result.push("# Header".to_string());
            result.push(header.clone());
            result.push(String::new());
        }

        // Inject base_player and custom_apl before "### Combo 1"
        if trimmed == "### Combo 1" && !injected_base_player {
            if !base_player.trim().is_empty() {
                result.push("# Base Player Customization".to_string());
                result.push(base_player.clone());
                result.push(String::new());
            }
            if !custom_apl.trim().is_empty() && !custom_apl_is_route {
                result.push("# Custom APL".to_string());
                result.push(custom_apl.clone());
                result.push(String::new());
            }
            injected_base_player = true;
        }

        // Inject raid_actors before "### Combo 2"
        if trimmed == "### Combo 2" && !raid_actors.trim().is_empty() && !injected_raid_actors {
            result.push("# Raid Actors".to_string());
            result.push(raid_actors.clone());
            result.push(String::new());
            injected_raid_actors = true;
        }

        result.push(lines[i].to_string());

        // Track end of combo blocks
        if trimmed.starts_with("### Combo") {
            _last_combo_end = result.len();
            // Scan ahead to find end of this combo block
            i += 1;
            while i < lines.len() {
                let next = lines[i].trim();
                if next.starts_with("### Combo") {
                    break; // start of next combo, don't consume
                }
                result.push(lines[i].to_string());
                _last_combo_end = result.len();
                i += 1;
            }
            continue;
        }

        i += 1;
    }

    // If raid_actors wasn't injected (only 1 combo / no Combo 2), inject after Combo 1 block
    if !injected_raid_actors && !raid_actors.trim().is_empty() {
        result.push(String::new());
        result.push("# Raid Actors".to_string());
        result.push(raid_actors);
    }

    // Post combos after all profilesets
    if !post_combos.trim().is_empty() {
        result.push(String::new());
        result.push("# Post Combination Actors".to_string());
        result.push(post_combos);
    }

    // Footer at the very end
    if !footer.trim().is_empty() {
        result.push(String::new());
        result.push("# Footer".to_string());
        result.push(footer);
    }

    // Route block last of all: its `enemy=` must follow the gear + profilesets.
    if custom_apl_is_route {
        result.push(String::new());
        result.push("# Dungeon Route".to_string());
        result.push(custom_apl);
    }

    result.join("\n")
}

/// Convert ResolveGearResponse slots into the items_by_slot Value format
/// used by profileset_generator and game_data functions.
pub(super) fn resolve_to_items_by_slot(
    resolved: &ResolveGearResponse,
) -> HashMap<String, Vec<Value>> {
    let mut items_by_slot: HashMap<String, Vec<Value>> = HashMap::new();
    for (slot, slot_res) in &resolved.slots {
        let mut items: Vec<Value> = Vec::new();
        if let Some(eq) = &slot_res.equipped {
            items.push(resolved_item_to_value(eq, true));
        }
        for alt in &slot_res.alternatives {
            items.push(resolved_item_to_value(alt, false));
        }
        if !items.is_empty() {
            items_by_slot.insert(slot.clone(), items);
        }
    }
    items_by_slot
}

fn resolved_item_to_value(item: &crate::types::ResolvedItem, is_equipped: bool) -> Value {
    let mut v = json!({
        "uid": item.uid,
        "slot": item.slot,
        "simc_string": item.simc_string,
        "is_equipped": is_equipped,
        "origin": item.origin.as_str(),
        "item_id": item.item_id,
        "ilevel": item.ilevel,
        "name": item.name,
        "bonus_ids": item.bonus_ids,
        "enchant_id": item.enchant_id,
        "gem_id": item.gem_id,
        "sockets": item.sockets,
    });
    if item.is_catalyst {
        v["is_catalyst"] = json!(true);
        v["source_item_id"] = json!(item.source_item_id);
    }
    v
}

/// Replace the talents= line in a simc input string with a new talent string.
pub(super) fn apply_talent_override(simc_input: &str, talents: &str) -> String {
    if talents.is_empty() {
        return simc_input.to_string();
    }
    if RE_TALENTS_LINE.is_match(simc_input) {
        RE_TALENTS_LINE
            .replace(simc_input, format!("talents={}", talents))
            .to_string()
    } else {
        format!("{}\ntalents={}", simc_input, talents)
    }
}

/// Replace the spec= line in a simc input string.
pub(super) fn apply_spec_override(simc_input: &str, spec: &str) -> String {
    if spec.is_empty() {
        return simc_input.to_string();
    }
    if RE_SPEC_LINE.is_match(simc_input) {
        RE_SPEC_LINE
            .replace(simc_input, format!("spec={}", spec))
            .to_string()
    } else {
        format!("{}\nspec={}", simc_input, spec)
    }
}
