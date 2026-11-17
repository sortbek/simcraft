//! RaidSimRequest / BulkSimRequest protojson for the `simhammer-forever` CLI. The CLI fills the
//! spec's defaults (options, buffs, consumables, rotation, target, encounter shape).

use serde_json::{json, Value};

use super::data::ForeverData;
use super::drops::DropItem;
use super::import::{ExportItem, ForeverCharacter};
use super::spec;

pub struct SimSettings {
    pub iterations: u32,
    pub duration_seconds: f64,
}

fn item_spec(item: &ExportItem) -> Value {
    let mut spec = json!({ "id": item.item_id });
    if item.enchant_id > 0 {
        spec["enchant"] = json!(item.enchant_id);
    }
    if item.random_suffix > 0 {
        spec["randomSuffix"] = json!(item.random_suffix);
    }
    spec
}

fn profession(name: &str) -> Option<&'static str> {
    Some(match name {
        "alchemy" => "Alchemy",
        "blacksmithing" => "Blacksmithing",
        "enchanting" => "Enchanting",
        "engineering" => "Engineering",
        "herbalism" => "Herbalism",
        "leatherworking" => "Leatherworking",
        "mining" => "Mining",
        "skinning" => "Skinning",
        "tailoring" => "Tailoring",
        _ => return None,
    })
}

pub fn raid_request(
    ch: &ForeverCharacter,
    data: &ForeverData,
    spec_key: &str,
    talents_string: &str,
    settings: &SimSettings,
) -> Value {
    let mut items = vec![json!({}); 17];
    for item in &ch.equipped {
        let Some(known) = data.items.get(&item.item_id) else {
            continue;
        };
        if let Some(slot) = spec::engine_slot(&item.slot, known.item_type) {
            items[slot] = item_spec(item);
        }
    }
    let mut player = json!({
        "name": ch.name,
        "race": spec::engine_race(&ch.race).unwrap_or("RaceUnknown"),
        "class": spec::engine_class(&ch.class).unwrap_or("ClassUnknown"),
        "equipment": { "items": items },
        "talentsString": talents_string,
    });
    player[spec_key] = json!({});
    if let Some(ammo) = spec::engine_ammo(ch.ammo_id).filter(|_| spec_key == "hunter") {
        player[spec_key]["options"]["classOptions"]["ammo"] = json!(ammo);
    }
    if let Some(pet) = ch.pet.as_ref().filter(|_| spec_key == "hunter") {
        let options = &mut player[spec_key]["options"]["classOptions"];
        if let Some(kind) = spec::engine_pet_type(&pet.family) {
            options["petType"] = json!(kind);
        }
        if let Some(speed) = spec::engine_pet_attack_speed(pet.attack_speed) {
            options["petAttackSpeed"] = json!(speed);
        }
    }
    // Below 60 the engine scales the character from its sheet, read in the gear it was worn in.
    if let Some(sheet) = ch.sheet.as_ref().filter(|_| ch.level < 60) {
        let worn: Vec<Value> = player["equipment"]["items"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|i| i.get("id").is_some())
            .cloned()
            .collect();
        player["level"] = json!(ch.level);
        player["characterSheet"] = json!(sheet);
        player["characterSheet"]["equipment"] = json!({ "items": worn });
        // The spellbook, when the export has one: the engine then casts the trained ranks.
        if !ch.known_spells.is_empty() {
            player["knownSpells"] = json!(ch.known_spells);
        }
    }
    let profs: Vec<&str> = ch
        .professions
        .iter()
        .filter_map(|(n, _)| profession(n))
        .collect();
    if let Some(p) = profs.first() {
        player["profession1"] = json!(p);
    }
    if let Some(p) = profs.get(1) {
        player["profession2"] = json!(p);
    }
    json!({
        "raid": { "parties": [{ "players": [player] }] },
        "encounter": { "duration": settings.duration_seconds },
        "simOptions": { "iterations": settings.iterations },
    })
}

pub fn bulk_request(base: Value, bag_items: &[ExportItem], data: &ForeverData) -> Value {
    let items: Vec<Value> = bag_items
        .iter()
        .filter(|i| data.items.contains_key(&i.item_id))
        .map(item_spec)
        .collect();
    json!({ "baseRequest": base, "bulkSettings": { "items": items } })
}

