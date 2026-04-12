mod base_profile;
mod constraints;
mod droptimizer;
mod enchant_gem;
mod selection;
mod simc;
mod top_gear;
mod upgrade_compare;

use once_cell::sync::Lazy;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

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
        generate_droptimizer_input, generate_enchant_gem_input, generate_upgrade_compare_input,
    };
    use serde_json::json;
    use std::collections::{HashMap, HashSet};
    use std::path::PathBuf;
    use std::sync::Once;

    static LOAD_GAME_DATA: Once = Once::new();

    fn ensure_game_data_loaded() {
        LOAD_GAME_DATA.call_once(|| {
            let data_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../resources/data-compacted");
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

        assert!(matches!(result, Err(message) if message.contains("No upgradeable equipped items")));
    }
}
