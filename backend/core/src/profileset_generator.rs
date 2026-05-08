mod base_profile;
mod constraints;
mod droptimizer;
mod enchant_gem;
mod selection;
mod simc;
mod top_gear;
mod upgrade_compare;

use serde_json::Value;
use std::collections::{HashMap, HashSet};

type ProfilesetResult = Result<(String, usize, HashMap<String, Vec<Value>>), String>;

use crate::db::MAX_COMBINATIONS;

pub fn generate_top_gear_input(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
    max_combos_override: Option<usize>,
) -> ProfilesetResult {
    top_gear::generate_top_gear_input(
        base_profile,
        items_by_slot,
        selected_items,
        max_combos_override,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn generate_top_gear_input_with_talents(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
    max_combos_override: Option<usize>,
    talent_builds: &[(String, String)],
    catalyst_charges: Option<u32>,
    enchant_selections: &HashMap<String, Vec<u64>>,
    gem_options: &[u64],
    socketed_item_ids: &HashSet<u64>,
    replace_gems: bool,
    diamond_always_use: bool,
    max_colors: bool,
) -> ProfilesetResult {
    top_gear::generate_top_gear_input_with_talents(
        base_profile,
        items_by_slot,
        selected_items,
        max_combos_override,
        talent_builds,
        catalyst_charges,
        enchant_selections,
        gem_options,
        socketed_item_ids,
        replace_gems,
        diamond_always_use,
        max_colors,
    )
}

pub fn generate_droptimizer_input(
    base_profile: &str,
    drop_items: &[Value],
) -> (String, usize, HashMap<String, Value>) {
    droptimizer::generate_droptimizer_input(base_profile, drop_items)
}

pub fn generate_upgrade_compare_input(
    base_profile: &str,
    upgraded_options_by_slot: &HashMap<String, Vec<Value>>,
    upgrade_budget: &HashMap<u64, u64>,
    max_combos_override: Option<usize>,
) -> ProfilesetResult {
    upgrade_compare::generate_upgrade_compare_input(
        base_profile,
        upgraded_options_by_slot,
        upgrade_budget,
        max_combos_override,
    )
}

pub fn generate_enchant_gem_input(
    base_profile: &str,
    enchant_selections: &HashMap<String, Vec<u64>>,
    gem_options: &[u64],
    socketed_item_ids: &HashSet<u64>,
    max_combos_override: Option<usize>,
) -> ProfilesetResult {
    enchant_gem::generate_enchant_gem_input(
        base_profile,
        enchant_selections,
        gem_options,
        socketed_item_ids,
        max_combos_override,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        generate_droptimizer_input, generate_enchant_gem_input,
        generate_top_gear_input_with_talents, generate_upgrade_compare_input,
    };
    use serde_json::json;
    use std::collections::{HashMap, HashSet};
    use std::path::PathBuf;
    use std::sync::Once;

    static LOAD_GAME_DATA: Once = Once::new();

    fn ensure_game_data_loaded() {
        LOAD_GAME_DATA.call_once(|| {
            let data_dir =
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/data-compacted");
            crate::item_db::load(&data_dir);
        });
    }

    #[test]
    fn enchant_gem_generator_builds_non_baseline_enchant_combo() {
        ensure_game_data_loaded();

        let base_profile = "\
mage=test\n\
spec=frost\n\
head=,id=100,enchant_id=11\n\
main_hand=,id=200\n";

        let mut enchant_selections = HashMap::new();
        enchant_selections.insert("head".to_string(), vec![22]);

        let (input, combo_count, metadata) = generate_enchant_gem_input(
            base_profile,
            &enchant_selections,
            &[],
            &HashSet::new(),
            Some(10),
        )
        .unwrap();

        assert_eq!(combo_count, 1);
        assert!(input.contains("profileset.\"Combo 2\"+=head=,id=100,enchant_id=22"));
        assert!(metadata.contains_key("Currently Equipped"));
        assert!(metadata.contains_key("Combo 2"));
    }

    #[test]
    fn droptimizer_generator_emits_head_drop_combo() {
        let base_profile = "\
mage=test\n\
spec=frost\n\
head=,id=100\n\
main_hand=,id=200\n";

        let drop_items = vec![json!({
            "item_id": 999,
            "ilevel": 671,
            "name": "Test Helm",
            "encounter": "Unit Test",
            "inventory_type": 1,
            "bonus_ids": [123, 456]
        })];

        let (input, combo_count, metadata) = generate_droptimizer_input(base_profile, &drop_items);

        assert_eq!(combo_count, 1);
        assert!(input.contains("profileset.\"Combo 2\"+=head=,id=999,ilevel=671,bonus_id=123/456"));
        assert!(metadata.contains_key("Combo 2"));
    }

    #[test]
    fn droptimizer_ring_drop_inherits_gem_and_enchant() {
        let base_profile = "\
mage=test\n\
spec=frost\n\
finger1=,id=10,enchant_id=7437,gem_id=213743\n\
finger2=,id=20,enchant_id=7438,gem_id=213744\n\
main_hand=,id=200\n";

        let drop_items = vec![json!({
            "item_id": 555,
            "ilevel": 671,
            "name": "Test Ring",
            "encounter": "Unit Test",
            "inventory_type": 11,
            "bonus_ids": [123],
            "slot_inherits": [
                { "slot": "finger1", "enchant_id": 7437, "gem_id": 213743 },
                { "slot": "finger2", "enchant_id": 7438, "gem_id": 213744 }
            ]
        })];

        let (input, combo_count, metadata) = generate_droptimizer_input(base_profile, &drop_items);

        assert_eq!(combo_count, 2);
        assert!(
            input.contains("finger1=,id=555,ilevel=671,bonus_id=123,enchant_id=7437,gem_id=213743"),
            "expected finger1 profileset with inherited enchant + gem; got:\n{input}"
        );
        assert!(
            input.contains("finger2=,id=555,ilevel=671,bonus_id=123,enchant_id=7438,gem_id=213744"),
            "expected finger2 profileset with inherited enchant + gem; got:\n{input}"
        );

        let f1 = metadata
            .values()
            .find(|v| v[0]["slot"] == "finger1")
            .expect("missing finger1 metadata");
        assert_eq!(f1[0]["enchant_id"], 7437);
        assert_eq!(f1[0]["gem_id"], 213743);
    }

    #[test]
    fn droptimizer_two_hand_weapon_drop_inherits_main_hand_enchant() {
        let base_profile = "\
mage=test\n\
spec=frost\n\
main_hand=,id=200,enchant_id=7459\n";

        let drop_items = vec![json!({
            "item_id": 777,
            "ilevel": 680,
            "name": "Test 2H",
            "encounter": "Unit Test",
            "inventory_type": 17,
            "bonus_ids": [],
            "slot_inherits": [
                { "slot": "main_hand", "enchant_id": 7459 }
            ]
        })];

        let (input, combo_count, _metadata) = generate_droptimizer_input(base_profile, &drop_items);

        assert_eq!(combo_count, 1);
        assert!(
            input.contains("main_hand=,id=777,ilevel=680,enchant_id=7459"),
            "expected main_hand profileset with inherited enchant; got:\n{input}"
        );
    }

    #[test]
    fn droptimizer_falls_back_to_equipped_enchant_when_slot_inherits_absent() {
        let base_profile = "\
mage=test\n\
spec=frost\n\
head=,id=100,enchant_id=7460\n\
main_hand=,id=200\n";

        let drop_items = vec![json!({
            "item_id": 888,
            "ilevel": 670,
            "name": "Test Helm",
            "encounter": "Unit Test",
            "inventory_type": 1,
            "bonus_ids": []
        })];

        let (input, combo_count, _metadata) = generate_droptimizer_input(base_profile, &drop_items);

        assert_eq!(combo_count, 1);
        assert!(
            input.contains("head=,id=888,ilevel=670,enchant_id=7460"),
            "fallback should still copy enchant from equipped head; got:\n{input}"
        );
    }

    #[test]
    fn upgrade_compare_generator_returns_error_without_selected_items() {
        let base_profile = "\
mage=test\n\
spec=frost\n\
head=,id=100\n\
main_hand=,id=200\n";

        let result = generate_upgrade_compare_input(
            base_profile,
            &HashMap::new(),
            &HashMap::new(),
            Some(10),
        );

        assert!(
            matches!(result, Err(message) if message.contains("No upgradeable equipped items"))
        );
    }

    #[test]
    fn top_gear_limits_diamonds_to_one_per_combo() {
        ensure_game_data_loaded();

        let base_profile = "\
mage=test\n\
spec=frost\n\
head=,id=100,gem_id=213453\n\
neck=,id=101,gem_id=213453\n\
finger1=,id=102,gem_id=213453\n";

        let socketed_item_ids = HashSet::from([100_u64, 101_u64, 102_u64]);
        let diamond_id = 213738_u64;
        let colored_gem_id = 213453_u64;

        let (input, combo_count, metadata) = generate_top_gear_input_with_talents(
            base_profile,
            &HashMap::new(),
            &HashMap::new(),
            Some(20),
            &[],
            None,
            &HashMap::new(),
            &[diamond_id, colored_gem_id],
            &socketed_item_ids,
            true,
            false,
            false,
        )
        .unwrap();

        assert_eq!(combo_count, 2);
        for block in input.split("### ").skip(1) {
            let diamond_uses = block.matches(&format!("gem_id={diamond_id}")).count();
            assert!(
                diamond_uses <= 1,
                "combo contained {diamond_uses} diamonds:\n{block}"
            );
        }

        for (combo_name, items) in metadata {
            let diamond_uses = items
                .iter()
                .filter(|item| item.get("gem_id").and_then(|v| v.as_u64()) == Some(diamond_id))
                .count();
            assert!(
                diamond_uses <= 1,
                "{combo_name} metadata contained {diamond_uses} diamonds"
            );
        }
    }
}
