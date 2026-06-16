use crate::roster::armory_client::realm_slug;
use crate::talent_normalize::spec_id_from_loadout;
use crate::types::class_data::{spec_id_to_class, spec_id_to_name, title_case};
use serde_json::Value;

/// Fallback player level when the armory payload omits one. Simming a max-level
/// character at the wrong level grossly distorts DPS (secondary-stat rating
/// conversions + target armor scale with level), so this must track the current
/// expansion's max level. The proxy should send `character.level` so we use the
/// real value; this is only the floor for older payloads.
const DEFAULT_PLAYER_LEVEL: u64 = 90;

/// Map a simhammer.com armory gear `slot` to the SimC gear slot.
///
/// Returns `None` for slots SimC does not model (SHIRT, TABARD) or unknown types.
fn slot_name(slot: &str) -> Option<&'static str> {
    Some(match slot {
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

/// Extract an id from a JSON value that may be a bare number or an object
/// carrying `id`/`itemId`/`enchantId`. Tolerant of both possible armory shapes.
fn value_as_id(v: &Value) -> Option<u64> {
    if let Some(n) = v.as_u64() {
        return Some(n);
    }
    ["id", "itemId", "enchantId", "enchant_id"]
        .iter()
        .find_map(|k| v.get(k).and_then(|x| x.as_u64()))
}

/// Build a single SimC gear line for one armory item, or `None` if it should be
/// skipped (unmodeled slot, or missing/zero item id).
fn item_line(item: &Value) -> Option<String> {
    let slot = slot_name(item.get("slot")?.as_str()?)?;

    let id = item.get("itemId")?.as_u64()?;
    if id == 0 {
        return None;
    }

    let mut tokens: Vec<String> = vec![format!("id={id}")];

    // bonus_id=<a>/<b>/... — encodes the upgrade track (item level), tier-set
    // membership, tertiary stats and sockets. Critical for accuracy.
    let bonus_ids: Vec<String> = item
        .get("bonusIds")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|b| b.as_u64())
                .map(|b| b.to_string())
                .collect()
        })
        .unwrap_or_default();
    let has_bonus = !bonus_ids.is_empty();
    if has_bonus {
        tokens.push(format!("bonus_id={}", bonus_ids.join("/")));
    }

    // enchant_id — only usable when given as a numeric id. The proxy currently
    // sends a human-readable display string for enchants, which we can't convert.
    if let Some(enchant_id) = item.get("enchant").and_then(value_as_id) {
        tokens.push(format!("enchant_id={enchant_id}"));
    }

    // gem_id=<a>/<b> — armory `gems` is an array of objects ({itemId,name}) or bare ids.
    if let Some(gems) = item.get("gems").and_then(|v| v.as_array()) {
        let ids: Vec<String> = gems
            .iter()
            .filter_map(value_as_id)
            .map(|v| v.to_string())
            .collect();
        if !ids.is_empty() {
            tokens.push(format!("gem_id={}", ids.join("/")));
        }
    }

    // ilevel — the bonus_ids encode the upgrade track's item level (as in the SimC
    // addon export), so emit an explicit ilevel only as a fallback when no bonus
    // ids are present.
    if !has_bonus {
        if let Some(ilvl) = item.get("itemLevel").and_then(|v| v.as_u64()) {
            tokens.push(format!("ilevel={ilvl}"));
        }
    }

    Some(format!("{slot}=,{}", tokens.join(",")))
}