/// Drop Finder: each item with the slots the character may wear it in.
pub fn drops_request(base: Value, items: &[DropItem]) -> Value {
    let items: Vec<Value> = items
        .iter()
        .map(|i| json!({ "item": { "id": i.item_id }, "slots": i.slots }))
        .collect();
    json!({ "baseRequest": base, "items": items })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::forever::import::parse_export;

    fn sylfrey() -> ForeverCharacter {
        parse_export(include_str!("testdata/sylfrey.simc")).unwrap()
    }

    fn settings() -> SimSettings {
        SimSettings {
            iterations: 5000,
            duration_seconds: 180.0,
        }
    }

    #[test]
    fn raid_request_has_player_gear_talents_and_settings() {
        let req = raid_request(
            &sylfrey(),
            crate::forever::test_data(),
            "protectionPaladin",
            "-05005133210012",
            &settings(),
        );
        let p = &req["raid"]["parties"][0]["players"][0];
        assert_eq!(p["class"], "ClassPaladin");
        assert_eq!(p["race"], "RaceUndead");
        assert_eq!(p["talentsString"], "-05005133210012");
        assert!(p["protectionPaladin"].is_object());
        assert_eq!(p["equipment"]["items"].as_array().unwrap().len(), 17);
        assert_eq!(p["equipment"]["items"][14]["id"], 273637);
        assert_eq!(p["profession1"], "Blacksmithing");
        assert_eq!(p["profession2"], "Mining");
        assert_eq!(req["simOptions"]["iterations"], 5000);
        assert_eq!(req["encounter"]["duration"], 180.0);
    }

    #[test]
    fn a_levelling_hunter_sends_its_level_sheet_pet_and_suffix() {
        let mut ch = parse_export(include_str!("testdata/sortbek.simc")).unwrap();
        // The test bundle knows the paladin's items; wear two of them in the hunter's slots.
        ch.equipped.retain(|i| i.slot == "main_hand");
        ch.equipped[0].item_id = 273637;
        let req = raid_request(&ch, crate::forever::test_data(), "hunter", "", &settings());
        let p = &req["raid"]["parties"][0]["players"][0];
        assert_eq!(p["level"], 29);
        assert_eq!(p["equipment"]["items"][14]["randomSuffix"], 12726);
        assert_eq!(
            p["characterSheet"]["base"],
            json!([36.0, 58.0, 50.0, 33.0, 43.0])
        );
        assert_eq!(
            p["characterSheet"]["rangedAttackPower"],
            json!([224.0, 41.0, 0.0])
        );
        assert_eq!(
            p["characterSheet"]["equipment"]["items"],
            json!([{ "id": 273637, "randomSuffix": 12726 }])
        );
        let options = &p["hunter"]["options"]["classOptions"];
        assert_eq!(options["ammo"], "RazorArrow");
        assert_eq!(
            (&options["petType"], &options["petAttackSpeed"]),
            (&json!("Raptor"), &json!("Two"))
        );
    }

    #[test]
    fn a_level_60_character_sends_no_sheet() {
        let export = include_str!("testdata/sortbek.simc").replace("level=29", "level=60");
        let ch = parse_export(&export).unwrap();
        let req = raid_request(&ch, crate::forever::test_data(), "hunter", "", &settings());
        let p = &req["raid"]["parties"][0]["players"][0];
        assert!(p.get("level").is_none() && p.get("characterSheet").is_none());
    }

    #[test]
    fn unknown_items_are_left_out_of_the_gear() {
        let mut ch = sylfrey();
        ch.equipped[0].item_id = 999_999;
        let req = raid_request(
            &ch,
            crate::forever::test_data(),
            "protectionPaladin",
            "",
            &settings(),
        );
        let items = req["raid"]["parties"][0]["players"][0]["equipment"]["items"]
            .as_array()
            .unwrap();
        assert!(items.iter().all(|i| i["id"] != 999_999));
    }

    #[test]
    fn bulk_request_wraps_base_and_known_bag_items() {
        let ch = sylfrey();
        let base = raid_request(
            &ch,
            crate::forever::test_data(),
            "protectionPaladin",
            "",
            &settings(),
        );
        let mut bags = ch.bags.clone();
        bags.push(ExportItem {
            slot: "back".into(),
            item_id: 999_999,
            enchant_id: 0,
            random_suffix: 0,
        });
        let bulk = bulk_request(base.clone(), &bags, crate::forever::test_data());
        assert_eq!(bulk["baseRequest"], base);
        // 6314 (cape) and 267369 (Wolfsbane); the three profession tools and 999999 are not engine items.
        let ids: Vec<u64> = bulk["bulkSettings"]["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["id"].as_u64().unwrap())
            .collect();
        assert_eq!(ids, vec![6314, 267369]);
    }
}
