use crate::roster::armory_client::realm_slug;
use crate::types::class_data::{spec_id_to_class, spec_id_to_name};
use serde_json::Value;

/// Map a Blizzard equipment `slot.type` to the SimC gear slot.
///
/// Returns `None` for slots SimC does not model (SHIRT, TABARD) or unknown types.
fn slot_name(blizz_type: &str) -> Option<&'static str> {
    Some(match blizz_type {
        "HEAD" => "head",
        "NECK" => "neck",
        "SHOULDER" => "shoulder",
        "BACK" => "back",
        "CHEST" => "chest",
        "WRIST" => "wrist",
        "HANDS" => "hands",
        "WAIST" => "waist",
        "LEGS" => "legs",
        "FEET" => "feet",
        "FINGER_1" => "finger1",
        "FINGER_2" => "finger2",
        "TRINKET_1" => "trinket1",
        "TRINKET_2" => "trinket2",
        "MAIN_HAND" => "main_hand",
        "OFF_HAND" => "off_hand",
        _ => return None,
    })
}

/// Build a single SimC gear line for one equipped item, or `None` if it should
/// be skipped (unmodeled slot, or missing/zero item id).
fn item_line(item: &Value) -> Option<String> {
    let slot = slot_name(item.get("slot")?.get("type")?.as_str()?)?;

    let id = item.get("item")?.get("id")?.as_u64()?;
    if id == 0 {
        return None;
    }

    let mut tokens: Vec<String> = vec![format!("id={id}")];

    // bonus_id=<a>/<b>/<c>
    if let Some(bonus) = item.get("bonus_list").and_then(|v| v.as_array()) {
        let ids: Vec<String> = bonus.iter().filter_map(|v| v.as_u64()).map(|v| v.to_string()).collect();
        if !ids.is_empty() {
            tokens.push(format!("bonus_id={}", ids.join("/")));
        }
    }

    // enchant_id=<int> — prefer the PERMANENT enchantment, fall back to the first.
    if let Some(enchants) = item.get("enchantments").and_then(|v| v.as_array()) {
        let chosen = enchants
            .iter()
            .find(|e| {
                e.get("enchantment_slot")
                    .and_then(|s| s.get("type"))
                    .and_then(|t| t.as_str())
                    == Some("PERMANENT")
            })
            .or_else(|| enchants.first());
        if let Some(enchant_id) = chosen.and_then(|e| e.get("enchantment_id")).and_then(|v| v.as_u64()) {
            tokens.push(format!("enchant_id={enchant_id}"));
        }
    }

    // gem_id=<a>/<b> from socket item ids.
    if let Some(sockets) = item.get("sockets").and_then(|v| v.as_array()) {
        let gems: Vec<String> = sockets
            .iter()
            .filter_map(|s| s.get("item").and_then(|i| i.get("id")).and_then(|v| v.as_u64()))
            .map(|v| v.to_string())
            .collect();
        if !gems.is_empty() {
            tokens.push(format!("gem_id={}", gems.join("/")));
        }
    }

    // ilevel=<int>
    if let Some(ilvl) = item.get("level").and_then(|l| l.get("value")).and_then(|v| v.as_u64()) {
        tokens.push(format!("ilevel={ilvl}"));
    }

    Some(format!("{slot}=,{}", tokens.join(",")))
}

/// Find the active talent loadout code from the specializations JSON.
fn active_talent_code(specializations: &Value, active_id: u64) -> Option<String> {
    let specs = specializations.get("specializations")?.as_array()?;
    let entry = specs.iter().find(|s| {
        s.get("specialization").and_then(|sp| sp.get("id")).and_then(|v| v.as_u64()) == Some(active_id)
    })?;
    let loadouts = entry.get("loadouts")?.as_array()?;
    let loadout = loadouts
        .iter()
        .find(|l| l.get("is_active").and_then(|v| v.as_bool()) == Some(true))
        .or_else(|| loadouts.first())?;
    loadout
        .get("talent_loadout_code")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Convert proxied Blizzard equipment + specializations JSON into a SimC profile
/// string accepted by `addon_parser::parse_simc_input`.
pub fn armory_to_simc(name: &str, realm: &str, equipment: &Value, specializations: &Value) -> String {
    let active_id = specializations
        .get("active_specialization")
        .and_then(|s| s.get("id"))
        .and_then(|v| v.as_u64());

    let class = active_id.and_then(spec_id_to_class);
    let spec = active_id.and_then(spec_id_to_name);

    let mut lines: Vec<String> = Vec::new();

    if let Some(class) = class {
        lines.push(format!("{class}=\"{name}\""));
    }
    lines.push("level=80".to_string());
    lines.push(format!("server={}", realm_slug(realm)));
    if let Some(spec) = spec {
        lines.push(format!("spec={spec}"));
    }
    if let Some(code) = active_id.and_then(|id| active_talent_code(specializations, id)) {
        lines.push(format!("talents={code}"));
    }

    if let Some(items) = equipment.get("equipped_items").and_then(|v| v.as_array()) {
        for item in items {
            if let Some(line) = item_line(item) {
                lines.push(line);
            }
        }
    }

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn load(name: &str) -> Value {
        let p = format!("{}/tests/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name);
        serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
    }

    #[test]
    fn builds_simc_profile_that_reparses() {
        let eq = load("armory_equipment_sample.json");
        let spec = load("armory_specializations_sample.json");
        let simc = armory_to_simc("Thrall", "Tarren Mill", &eq, &spec);

        // emitted lines
        assert!(simc.lines().any(|l| l.starts_with("shaman=")), "class line missing:\n{simc}");
        assert!(simc.contains("spec=elemental"), "spec line missing:\n{simc}");
        assert!(simc.contains("talents=CoPAEXAMPLEcode00"), "talents missing:\n{simc}");
        assert!(simc.lines().any(|l| l.starts_with("head=")), "head line missing:\n{simc}");
        assert!(simc.contains("id=212018"));
        assert!(simc.contains("bonus_id=10421/9633/8902"));
        assert!(simc.contains("enchant_id=7340"));
        assert!(simc.lines().any(|l| l.starts_with("trinket1=")));
        assert!(!simc.contains("shirt="), "shirt should be skipped:\n{simc}");

        // the existing parser must accept what we emit
        let parsed = crate::addon_parser::parse_simc_input(&simc);
        assert_eq!(parsed.character.class_name.as_deref(), Some("shaman"));
        assert_eq!(parsed.character.spec.as_deref(), Some("elemental"));
        assert!(parsed.items.iter().any(|i| i.raw_slot == "head"));
        assert!(parsed.items.iter().any(|i| i.raw_slot == "trinket1"));
    }
}