/// Convert the simhammer.com `/armory` payload (character + gear + talents) into
/// a SimC profile string accepted by `addon_parser::parse_simc_input`.
///
/// Class and spec are derived from the spec id encoded in the talent
/// `loadoutCode` (locale-independent); when that can't be decoded, the class and
/// spec lines are omitted (the caller treats a missing class as a failed import).
pub fn armory_to_simc(armory: &Value) -> String {
    let character = armory.get("character");
    let name = character
        .and_then(|c| c.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("Character");
    let realm = character
        .and_then(|c| c.get("realm"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let level = character
        .and_then(|c| c.get("level"))
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_PLAYER_LEVEL);
    let race = character
        .and_then(|c| c.get("race"))
        .and_then(|v| v.as_str())
        .map(|r| r.trim().to_lowercase().replace(' ', "_"))
        .filter(|r| !r.is_empty());

    let loadout = armory
        .get("talents")
        .and_then(|t| t.get("loadoutCode"))
        .and_then(|v| v.as_str());
    let spec_id = loadout.and_then(spec_id_from_loadout);
    let class = spec_id.and_then(spec_id_to_class);
    let spec = spec_id.and_then(spec_id_to_name);

    let mut lines: Vec<String> = Vec::new();

    if let Some(class) = class {
        lines.push(format!("{class}=\"{}\"", title_case(name)));
    }
    lines.push(format!("level={level}"));
    if let Some(race) = race {
        lines.push(format!("race={race}"));
    }
    lines.push(format!("server={}", realm_slug(realm)));
    if let Some(spec) = spec {
        lines.push(format!("spec={spec}"));
    }
    if let Some(code) = loadout {
        lines.push(format!("talents={code}"));
    }

    if let Some(items) = armory
        .get("gear")
        .and_then(|g| g.get("items"))
        .and_then(|v| v.as_array())
    {
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
    use serde_json::{json, Value};

    fn load(name: &str) -> Value {
        let p = format!("{}/tests/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name);
        serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
    }

    #[test]
    fn builds_simc_profile_that_reparses() {
        // Real /armory response (frost mage) captured from the live endpoint.
        let armory = load("armory_sample.json");
        let simc = armory_to_simc(&armory);

        // class/spec derived from the loadout code (spec id 64 -> frost mage)
        assert!(
            simc.lines().any(|l| l.starts_with("mage=")),
            "class line missing:\n{simc}"
        );
        assert!(simc.contains("spec=frost"), "spec line missing:\n{simc}");
        assert!(simc.contains("talents=CAEAMhl"), "talents missing:\n{simc}");

        // gear lines: direct itemId + itemLevel
        assert!(
            simc.lines().any(|l| l.starts_with("head=")),
            "head line missing:\n{simc}"
        );
        assert!(simc.contains("id=132863"));
        assert!(simc.contains("ilevel=58"));
        assert!(simc.lines().any(|l| l.starts_with("trinket1=")));

        // the existing parser must accept what we emit
        let parsed = crate::addon_parser::parse_simc_input(&simc);
        assert_eq!(parsed.character.class_name.as_deref(), Some("mage"));
        assert_eq!(parsed.character.spec.as_deref(), Some("frost"));
        assert!(parsed.items.iter().any(|i| i.raw_slot == "head"));
        assert!(parsed.items.iter().any(|i| i.raw_slot == "trinket1"));
    }

    #[test]
    fn uses_level_from_armory_when_present() {
        let armory = json!({
            "character": { "name": "x", "realm": "r", "level": 70 },
            "talents": { "loadoutCode": "CAEAMhlVtghLZL4RZzExaQoBYZGGLzMzsgZmYmZGzMzMziZmZmZMzsMTDLDAwMDWmZaDAAWAAAA2AYbZMjZwsxMmZsAAAwMbzMYGGDAA" }
        });
        let simc = armory_to_simc(&armory);
        assert!(simc.lines().any(|l| l == "level=70"), "expected level=70:\n{simc}");
    }

    #[test]
    fn defaults_to_max_level_not_80_when_level_absent() {
        // The /armory payload has no `level`; we must NOT emit the old hardcoded
        // level=80 (simming a max-level char at 80 ~doubles DPS).
        let armory = json!({
            "character": { "name": "x", "realm": "r" },
            "talents": { "loadoutCode": "CAEAMhlVtghLZL4RZzExaQoBYZGGLzMzsgZmYmZGzMzMziZmZmZMzsMTDLDAwMDWmZaDAAWAAAA2AYbZMjZwsxMmZsAAAwMbzMYGGDAA" }
        });
        let simc = armory_to_simc(&armory);
        assert!(simc.lines().any(|l| l == "level=90"), "expected level=90 fallback:\n{simc}");
        assert!(!simc.contains("level=80"), "must not hardcode level=80:\n{simc}");
    }

    #[test]
    fn parses_new_armory_shape_bonus_gems_race() {
        // Mirrors the current /armory payload: bonusIds array, gems as objects
        // ({itemId,name}), enchant as a display string (unusable), race present.
        let armory = json!({
            "character": { "name": "sortbek", "realm": "draenor", "race": "Troll", "level": 90 },
            "talents": { "loadoutCode": "CAEAMhlVtghLZL4RZzExaQoBYZGGLzMzsgZmYmZGzMzMziZmZmZMzsMTDLDAwMDWmZaDAAWAAAA2AYbZMjZwsxMmZsAAAwMbzMYGGDAA" },
            "gear": { "items": [
                { "slot": "HEAD", "itemId": 249988, "itemLevel": 289,
                  "bonusIds": [43, 13440, 13338],
                  "enchant": "Enchanted: Enchant Helm - Empowered Rune of Avoidance |A:x|a",
                  "gems": [ { "itemId": 240898, "name": "+16 Mastery & +7 Critical Strike" } ] }
            ]}
        });
        let simc = armory_to_simc(&armory);
        let head = simc.lines().find(|l| l.starts_with("head=")).expect("head line");
        assert!(head.contains("id=249988"), "{head}");
        assert!(head.contains("bonus_id=43/13440/13338"), "bonus ids:\n{head}");
        assert!(head.contains("gem_id=240898"), "gem from object:\n{head}");
        // bonus ids encode the item level, so no explicit ilevel on bonus'd items
        assert!(!head.contains("ilevel="), "ilevel should be omitted when bonus present:\n{head}");
        // enchant is a display string -> no enchant_id
        assert!(!head.contains("enchant_id="), "string enchant must not become an id:\n{head}");
        // race emitted
        assert!(simc.lines().any(|l| l == "race=troll"), "race line:\n{simc}");
    }

    #[test]
    fn falls_back_to_ilevel_when_no_bonus_ids() {
        let armory = json!({
            "character": { "name": "x", "realm": "r", "level": 90 },
            "talents": { "loadoutCode": "CAEAMhlVtghLZL4RZzExaQoBYZGGLzMzsgZmYmZGzMzMziZmZmZMzsMTDLDAwMDWmZaDAAWAAAA2AYbZMjZwsxMmZsAAAwMbzMYGGDAA" },
            "gear": { "items": [ { "slot": "HEAD", "itemId": 111, "itemLevel": 600 } ] }
        });
        let simc = armory_to_simc(&armory);
        let head = simc.lines().find(|l| l.starts_with("head=")).unwrap();
        assert!(head.contains("ilevel=600"), "ilevel fallback when no bonus:\n{head}");
        assert!(!head.contains("bonus_id="), "{head}");
    }

    #[test]
    fn emits_enchant_and_gems_when_present() {
        let armory = json!({
            "character": { "name": "ench", "realm": "some-realm" },
            "talents": { "loadoutCode": "CAEAMhlVtghLZL4RZzExaQoBYZGGLzMzsgZmYmZGzMzMziZmZmZMzsMTDLDAwMDWmZaDAAWAAAA2AYbZMjZwsxMmZsAAAwMbzMYGGDAA" },
            "gear": { "items": [
                { "slot": "MAIN_HAND", "itemId": 111, "itemLevel": 600, "enchant": 7340, "gems": [213743, 213458] }
            ]}
        });
        let simc = armory_to_simc(&armory);
        assert!(simc.contains("main_hand=,id=111"), "{simc}");
        assert!(simc.contains("enchant_id=7340"), "{simc}");
        assert!(simc.contains("gem_id=213743/213458"), "{simc}");
        assert!(simc.contains("ilevel=600"), "{simc}");
    }

    #[test]
    fn empty_payload_does_not_panic_and_omits_class_spec_items() {
        let armory = json!({});
        let simc = armory_to_simc(&armory);
        assert!(!simc.contains("spec="), "no spec line expected:\n{simc}");
        let parsed = crate::addon_parser::parse_simc_input(&simc);
        assert_eq!(parsed.character.class_name, None);
        assert!(parsed.items.is_empty(), "no items expected:\n{simc}");
    }

    #[test]
    fn missing_loadout_omits_class_but_keeps_gear() {
        let armory = json!({
            "character": { "name": "noTalents", "realm": "r" },
            "gear": { "items": [ { "slot": "HEAD", "itemId": 222, "itemLevel": 600 } ] }
        });
        let simc = armory_to_simc(&armory);
        assert!(!simc.contains("spec="), "no spec for missing loadout:\n{simc}");
        let parsed = crate::addon_parser::parse_simc_input(&simc);
        assert_eq!(parsed.character.class_name, None);
        assert!(parsed.items.iter().any(|i| i.raw_slot == "head"));
    }
}
