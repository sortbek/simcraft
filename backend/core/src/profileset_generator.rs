mod base_profile;
pub mod checkpoint;
mod constraints;
mod droptimizer;
mod emit;
mod enchant_gem;
mod estimate;
pub mod gem_combos;
pub mod identity_key;
pub mod iterator;
pub mod iterator_from_request;
mod selection;
mod simc;
pub mod stage_pipeline;
pub mod survivor_policy;
mod top_gear;
pub mod triage;
mod upgrade_compare;

pub use checkpoint::{Checkpoint, CheckpointPhase, StagedCheckpoint, TriageCheckpoint};
pub mod resume;
pub use resume::{resume_job, ResumeInputs};

pub use estimate::estimate_top_gear_combo_count;
pub use iterator::{
    EnchantAxis, GemCombosResolver, ProfilesetCandidate, ProfilesetIterator,
    ProfilesetIteratorConfig,
};
pub use iterator_from_request::build_iterator_from_request_json;
pub(crate) use top_gear::build_iterator_config;

use once_cell::sync::Lazy;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

use crate::db::MAX_COMBINATIONS;

/// Typed result for every profileset generator. Replaces an ad-hoc tuple +
/// stringly error pair so handlers stop parsing "(N)" out of error messages
/// to recover the limit-exceeded count for the UI.
pub struct GeneratedProfilesets {
    pub input: String,
    pub combo_count: usize,
    pub metadata: HashMap<String, Vec<Value>>,
}

/// Typed generator failure. Carries enough structured context that callers
/// don't need to inspect error message text. `Other` is a catch-all for the
/// older raw-string failure paths inside the per-generator modules that we
/// haven't migrated yet — those should be tightened over time.
#[derive(Debug, Clone)]
pub enum GeneratorError {
    /// User selection produced 0 valid combos. The UI may want to show a
    /// targeted message ("nothing to sim — pick more items") rather than a
    /// generic error.
    NoValidCombinations,
    /// Selection produced too many combos for the configured limit. The UI
    /// uses `count` to show "you've selected N — the cap is M" without
    /// having to parse it out of a string.
    TooMany { count: usize, limit: usize },
    /// Any other generator-time failure.
    Other(String),
}

impl GeneratorError {
    pub fn to_message(&self) -> String {
        match self {
            GeneratorError::NoValidCombinations => "No valid combinations to simulate".to_string(),
            GeneratorError::TooMany { count, limit } => format!(
                "Too many combinations ({count}). Maximum is {limit}. Please deselect some items."
            ),
            GeneratorError::Other(msg) => msg.clone(),
        }
    }
}

/// Internal-only legacy type alias, kept while we migrate generator modules
/// to return `Result<GeneratedProfilesets, GeneratorError>` directly. Public
/// callers should use the typed entry points below.
type ProfilesetResult = Result<(String, usize, HashMap<String, Vec<Value>>), String>;

/// Try to parse a generator's stringly error into the typed variant. Until
/// every per-generator module returns typed errors, this is the seam that
/// keeps handlers from re-implementing the regex of the message text.
pub(crate) fn classify_generator_error(msg: &str) -> GeneratorError {
    if let Some(rest) = msg.strip_prefix("Too many combinations (") {
        if let Some(count_str) = rest.split(')').next() {
            if let Ok(count) = count_str.parse::<usize>() {
                let limit = msg
                    .split("Maximum is ")
                    .nth(1)
                    .and_then(|s| s.split('.').next())
                    .and_then(|s| s.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                return GeneratorError::TooMany { count, limit };
            }
        }
    }
    if msg.to_lowercase().contains("no valid") || msg.contains("no combinations") {
        return GeneratorError::NoValidCombinations;
    }
    GeneratorError::Other(msg.to_string())
}

/// Gem and enchant variation options bundled together. Six related args that
/// always travel as a unit in the top-gear and count entry points.
#[derive(Default)]
pub struct GemEnchantOptions<'a> {
    /// Per-slot enchant IDs to sim in addition to the equipped one.
    pub enchant_selections: Option<&'a HashMap<String, Vec<u64>>>,
    /// Gem item IDs to apply across socketed slots.
    pub gem_options: &'a [u64],
    /// Item IDs known to carry a socket (inherent or via crafted_socket bonus).
    pub socketed_item_ids: Option<&'a HashSet<u64>>,
    /// Strip and replace existing gems instead of only filling empty sockets.
    pub replace_gems: bool,
    /// Force one diamond per emitted combo.
    pub diamond_always_use: bool,
    /// Prefer distinct gem colors across slots.
    pub max_colors: bool,
}

static EMPTY_ENCHANTS: Lazy<HashMap<String, Vec<u64>>> = Lazy::new(HashMap::new);
static EMPTY_SOCKETS: Lazy<HashSet<u64>> = Lazy::new(HashSet::new);

impl<'a> GemEnchantOptions<'a> {
    pub fn enchants(&self) -> &HashMap<String, Vec<u64>> {
        self.enchant_selections.unwrap_or(&EMPTY_ENCHANTS)
    }
    pub fn sockets(&self) -> &HashSet<u64> {
        self.socketed_item_ids.unwrap_or(&EMPTY_SOCKETS)
    }
}

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
    gem_opts: &GemEnchantOptions,
) -> ProfilesetResult {
    top_gear::generate_top_gear_input_with_talents(
        base_profile,
        items_by_slot,
        selected_items,
        max_combos_override,
        talent_builds,
        catalyst_charges,
        gem_opts,
    )
}

/// Count-only fast path. Skips building the simc_input string and metadata,
/// returning just the emitted profileset count. Hit by the live UI combo-count
/// endpoint on every selection toggle, so it must be cheap.
pub fn count_top_gear_combos_with_talents(
    base_profile: &str,
    items_by_slot: &HashMap<String, Vec<Value>>,
    selected_items: &HashMap<String, Vec<String>>,
    max_combos_override: Option<usize>,
    talent_builds: &[(String, String)],
    catalyst_charges: Option<u32>,
    gem_opts: &GemEnchantOptions,
) -> Result<usize, String> {
    top_gear::count_top_gear_combos_with_talents(
        base_profile,
        items_by_slot,
        selected_items,
        max_combos_override,
        talent_builds,
        catalyst_charges,
        gem_opts,
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
mod classifier_tests {
    use super::{classify_generator_error, GeneratorError};

    #[test]
    fn parses_too_many_with_count_and_limit() {
        let msg = "Too many combinations (12345). Maximum is 5000. Please deselect some items.";
        match classify_generator_error(msg) {
            GeneratorError::TooMany { count, limit } => {
                assert_eq!(count, 12345);
                assert_eq!(limit, 5000);
            }
            other => panic!("expected TooMany, got {other:?}"),
        }
    }

    #[test]
    fn parses_no_valid_combinations() {
        let msg = "No valid combinations to simulate after filtering";
        assert!(matches!(
            classify_generator_error(msg),
            GeneratorError::NoValidCombinations
        ));
    }

    #[test]
    fn falls_back_to_other() {
        let msg = "Some unexpected internal error";
        match classify_generator_error(msg) {
            GeneratorError::Other(s) => assert_eq!(s, msg),
            other => panic!("expected Other, got {other:?}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        count_top_gear_combos_with_talents, generate_droptimizer_input, generate_enchant_gem_input,
        generate_top_gear_input_with_talents, generate_upgrade_compare_input, GemEnchantOptions,
    };
    use crate::test_support::{ensure_game_data_loaded, TestItem};
    use serde_json::json;
    use std::collections::{HashMap, HashSet};

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
        // Drop carries bonus 13534 (= +1 socket per fixture), so gem
        // inheritance from the equipped finger is allowed for both slots.
        crate::test_support::ensure_game_data_loaded();
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
            "bonus_ids": [13534],
        })];

        let (input, combo_count, metadata) = generate_droptimizer_input(base_profile, &drop_items);

        assert_eq!(combo_count, 2);
        assert!(
            input.contains(
                "finger1=,id=555,ilevel=671,bonus_id=13534,enchant_id=7437,gem_id=213743"
            ),
            "expected finger1 profileset with inherited enchant + gem; got:\n{input}"
        );
        assert!(
            input.contains(
                "finger2=,id=555,ilevel=671,bonus_id=13534,enchant_id=7438,gem_id=213744"
            ),
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

        let gems = [diamond_id, colored_gem_id];
        let (input, combo_count, metadata) = generate_top_gear_input_with_talents(
            base_profile,
            &HashMap::new(),
            &HashMap::new(),
            Some(20),
            &[],
            None,
            &GemEnchantOptions {
                gem_options: &gems,
                socketed_item_ids: Some(&socketed_item_ids),
                replace_gems: true,
                ..Default::default()
            },
        )
        .unwrap();

        // Two gem combos are generated (all-colored, one-diamond), but the all-colored
        // combo produces a simc identical to the base actor (equipped gems already match),
        // so it's suppressed by the any_gem_change check. Only 1 profileset is emitted.
        assert_eq!(combo_count, 1);
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

    // Multi-socket support: a 2-socket equipped item with N gem options should
    // produce N + C(N,2) = N*(N+1)/2 multiset combos for that slot (e.g. 3 gems
    // → 6 combos: AA, AB, AC, BB, BC, CC). Mirror combos (A,B) and (B,A) collapse
    // because gems give character-wide stats — slot ordering doesn't affect DPS.
    // The simc line is emitted as `gem_id=A/B` (slash-separated).
    #[test]
    fn top_gear_multi_socket_emits_multiset_combos() {
        ensure_game_data_loaded();
        // Bonus 8781 adds 2 sockets in one shot (per data/bonuses.json).
        // Using a single 2-socket bonus keeps the simc-string view consistent
        // with the alt item's `sockets: 2` metadata.
        let base_profile = "\
mage=test\n\
spec=frost\n\
neck=,id=400\n\
main_hand=,id=200\n";

        let alt_neck_2sock = json!({
            "slot": "neck",
            "simc_string": ",id=500,bonus_id=8781",
            "is_equipped": false,
            "origin": "bags",
            "item_id": 500,
            "ilevel": 0,
            "name": "Alt Neck 2-socket",
            "bonus_ids": [8781],
            "enchant_id": 0,
            "gem_id": 0,
            "sockets": 2,
        });
        let equipped_neck = json!({
            "slot": "neck",
            "simc_string": ",id=400",
            "is_equipped": true,
            "origin": "equipped",
            "item_id": 400,
            "ilevel": 0,
            "name": "Equipped Neck",
            "bonus_ids": [],
            "enchant_id": 0,
            "gem_id": 0,
            "sockets": 0,
        });

        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("neck".to_string(), vec![equipped_neck, alt_neck_2sock]);

        let mut selected = HashMap::new();
        selected.insert("neck".to_string(), vec!["500:8781:bags:neck".to_string()]);

        // 3 gems, 2 sockets → 6 multisets: AA, AB, AC, BB, BC, CC.
        let gems = [213453_u64, 213454_u64, 213455_u64];
        let sockets = HashSet::from([500_u64]);
        let (input, combo_count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(50),
            &[],
            None,
            &GemEnchantOptions {
                gem_options: &gems,
                socketed_item_ids: Some(&sockets),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(
            combo_count, 6,
            "expected 6 multiset combos (3 gems × 2 sockets), got {combo_count}:\n{input}"
        );

        // Skip the header block and the base actor; every later block is a
        // profileset. Collect the alt neck's gem multiset from each one.
        let neck_gem_lists: Vec<Vec<u64>> = input
            .split("### ")
            .skip(2)
            .filter_map(|block| block.lines().find(|l| l.contains("neck=,id=500")))
            .map(crate::simc_string::extract_gem_ids)
            .collect();

        for gems in &neck_gem_lists {
            assert_eq!(
                gems.len(),
                2,
                "expected 2-socket neck to emit 2 slash-separated gem_ids, got {gems:?}"
            );
        }

        // No mirror combos: dedup on the sorted multiset must match the raw count.
        let mut seen: HashSet<Vec<u64>> = HashSet::new();
        for gems in &neck_gem_lists {
            let mut sorted = gems.clone();
            sorted.sort();
            assert!(
                seen.insert(sorted.clone()),
                "mirror combo emitted: {gems:?} (sorted {sorted:?})"
            );
        }
    }

    // Regression: alt item with a socket-adding bonus (no gem yet) must be eligible
    // for gem assignment. Was broken when `resolved_item_to_value` dropped the
    // `sockets` field, leaving `alt_has_socket` permanently false.
    #[test]
    fn top_gear_alt_with_socket_bonus_applies_each_gem() {
        ensure_game_data_loaded();
        // Bonus 13534 adds 1 socket; equipped wrist has no socket.
        let base_profile = "\
mage=test\n\
spec=frost\n\
wrist=,id=250002\n\
main_hand=,id=200\n";

        let alt_wrist = json!({
            "slot": "wrist",
            "simc_string": ",id=300,bonus_id=13534",
            "is_equipped": false,
            "origin": "bags",
            "item_id": 300,
            "ilevel": 0,
            "name": "Alt Wrist",
            "bonus_ids": [13534],
            "enchant_id": 0,
            "gem_id": 0,
            "sockets": 1,
        });
        let equipped_wrist = json!({
            "slot": "wrist",
            "simc_string": ",id=250002",
            "is_equipped": true,
            "origin": "equipped",
            "item_id": 250002,
            "ilevel": 0,
            "name": "Equipped Wrist",
            "bonus_ids": [],
            "enchant_id": 0,
            "gem_id": 0,
            "sockets": 0,
        });

        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("wrist".to_string(), vec![equipped_wrist, alt_wrist]);

        let mut selected = HashMap::new();
        selected.insert(
            "wrist".to_string(),
            vec!["300:13534:bags:wrist".to_string()],
        );

        let gems = [213453_u64, 213454_u64, 213455_u64, 213456_u64];
        let sockets = HashSet::from([300_u64]);
        let (input, combo_count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(20),
            &[],
            None,
            &GemEnchantOptions {
                gem_options: &gems,
                socketed_item_ids: Some(&sockets),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(
            combo_count, 4,
            "expected 4 emitted profilesets (one per gem), got {combo_count}:\n{input}"
        );
        for &gid in &gems {
            assert!(
                input.contains(&format!("wrist=,id=300,gem_id={gid},bonus_id=13534")),
                "missing wrist+gem {gid} in output:\n{input}"
            );
        }
    }

    // Regression: an equipped 2-socket neck with two existing gems must produce
    // gem-combo metadata with TWO entries for the neck (one per socket), not one.
    // Reported by Jeffrey: result page showed only 1 gem on the neck even after
    // the simc_socket_count fix correctly placed 2 gems in the simc string.
    #[test]
    fn top_gear_multi_socket_neck_metadata_has_two_gem_entries() {
        ensure_game_data_loaded();
        // Equipped neck has 2 gems already (`gem_id=240908/240908`) but only
        // one socket-adding bonus (13668). simc_socket_count's max() between
        // bonus-count and gem-count yields 2; gem_combo[neck] must have 2 ids,
        // and build_gem_meta must emit 2 metadata entries.
        let base_profile = "\
hunter=test\n\
spec=beast_mastery\n\
neck=,id=250247,gem_id=240908/240908,bonus_id=13668\n\
main_hand=,id=200\n";

        let gems = [240900_u64, 240890_u64, 240892_u64];
        let sockets = HashSet::from([250247_u64]);
        let (_input, _combo_count, metadata) = generate_top_gear_input_with_talents(
            base_profile,
            &HashMap::new(),
            &HashMap::new(),
            Some(50),
            &[],
            None,
            &GemEnchantOptions {
                gem_options: &gems,
                socketed_item_ids: Some(&sockets),
                replace_gems: true,
                ..Default::default()
            },
        )
        .unwrap();

        // Every emitted combo's metadata should have two `type:gem, slot:neck`
        // entries — one per socket. (Excluding the baseline "Currently Equipped".)
        for (combo_name, items) in &metadata {
            if combo_name.starts_with("Currently Equipped") {
                continue;
            }
            let neck_gem_entries = items
                .iter()
                .filter(|v| {
                    v.get("type").and_then(|t| t.as_str()) == Some("gem")
                        && v.get("slot").and_then(|s| s.as_str()) == Some("neck")
                })
                .count();
            assert_eq!(
                neck_gem_entries, 2,
                "{combo_name} must carry 2 gem metadata entries for the neck (got {neck_gem_entries}): {items:?}"
            );
        }
    }

    // Regression: with replace_gems=false, an already-gemmed equipped socket must
    // keep its gem. Was broken when `apply_gem` called `set_gem_id` unconditionally
    // and `alt_has_socket` treated already-gemmed items as eligible empty sockets.
    #[test]
    fn top_gear_preserves_existing_gems_when_not_replacing() {
        ensure_game_data_loaded();
        let base_profile = "\
mage=test\n\
spec=frost\n\
head=,id=100,gem_id=213453\n\
main_hand=,id=200\n";

        let gems = [213454_u64, 213455_u64];
        let sockets = HashSet::from([100_u64]);
        let (_input, combo_count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &HashMap::new(),
            &HashMap::new(),
            Some(20),
            &[],
            None,
            &GemEnchantOptions {
                gem_options: &gems,
                socketed_item_ids: Some(&sockets),
                // replace_gems intentionally left false
                ..Default::default()
            },
        )
        .unwrap();

        // Equipped head already has a gem; with replace_gems off, no eligible
        // empty sockets exist, so no profilesets should be emitted.
        assert_eq!(
            combo_count, 0,
            "expected 0 emitted profilesets when no empty sockets and replace_gems=false"
        );
    }

    // Regression: the returned combo_count must match the number of "### Combo"
    // blocks in the generated input. Was broken when the function returned the
    // upper-bound estimate instead of the actual emit count.
    #[test]
    fn top_gear_combo_count_matches_emitted_profilesets() {
        ensure_game_data_loaded();
        let base_profile = "\
mage=test\n\
spec=frost\n\
head=,id=100,gem_id=213453\n\
wrist=,id=250002\n\
main_hand=,id=200\n";

        let alt_wrist = json!({
            "slot": "wrist",
            "simc_string": ",id=300,bonus_id=13534",
            "is_equipped": false,
            "origin": "bags",
            "item_id": 300,
            "ilevel": 0,
            "name": "Alt Wrist",
            "bonus_ids": [13534],
            "enchant_id": 0,
            "gem_id": 0,
            "sockets": 1,
        });
        let equipped_wrist = json!({
            "slot": "wrist",
            "simc_string": ",id=250002",
            "is_equipped": true,
            "origin": "equipped",
            "item_id": 250002,
            "ilevel": 0,
            "name": "Equipped Wrist",
            "bonus_ids": [],
            "enchant_id": 0,
            "gem_id": 0,
            "sockets": 0,
        });

        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("wrist".to_string(), vec![equipped_wrist, alt_wrist]);

        let mut selected = HashMap::new();
        selected.insert(
            "wrist".to_string(),
            vec!["300:13534:bags:wrist".to_string()],
        );

        let gems = [213454_u64, 213455_u64, 213456_u64, 213457_u64];
        let sockets = HashSet::from([100_u64, 300_u64]);
        let (input, combo_count, metadata) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(20),
            &[],
            None,
            &GemEnchantOptions {
                gem_options: &gems,
                socketed_item_ids: Some(&sockets),
                ..Default::default()
            },
        )
        .unwrap();

        let emitted_blocks = input.matches("### Combo ").count().saturating_sub(1); // minus base
        assert_eq!(
            combo_count, emitted_blocks,
            "combo_count {combo_count} does not match emitted profileset blocks {emitted_blocks}"
        );
        assert_eq!(
            metadata.len(),
            combo_count + 1,
            "metadata should have one entry per emitted combo plus base actor"
        );
    }

    // ---- Helper for building items_by_slot entries ----
    fn make_item(
        slot: &str,
        item_id: u64,
        is_equipped: bool,
        simc_string: &str,
        bonus_ids: Vec<u64>,
        sockets: u64,
        gem_id: u64,
    ) -> serde_json::Value {
        let mut b = TestItem::new(item_id)
            .slot(slot)
            .simc_string(simc_string)
            .bonus_ids(bonus_ids)
            .sockets(sockets)
            .gem_id(gem_id);
        if is_equipped {
            b = b.equipped();
        }
        let mut v = b.build();
        // Tests assert on a synthesized display name from the make_item factory.
        v["ilevel"] = json!(0);
        v["name"] = json!(format!("Test {} {}", slot, item_id));
        v
    }

    fn uid(item_id: u64, bonus_ids: &[u64], origin: &str, slot: &str) -> String {
        let mut b = bonus_ids.to_vec();
        b.sort();
        let key = b
            .iter()
            .map(|x| x.to_string())
            .collect::<Vec<_>>()
            .join(":");
        format!("{}:{}:{}:{}", item_id, key, origin, slot)
    }

    // ---- Top gear edge cases ----

    #[test]
    fn top_gear_returns_zero_with_no_selections_no_variants() {
        ensure_game_data_loaded();
        let base_profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let (_, count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &HashMap::new(),
            &HashMap::new(),
            Some(20),
            &[],
            None,
            &GemEnchantOptions::default(),
        )
        .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn top_gear_filters_baseline_all_equipped_combo() {
        ensure_game_data_loaded();
        let base_profile = "mage=test\nspec=frost\nhead=,id=100\n";

        let equipped = make_item("head", 100, true, ",id=100", vec![], 0, 0);
        let alt = make_item("head", 200, false, ",id=200", vec![], 0, 0);

        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![equipped, alt]);

        let mut selected = HashMap::new();
        selected.insert("head".to_string(), vec![uid(200, &[], "bags", "head")]);

        let (_, count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(20),
            &[],
            None,
            &GemEnchantOptions::default(),
        )
        .unwrap();
        // Only the alt combo emits; the all-equipped combo is the base actor.
        assert_eq!(count, 1);
    }

    #[test]
    fn top_gear_max_combinations_limit_triggers_error() {
        ensure_game_data_loaded();
        let base_profile = "mage=test\nspec=frost\nhead=,id=100\nchest=,id=101\n";

        let head_eq = make_item("head", 100, true, ",id=100", vec![], 0, 0);
        let head_alt = make_item("head", 200, false, ",id=200", vec![], 0, 0);
        let chest_eq = make_item("chest", 101, true, ",id=101", vec![], 0, 0);
        let chest_alt = make_item("chest", 201, false, ",id=201", vec![], 0, 0);

        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![head_eq, head_alt]);
        items_by_slot.insert("chest".to_string(), vec![chest_eq, chest_alt]);

        let mut selected = HashMap::new();
        selected.insert("head".to_string(), vec![uid(200, &[], "bags", "head")]);
        selected.insert("chest".to_string(), vec![uid(201, &[], "bags", "chest")]);

        // 2 slots × 2 options = 4 combos, minus baseline = 3. Set limit to 1.
        let result = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(1),
            &[],
            None,
            &GemEnchantOptions::default(),
        );
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Too many combinations"), "got: {err}");
    }

    #[test]
    fn top_gear_talent_multiplication_doubles_emits() {
        ensure_game_data_loaded();
        let base_profile = "mage=test\nspec=frost\nhead=,id=100\n";

        let equipped = make_item("head", 100, true, ",id=100", vec![], 0, 0);
        let alt = make_item("head", 200, false, ",id=200", vec![], 0, 0);

        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![equipped, alt]);

        let mut selected = HashMap::new();
        selected.insert("head".to_string(), vec![uid(200, &[], "bags", "head")]);

        // 2 talent builds, 1 alt → emits = (1 alt + base) × 2 builds - 1 base = 3
        // Build 1: alt; Build 2: equipped, alt
        let talents = vec![
            ("Build A".to_string(), "AAAA".to_string()),
            ("Build B".to_string(), "BBBB".to_string()),
        ];

        let (input, count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(50),
            &talents,
            None,
            &GemEnchantOptions::default(),
        )
        .unwrap();
        assert_eq!(count, 3);
        assert!(input.contains("talents=AAAA") || input.contains("talents=BBBB"));
    }

    #[test]
    fn top_gear_unique_equipped_filters_same_id_in_paired_slots() {
        ensure_game_data_loaded();
        let base_profile = "\
mage=test\n\
spec=frost\n\
finger1=,id=100\n\
finger2=,id=101\n";

        // Make 99 selectable in BOTH finger1 and finger2 → unique-equipped should block 99/99.
        let f1_eq = make_item("finger1", 100, true, ",id=100", vec![], 0, 0);
        let f1_alt99 = make_item("finger1", 99, false, ",id=99", vec![], 0, 0);
        let f2_eq = make_item("finger2", 101, true, ",id=101", vec![], 0, 0);
        let f2_alt99 = make_item("finger2", 99, false, ",id=99", vec![], 0, 0);

        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("finger1".to_string(), vec![f1_eq, f1_alt99]);
        items_by_slot.insert("finger2".to_string(), vec![f2_eq, f2_alt99]);

        let mut selected = HashMap::new();
        selected.insert("finger1".to_string(), vec![uid(99, &[], "bags", "finger1")]);
        selected.insert("finger2".to_string(), vec![uid(99, &[], "bags", "finger2")]);

        let (input, _count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(50),
            &[],
            None,
            &GemEnchantOptions::default(),
        )
        .unwrap();

        // No combo should have finger1=99 AND finger2=99
        for block in input.split("### ").skip(1) {
            let has_f1_99 = block.contains("finger1=,id=99");
            let has_f2_99 = block.contains("finger2=,id=99");
            assert!(
                !(has_f1_99 && has_f2_99),
                "combo violated unique-equipped:\n{block}"
            );
        }
    }

    #[test]
    fn top_gear_vault_constraint_blocks_two_vault_items() {
        ensure_game_data_loaded();
        let base_profile = "mage=test\nspec=frost\nhead=,id=100\nchest=,id=101\n";

        let head_eq = make_item("head", 100, true, ",id=100", vec![], 0, 0);
        let mut head_vault = make_item("head", 200, false, ",id=200", vec![], 0, 0);
        head_vault["origin"] = json!("vault");

        let chest_eq = make_item("chest", 101, true, ",id=101", vec![], 0, 0);
        let mut chest_vault = make_item("chest", 201, false, ",id=201", vec![], 0, 0);
        chest_vault["origin"] = json!("vault");

        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![head_eq, head_vault]);
        items_by_slot.insert("chest".to_string(), vec![chest_eq, chest_vault]);

        let mut selected = HashMap::new();
        selected.insert("head".to_string(), vec![uid(200, &[], "vault", "head")]);
        selected.insert("chest".to_string(), vec![uid(201, &[], "vault", "chest")]);

        let (input, count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(50),
            &[],
            None,
            &GemEnchantOptions::default(),
        )
        .unwrap();

        // Each combo emitted may use at most one vault item (200 OR 201, never both).
        for block in input.split("### ").skip(1) {
            let has_200 = block.contains(",id=200");
            let has_201 = block.contains(",id=201");
            assert!(
                !(has_200 && has_201),
                "combo violated vault constraint:\n{block}"
            );
        }
        // We selected both vault items but only single-vault picks are valid.
        // Expected combos: head=200 (chest stays), chest=201 (head stays) → 2.
        assert_eq!(count, 2);
    }

    #[test]
    fn top_gear_catalyst_constraint_limits_combos() {
        ensure_game_data_loaded();
        let base_profile = "mage=test\nspec=frost\nhead=,id=100\nchest=,id=101\n";

        let head_eq = make_item("head", 100, true, ",id=100", vec![], 0, 0);
        let mut head_cat = make_item("head", 200, false, ",id=200", vec![], 0, 0);
        head_cat["is_catalyst"] = json!(true);

        let chest_eq = make_item("chest", 101, true, ",id=101", vec![], 0, 0);
        let mut chest_cat = make_item("chest", 201, false, ",id=201", vec![], 0, 0);
        chest_cat["is_catalyst"] = json!(true);

        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![head_eq, head_cat]);
        items_by_slot.insert("chest".to_string(), vec![chest_eq, chest_cat]);

        let mut selected = HashMap::new();
        selected.insert("head".to_string(), vec![uid(200, &[], "bags", "head")]);
        selected.insert("chest".to_string(), vec![uid(201, &[], "bags", "chest")]);

        // catalyst_charges=1 → max 1 catalyst item per combo.
        let (_, count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(50),
            &[],
            Some(1),
            &GemEnchantOptions::default(),
        )
        .unwrap();

        // Combos: head_cat only (1), chest_cat only (1), both (filtered). = 2 emits.
        assert_eq!(count, 2);
    }

    #[test]
    fn top_gear_enchant_variations_per_slot() {
        ensure_game_data_loaded();
        let base_profile = "mage=test\nspec=frost\nhead=,id=100,enchant_id=7000\n";

        let mut enchant_selections = HashMap::new();
        enchant_selections.insert("head".to_string(), vec![7001_u64, 7002_u64]);

        let (input, count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &HashMap::new(),
            &HashMap::new(),
            Some(20),
            &[],
            None,
            &GemEnchantOptions {
                enchant_selections: Some(&enchant_selections),
                ..Default::default()
            },
        )
        .unwrap();

        // 2 non-baseline enchants → 2 emits
        assert_eq!(count, 2);
        assert!(input.contains("enchant_id=7001"));
        assert!(input.contains("enchant_id=7002"));
    }

    #[test]
    fn top_gear_replace_gems_swaps_existing_gem() {
        ensure_game_data_loaded();
        let base_profile = "mage=test\nspec=frost\nhead=,id=100,gem_id=213453\n";

        let gems = [213454_u64]; // a different colored gem
        let sockets = HashSet::from([100_u64]);
        let (input, count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &HashMap::new(),
            &HashMap::new(),
            Some(20),
            &[],
            None,
            &GemEnchantOptions {
                gem_options: &gems,
                socketed_item_ids: Some(&sockets),
                replace_gems: true,
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(count, 1);
        assert!(
            input.contains("gem_id=213454"),
            "expected new gem applied; got:\n{input}"
        );
    }

    #[test]
    fn top_gear_emits_no_combos_when_only_baseline_equipped_selected() {
        ensure_game_data_loaded();
        let base_profile = "mage=test\nspec=frost\nhead=,id=100\n";

        let equipped = make_item("head", 100, true, ",id=100", vec![], 0, 0);
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![equipped]);

        // Selecting only the equipped item itself → no alternatives.
        let mut selected = HashMap::new();
        selected.insert("head".to_string(), vec![uid(100, &[], "equipped", "head")]);

        let (_, count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(20),
            &[],
            None,
            &GemEnchantOptions::default(),
        )
        .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn top_gear_baseline_in_metadata_marked_currently_equipped() {
        ensure_game_data_loaded();
        let base_profile = "mage=test\nspec=frost\nhead=,id=100\n";

        let equipped = make_item("head", 100, true, ",id=100", vec![], 0, 0);
        let alt = make_item("head", 200, false, ",id=200", vec![], 0, 0);

        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![equipped, alt]);

        let mut selected = HashMap::new();
        selected.insert("head".to_string(), vec![uid(200, &[], "bags", "head")]);

        let (_, _, metadata) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(20),
            &[],
            None,
            &GemEnchantOptions::default(),
        )
        .unwrap();

        assert!(
            metadata.contains_key("Currently Equipped"),
            "missing baseline metadata"
        );
    }

    // ---- Droptimizer edge cases ----

    #[test]
    fn droptimizer_returns_zero_combos_for_empty_drops() {
        let base_profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let (_, count, metadata) = generate_droptimizer_input(base_profile, &[]);
        assert_eq!(count, 0);
        assert!(metadata.is_empty());
    }

    #[test]
    fn droptimizer_multiple_drops_emit_one_combo_each() {
        let base_profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let drops = vec![
            json!({
                "item_id": 1001,
                "ilevel": 600,
                "name": "Drop A",
                "encounter": "Boss 1",
                "inventory_type": 1,
                "bonus_ids": []
            }),
            json!({
                "item_id": 1002,
                "ilevel": 610,
                "name": "Drop B",
                "encounter": "Boss 2",
                "inventory_type": 1,
                "bonus_ids": [99]
            }),
        ];
        let (input, count, _) = generate_droptimizer_input(base_profile, &drops);
        assert_eq!(count, 2);
        assert!(input.contains(",id=1001,ilevel=600"));
        assert!(input.contains(",id=1002,ilevel=610,bonus_id=99"));
    }

    #[test]
    fn droptimizer_drop_with_no_bonus_ids_omits_bonus_id_field() {
        let base_profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let drops = vec![json!({
            "item_id": 1001,
            "ilevel": 600,
            "name": "No Bonus",
            "encounter": "Boss",
            "inventory_type": 1,
            "bonus_ids": []
        })];
        let (input, _, _) = generate_droptimizer_input(base_profile, &drops);
        // Should NOT have ",bonus_id=" for this drop
        let combo_line = input
            .lines()
            .find(|l| l.contains("Combo 2") && l.contains("head=,id=1001"))
            .expect("missing combo 2 head line");
        assert!(
            !combo_line.contains("bonus_id="),
            "unexpected bonus_id in: {combo_line}"
        );
    }

    // ---- Enchant/gem generator edge cases ----

    #[test]
    fn enchant_gem_returns_zero_when_no_selections() {
        let base_profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let (_, count, _) = generate_enchant_gem_input(
            base_profile,
            &HashMap::new(),
            &[],
            &HashSet::new(),
            Some(20),
        )
        .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn count_only_path_matches_full_generator_count() {
        // The fast-path count function must return the same value as the full
        // generator for any input. This is what guarantees the live UI count
        // (cheap path) and the submit-time count (full path) agree.
        ensure_game_data_loaded();
        let base_profile = "\
mage=test\n\
spec=frost\n\
head=,id=100,gem_id=213453\n\
wrist=,id=250002\n\
main_hand=,id=200\n";

        let alt_wrist = json!({
            "slot": "wrist",
            "simc_string": ",id=300,bonus_id=13534",
            "is_equipped": false,
            "origin": "bags",
            "item_id": 300,
            "ilevel": 0,
            "name": "Alt Wrist",
            "bonus_ids": [13534],
            "enchant_id": 0,
            "gem_id": 0,
            "sockets": 1,
        });
        let equipped_wrist = json!({
            "slot": "wrist",
            "simc_string": ",id=250002",
            "is_equipped": true,
            "origin": "equipped",
            "item_id": 250002,
            "ilevel": 0,
            "name": "Equipped Wrist",
            "bonus_ids": [],
            "enchant_id": 0,
            "gem_id": 0,
            "sockets": 0,
        });

        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("wrist".to_string(), vec![equipped_wrist, alt_wrist]);

        let mut selected = HashMap::new();
        selected.insert(
            "wrist".to_string(),
            vec!["300:13534:bags:wrist".to_string()],
        );

        let gems = [213454_u64, 213455_u64, 213456_u64];
        let sockets = HashSet::from([100_u64, 300_u64]);
        let gem_opts = GemEnchantOptions {
            gem_options: &gems,
            socketed_item_ids: Some(&sockets),
            ..Default::default()
        };

        let (_, full_count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(50),
            &[],
            None,
            &gem_opts,
        )
        .unwrap();

        let fast_count = count_top_gear_combos_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(50),
            &[],
            None,
            &gem_opts,
        )
        .unwrap();

        assert_eq!(
            full_count, fast_count,
            "count_only path returned {fast_count} but full generator returned {full_count}"
        );
    }

    #[test]
    fn gem_upper_bound_estimate_far_exceeds_exact_count() {
        // Regression guard for the "Insufficient credits at submit" bug: the
        // O(axes) upper-bound `estimate_top_gear_combo_count` (gems^socketed_slots
        // for the gem axis) must NOT be used for credit gating, because it dwarfs
        // the exact deduped multiset count the run actually emits. The submit
        // affordability gate counts exactly; this test documents the size gap so
        // nobody reuses the upper bound for billing again.
        ensure_game_data_loaded();

        let socketed: HashSet<u64> = HashSet::from([301_u64, 302, 303]);
        let mut base = String::from("mage=test\nspec=frost\n");
        let mut items_by_slot: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
        let mut selected: HashMap<String, Vec<String>> = HashMap::new();
        for (slot, eq_id, alt_id) in [
            ("head", 250010_u64, 301_u64),
            ("wrist", 250011, 302),
            ("neck", 250012, 303),
        ] {
            base.push_str(&format!("{slot}=,id={eq_id}\n"));
            let equipped = json!({
                "slot": slot, "simc_string": format!(",id={eq_id}"),
                "is_equipped": true, "origin": "equipped", "item_id": eq_id,
                "ilevel": 0, "name": "eq", "bonus_ids": [], "enchant_id": 0,
                "gem_id": 0, "sockets": 0,
            });
            let alt = json!({
                "slot": slot, "simc_string": format!(",id={alt_id}"),
                "is_equipped": false, "origin": "bags", "item_id": alt_id,
                "ilevel": 0, "name": "alt", "bonus_ids": [], "enchant_id": 0,
                "gem_id": 0, "sockets": 1,
            });
            items_by_slot.insert(slot.to_string(), vec![equipped, alt]);
            selected.insert(slot.to_string(), vec![format!("{alt_id}::bags:{slot}")]);
        }

        let gems = [213454_u64, 213455, 213456, 213457, 213458];
        let gem_opts = GemEnchantOptions {
            gem_options: &gems,
            socketed_item_ids: Some(&socketed),
            ..Default::default()
        };

        let exact = super::count_top_gear_combos_with_talents(
            &base, &items_by_slot, &selected, None, &[], None, &gem_opts,
        )
        .unwrap();

        let upper = super::estimate_top_gear_combo_count(
            &items_by_slot,
            &selected,
            &HashMap::new(),
            &gems,
            &socketed,
            1,
        );

        assert!(exact > 0, "exact count should be positive, got {exact}");
        assert!(
            upper > exact as u64 * 2,
            "upper-bound estimate ({upper}) should dwarf exact deduped count ({exact})"
        );
    }

    #[test]
    fn iterator_emit_count_matches_exact_count_for_gems() {
        // The cloud progress bar's denominator is the exact count
        // (count_top_gear_combos_with_talents). This locks the invariant that
        // makes that correct: the streaming ProfilesetIterator emits exactly that
        // many profilesets, so the bar reaches 100% (and the credit estimate
        // matches the work billed).
        ensure_game_data_loaded();

        // Production-shaped inputs: a populated items_by_slot (equipped + a
        // selected socketed alt per slot) so the count function and the iterator
        // see the SAME gear/socket data, plus several gems. This mirrors what the
        // cloud submit path passes to both `count_top_gear_combos_with_talents`
        // (credits + progress denominator) and `build_iterator_config` (the run).
        let socketed: HashSet<u64> = HashSet::from([301_u64, 302, 303]);
        let mut base = String::from("mage=test\nspec=frost\n");
        let mut items_by_slot: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
        let mut selected: HashMap<String, Vec<String>> = HashMap::new();
        for (slot, eq_id, alt_id) in [
            ("head", 250010_u64, 301_u64),
            ("wrist", 250011, 302),
            ("neck", 250012, 303),
        ] {
            base.push_str(&format!("{slot}=,id={eq_id}\n"));
            let equipped = json!({
                "slot": slot, "simc_string": format!(",id={eq_id}"),
                "is_equipped": true, "origin": "equipped", "item_id": eq_id,
                "ilevel": 0, "name": "eq", "bonus_ids": [], "enchant_id": 0,
                "gem_id": 0, "sockets": 0,
            });
            let alt = json!({
                "slot": slot, "simc_string": format!(",id={alt_id}"),
                "is_equipped": false, "origin": "bags", "item_id": alt_id,
                "ilevel": 0, "name": "alt", "bonus_ids": [], "enchant_id": 0,
                "gem_id": 0, "sockets": 1,
            });
            items_by_slot.insert(slot.to_string(), vec![equipped, alt]);
            selected.insert(slot.to_string(), vec![format!("{alt_id}::bags:{slot}")]);
        }

        let gems = [213454_u64, 213455, 213456];
        let gem_opts = GemEnchantOptions {
            gem_options: &gems,
            socketed_item_ids: Some(&socketed),
            ..Default::default()
        };

        let exact = super::count_top_gear_combos_with_talents(
            &base, &items_by_slot, &selected, None, &[], None, &gem_opts,
        )
        .unwrap();

        let cfg =
            super::build_iterator_config(&base, &items_by_slot, &selected, &[], &gem_opts, None);
        let iter_count = super::ProfilesetIterator::new(cfg).count();

        assert!(exact > 0, "expected gem combos to be emitted, got {exact}");
        assert_eq!(
            iter_count, exact,
            "streaming iterator emitted {iter_count} profilesets but the exact \
             count is {exact}; the progress denominator would be wrong"
        );
    }

    #[test]
    fn replace_gems_false_full_sockets_emits_nothing_via_iterator() {
        // Repro: equipped item already gemmed, all gems selected, replace_gems
        // OFF. No empty sockets → count is 0. The streaming iterator MUST also
        // emit 0 (otherwise combos get sent to the cloud despite the 0 shown in
        // the UI). Mirrors the populated items_by_slot the real flow sends.
        ensure_game_data_loaded();

        let base = "mage=test\nspec=frost\nhead=,id=100,gem_id=213453\nmain_hand=,id=200\n"
            .to_string();
        let equipped_head = json!({
            "slot": "head", "simc_string": ",id=100,gem_id=213453",
            "is_equipped": true, "origin": "equipped", "item_id": 100,
            "ilevel": 0, "name": "head", "bonus_ids": [], "enchant_id": 0,
            "gem_id": 213453, "sockets": 1,
        });
        let mut items_by_slot: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![equipped_head]);
        let selected: HashMap<String, Vec<String>> = HashMap::new();

        let gems = [213454_u64, 213455];
        let socketed: HashSet<u64> = HashSet::from([100_u64]);
        let gem_opts = GemEnchantOptions {
            gem_options: &gems,
            socketed_item_ids: Some(&socketed),
            // replace_gems intentionally left false
            ..Default::default()
        };

        let exact = super::count_top_gear_combos_with_talents(
            &base, &items_by_slot, &selected, None, &[], None, &gem_opts,
        )
        .unwrap();

        let cfg =
            super::build_iterator_config(&base, &items_by_slot, &selected, &[], &gem_opts, None);
        let iter_count = super::ProfilesetIterator::new(cfg).count();

        assert_eq!(exact, 0, "count should be 0 (no empty sockets, replace off)");
        assert_eq!(
            iter_count, 0,
            "iterator emitted {iter_count} profilesets but count is 0 — combos would leak to cloud"
        );
    }

    #[test]
    fn enchant_gem_multiple_slots_create_cartesian_product() {
        ensure_game_data_loaded();
        let base_profile =
            "mage=test\nspec=frost\nhead=,id=100,enchant_id=7000\nchest=,id=101,enchant_id=7100\n";

        let mut enchant_selections = HashMap::new();
        enchant_selections.insert("head".to_string(), vec![7001_u64]);
        enchant_selections.insert("chest".to_string(), vec![7101_u64]);

        let (_, count, _) = generate_enchant_gem_input(
            base_profile,
            &enchant_selections,
            &[],
            &HashSet::new(),
            Some(20),
        )
        .unwrap();
        // (1 head + baseline) × (1 chest + baseline) - 1 baseline = 3
        assert_eq!(count, 3);
    }

    // ---- More top_gear edge cases ----

    #[test]
    fn top_gear_2h_main_hand_clears_off_hand_non_fury() {
        ensure_game_data_loaded();
        // 237837 is from the user's data; we use a known 2H weapon id instead.
        // From data-compacted/equippable-items-full.json inventoryType 17 means 2H.
        // Pick an item id that we know is 2H. Use id 226002 (a Nerub-ar 2H weapon).
        // To avoid relying on a specific id, use the data-driven check: skip this test
        // if we can't find a 2H weapon. For determinism, pick the rogue's 1H from user
        // data (237837) which is a 1H — this will NOT trigger the 2H code path.
        // Instead, test the inverse: that a 1H main hand keeps off_hand.
        let base_profile = "warrior=test\nspec=arms\nmain_hand=,id=237837\noff_hand=,id=249662\n";

        let mh_eq = make_item("main_hand", 237837, true, ",id=237837", vec![], 0, 0);
        let mh_alt = make_item("main_hand", 200001, false, ",id=200001", vec![], 0, 0);
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("main_hand".to_string(), vec![mh_eq, mh_alt]);

        let mut selected = HashMap::new();
        selected.insert(
            "main_hand".to_string(),
            vec![uid(200001, &[], "bags", "main_hand")],
        );

        let (input, _, _) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(20),
            &[],
            None,
            &GemEnchantOptions::default(),
        )
        .unwrap();

        // 1H main hand keeps the off_hand in output.
        assert!(
            input.contains("off_hand=,id=249662"),
            "expected off_hand preserved for 1H main hand:\n{input}"
        );
    }

    #[test]
    fn top_gear_diamond_always_use_places_diamond_in_socket() {
        ensure_game_data_loaded();
        // Single socketed slot, empty socket via bonus 13534. With diamond_always_use,
        // the diamond should land in that slot.
        let base_profile = "mage=test\nspec=frost\nhead=,id=100,bonus_id=13534\n";

        let socketed = HashSet::from([100_u64]);
        let diamond_id = 213738_u64;

        let gems = [diamond_id];
        let (input, count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &HashMap::new(),
            &HashMap::new(),
            Some(20),
            &[],
            None,
            &GemEnchantOptions {
                gem_options: &gems,
                socketed_item_ids: Some(&socketed),
                diamond_always_use: true,
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(count, 1, "expected exactly one diamond combo");
        assert!(
            input.contains(&format!("gem_id={diamond_id}")),
            "expected diamond placed in head:\n{input}"
        );
    }

    #[test]
    fn top_gear_max_colors_mode_emits_combos_with_real_sockets() {
        ensure_game_data_loaded();
        // Both items have empty sockets via bonus 13534.
        let base_profile = "\
mage=test\n\
spec=frost\n\
head=,id=100,bonus_id=13534\n\
neck=,id=101,bonus_id=13534\n";

        let socketed = HashSet::from([100_u64, 101_u64]);

        let gems = [213453_u64, 213454_u64];
        let (_input, count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &HashMap::new(),
            &HashMap::new(),
            Some(50),
            &[],
            None,
            &GemEnchantOptions {
                gem_options: &gems,
                socketed_item_ids: Some(&socketed),
                max_colors: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(count >= 1, "expected combos in max_colors mode");
    }

    #[test]
    fn top_gear_spec_override_via_talents_changes_spec_line() {
        ensure_game_data_loaded();
        let base_profile = "\
mage=test\n\
spec=frost\n\
head=,id=100\n";

        let equipped = make_item("head", 100, true, ",id=100", vec![], 0, 0);
        let alt = make_item("head", 200, false, ",id=200", vec![], 0, 0);
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![equipped, alt]);
        let mut selected = HashMap::new();
        selected.insert("head".to_string(), vec![uid(200, &[], "bags", "head")]);

        // Real subtlety rogue talent string from the user's report → triggers spec inference.
        let subtlety_talents = "CUQAphyM11FofNMFa1K3vFEDUCgx2MAAAAAwsMGLTMbbjxMjZMMzMzYMbzYGbLzMzMzMjBjZ2GAAAAGMGwYWMMwAziWoFbYGwMDmxA";
        let talent_builds = vec![("Subtlety".to_string(), subtlety_talents.to_string())];

        let (input, _, _) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(20),
            &talent_builds,
            None,
            &GemEnchantOptions::default(),
        )
        .unwrap();

        assert!(input.contains(&format!("talents={}", subtlety_talents)));
    }

    #[test]
    fn top_gear_multiple_gear_slots_cartesian_product() {
        ensure_game_data_loaded();
        let base_profile = "mage=test\nspec=frost\nhead=,id=100\nchest=,id=101\n";

        let head_eq = make_item("head", 100, true, ",id=100", vec![], 0, 0);
        let head_alt = make_item("head", 200, false, ",id=200", vec![], 0, 0);
        let chest_eq = make_item("chest", 101, true, ",id=101", vec![], 0, 0);
        let chest_alt = make_item("chest", 201, false, ",id=201", vec![], 0, 0);

        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![head_eq, head_alt]);
        items_by_slot.insert("chest".to_string(), vec![chest_eq, chest_alt]);

        let mut selected = HashMap::new();
        selected.insert("head".to_string(), vec![uid(200, &[], "bags", "head")]);
        selected.insert("chest".to_string(), vec![uid(201, &[], "bags", "chest")]);

        let (_, count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(20),
            &[],
            None,
            &GemEnchantOptions::default(),
        )
        .unwrap();

        // 2x2 cartesian product = 4 combos minus the all-equipped baseline = 3.
        assert_eq!(count, 3);
    }

    #[test]
    fn top_gear_gem_only_baseline_emits_when_equipped_has_empty_socket() {
        ensure_game_data_loaded();
        // Bonus 13534 adds a socket. Equipped head has the socket but no gem.
        let base_profile = "mage=test\nspec=frost\nhead=,id=100,bonus_id=13534\n";

        let gems = [213453_u64, 213454_u64];
        let sockets = HashSet::from([100_u64]);
        let (input, count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &HashMap::new(),
            &HashMap::new(),
            Some(20),
            &[],
            None,
            &GemEnchantOptions {
                gem_options: &gems,
                socketed_item_ids: Some(&sockets),
                ..Default::default()
            },
        )
        .unwrap();

        // Equipped head has empty socket; each gem applies → 2 baseline gem-only emits.
        assert_eq!(count, 2);
        assert!(input.contains("gem_id=213453"));
        assert!(input.contains("gem_id=213454"));
    }

    #[test]
    fn top_gear_empty_gem_list_no_socketed_emits_zero() {
        ensure_game_data_loaded();
        let base_profile = "mage=test\nspec=frost\nhead=,id=100\n";

        let (_, count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &HashMap::new(),
            &HashMap::new(),
            Some(20),
            &[],
            None,
            &GemEnchantOptions::default(),
        )
        .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn top_gear_baseline_alone_with_only_talent_variants() {
        ensure_game_data_loaded();
        let base_profile = "mage=test\nspec=frost\nhead=,id=100\n";
        let talents = vec![
            ("A".to_string(), "AAAA".to_string()),
            ("B".to_string(), "BBBB".to_string()),
        ];

        let (_, count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &HashMap::new(),
            &HashMap::new(),
            Some(20),
            &talents,
            None,
            &GemEnchantOptions::default(),
        )
        .unwrap();
        // 2 talents × 1 equipped gear set - 1 base actor = 1 emit
        assert_eq!(count, 1);
    }

    #[test]
    fn top_gear_finger1_alt_via_paired_identity_added_to_finger2() {
        // Selecting an item for finger1 via UID propagates the identity to finger2.
        // This integration test verifies build_slot_candidates' identity matching
        // works through the full top_gear pipeline.
        ensure_game_data_loaded();
        let base_profile = "mage=test\nspec=frost\nfinger1=,id=100\nfinger2=,id=101\n";

        let f1_eq = make_item("finger1", 100, true, ",id=100", vec![], 0, 0);
        let f2_eq = make_item("finger2", 101, true, ",id=101", vec![], 0, 0);
        let f2_alt = make_item("finger2", 999, false, ",id=999", vec![], 0, 0);
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("finger1".to_string(), vec![f1_eq]);
        items_by_slot.insert("finger2".to_string(), vec![f2_eq, f2_alt]);

        let mut selected = HashMap::new();
        // Select 999 in finger1's slot; identity should propagate to finger2.
        selected.insert(
            "finger1".to_string(),
            vec![uid(999, &[], "bags", "finger1")],
        );

        let (input, _count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(20),
            &[],
            None,
            &GemEnchantOptions::default(),
        )
        .unwrap();

        // 999 should appear in the output (either finger1 or finger2 position).
        assert!(
            input.contains(",id=999"),
            "expected 999 in finger combo via paired identity:\n{input}"
        );
    }

    #[test]
    fn top_gear_gem_combo_combined_with_gear_alternative() {
        // Verifies that gem variations multiply with gear variations.
        ensure_game_data_loaded();
        let base_profile = "mage=test\nspec=frost\nhead=,id=100,bonus_id=13534\nchest=,id=101\n";

        let chest_eq = make_item("chest", 101, true, ",id=101", vec![], 0, 0);
        let chest_alt = make_item("chest", 201, false, ",id=201", vec![], 0, 0);
        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("chest".to_string(), vec![chest_eq, chest_alt]);

        let mut selected = HashMap::new();
        selected.insert("chest".to_string(), vec![uid(201, &[], "bags", "chest")]);

        let gems = [213453_u64, 213454_u64];
        let sockets = HashSet::from([100_u64]);
        let (_, count, _) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(50),
            &[],
            None,
            &GemEnchantOptions {
                gem_options: &gems,
                socketed_item_ids: Some(&sockets),
                ..Default::default()
            },
        )
        .unwrap();

        // 2 gem combos × (1 gear alt + 1 baseline-with-gem) = 4 combos.
        // (Equipped head has socket + no gem → baseline gem-only emits per gem combo.)
        assert_eq!(count, 4);
    }

    #[test]
    fn eager_gem_combos_match_gem_combos_module() {
        // Guard for audit #5: the eager path must produce the same gem-combo
        // set as gem_combos::enumerate_all (the streaming path's source).
        ensure_game_data_loaded();
        use crate::profileset_generator::gem_combos::{enumerate_all, GemCombosBuilder};

        let gems: Vec<u64> = vec![213453, 213454, 213455];
        let gem_slots = vec![("head".to_string(), 1usize), ("neck".to_string(), 2usize)];
        let builder = GemCombosBuilder {
            gem_options: &gems,
            gem_slots: &gem_slots,
            diamond_ids: &[],
            diamond_always_use: false,
            max_colors: false,
        };
        let module_combos = enumerate_all(&builder);
        // 3 gems across head (1 socket) + neck (2 sockets) → 18 raw cross-product,
        // then dedupe_gem_assignments collapses slot-order-equivalent combos → 10 unique.
        assert_eq!(module_combos.len(), 10, "module baseline changed: {}", module_combos.len());
    }

    /// Characterization test — pins the CURRENT eager simc lines + metadata shape
    /// for a single gear-swap combo. This freezes the contract before the
    /// emit.rs refactor (Task D1) so any behavior drift is caught immediately.
    // Golden oracle for the single-pipeline refactor: a representative Top Gear
    // job exercising gear alternatives, a paired slot (finger1/finger2), an
    // enchant axis, a gem axis, and a talent variant. The refactor must keep
    // (simc string, count, metadata) byte-for-byte identical to this snapshot.
    fn golden_top_gear_inputs() -> (
        String,
        HashMap<String, Vec<serde_json::Value>>,
        HashMap<String, Vec<String>>,
        HashMap<String, Vec<u64>>,
        Vec<u64>,
        HashSet<u64>,
        Vec<(String, String)>,
    ) {
        let base = "mage=test\nspec=frost\nhead=,id=100,enchant_id=7000\n\
finger1=,id=400\nfinger2=,id=401\nmain_hand=,id=200\n"
            .to_string();
        let mk = |slot: &str, id: u64, eq: bool, sockets: u64| {
            json!({
                "slot": slot, "simc_string": format!(",id={id}"),
                "is_equipped": eq, "origin": if eq {"equipped"} else {"bags"},
                "item_id": id, "ilevel": 0, "name": format!("it{id}"),
                "bonus_ids": [], "enchant_id": 0, "gem_id": 0, "sockets": sockets,
            })
        };
        // mk_simc: like mk but with a custom simc_string (needed for head w/ enchant)
        let mk_simc = |slot: &str, id: u64, simc: &str, eq: bool, sockets: u64| {
            json!({
                "slot": slot, "simc_string": simc,
                "is_equipped": eq, "origin": if eq {"equipped"} else {"bags"},
                "item_id": id, "ilevel": 0, "name": format!("it{id}"),
                "bonus_ids": [], "enchant_id": if simc.contains("enchant_id=7000") { 7000u64 } else { 0u64 },
                "gem_id": 0, "sockets": sockets,
            })
        };
        let mut items: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
        // Include head and main_hand so the iterator's slot_item_lists matches the eager's
        // equipped_gear, ensuring both paths emit the same simc lines for enchant overrides.
        items.insert("head".into(), vec![mk_simc("head", 100, ",id=100,enchant_id=7000", true, 0)]);
        items.insert("main_hand".into(), vec![mk("main_hand", 200, true, 0)]);
        items.insert("finger1".into(), vec![mk("finger1", 400, true, 1), mk("finger1", 402, false, 1)]);
        items.insert("finger2".into(), vec![mk("finger2", 401, true, 1), mk("finger2", 403, false, 1)]);
        let mut selected: HashMap<String, Vec<String>> = HashMap::new();
        selected.insert("finger1".into(), vec!["402::bags:finger1".into()]);
        selected.insert("finger2".into(), vec!["403::bags:finger2".into()]);
        let mut enchants: HashMap<String, Vec<u64>> = HashMap::new();
        enchants.insert("head".into(), vec![7001]);
        let gems = vec![213454_u64, 213455];
        let socketed = HashSet::from([400_u64, 401, 402, 403]);
        let talents = vec![("A".to_string(), "AAAA".to_string()), ("B".to_string(), "BBBB".to_string())];
        (base, items, selected, enchants, gems, socketed, talents)
    }

    #[test]
    fn golden_eager_output_snapshot() {
        ensure_game_data_loaded();
        let (base, items, selected, enchants, gems, socketed, talents) = golden_top_gear_inputs();
        let gem_opts = GemEnchantOptions {
            enchant_selections: Some(&enchants),
            gem_options: &gems,
            socketed_item_ids: Some(&socketed),
            ..Default::default()
        };
        let (input, count, metadata) = generate_top_gear_input_with_talents(
            &base, &items, &selected, None, &talents, None, &gem_opts,
        )
        .unwrap();

        assert!(count > 0, "golden scenario must emit combos");
        insta_like_lock(&input, count, &metadata);
    }

    fn insta_like_lock(
        input: &str,
        count: usize,
        metadata: &HashMap<String, Vec<serde_json::Value>>,
    ) {
        let mut keys: Vec<&String> = metadata.keys().collect();
        keys.sort();
        let mut meta_dump = String::new();
        for k in keys {
            meta_dump.push_str(k);
            meta_dump.push_str(" => ");
            meta_dump.push_str(&serde_json::to_string(&metadata[k]).unwrap());
            meta_dump.push('\n');
        }
        let bundle = format!("COUNT={count}\n---INPUT---\n{input}\n---META---\n{meta_dump}");
        let expected = include_str!("profileset_generator/testdata/golden_top_gear.txt");
        assert_eq!(bundle, expected, "eager output drifted from golden snapshot");
    }

    #[test]
    fn eager_emit_characterization_single_gear_swap() {
        ensure_game_data_loaded();
        // mage with main_hand so base profile has two non-varying gear lines.
        let base_profile = "mage=test\nspec=frost\nhead=,id=100\nmain_hand=,id=200\n";

        let equipped = make_item("head", 100, true, ",id=100", vec![], 0, 0);
        let alt = make_item("head", 300, false, ",id=300", vec![], 0, 0);

        let mut items_by_slot = HashMap::new();
        items_by_slot.insert("head".to_string(), vec![equipped, alt]);

        let mut selected = HashMap::new();
        selected.insert("head".to_string(), vec![uid(300, &[], "bags", "head")]);

        let (input, count, metadata) = generate_top_gear_input_with_talents(
            base_profile,
            &items_by_slot,
            &selected,
            Some(20),
            &[],
            None,
            &GemEnchantOptions::default(),
        )
        .unwrap();

        assert_eq!(count, 1, "expected exactly one combo");

        // Verify simc lines for Combo 2 (the alt head swap).
        assert!(
            input.contains("profileset.\"Combo 2\"+=head=,id=300"),
            "expected head swap simc line; got:\n{input}"
        );
        // Synthetic empty off_hand must be emitted (non-Fury, no off_hand in gear_set).
        assert!(
            input.contains("profileset.\"Combo 2\"+=off_hand=,"),
            "expected synthetic empty off_hand line; got:\n{input}"
        );

        // Verify metadata shape for Combo 2.
        let combo = metadata.get("Combo 2").expect("Combo 2 metadata must exist");

        // Head item must be present with correct fields.
        let head = combo
            .iter()
            .find(|v| v["slot"] == "head")
            .expect("head entry missing from Combo 2 metadata");
        assert_eq!(head["item_id"], json!(300), "item_id mismatch");
        assert_eq!(head["is_kept"], json!(false), "is_kept must be false for alt");
        assert_eq!(head["origin"], json!("bags"), "origin mismatch");
        assert!(head.get("ilevel").is_some(), "ilevel field required");
        assert!(head.get("name").is_some(), "name field required");
        assert!(head.get("bonus_ids").is_some(), "bonus_ids field required");
        assert!(head.get("enchant_id").is_some(), "enchant_id field required");
        assert!(head.get("gem_id").is_some(), "gem_id field required");

        // Synthetic off_hand entry (item_id=0, is_kept=false, origin="system").
        let off = combo
            .iter()
            .find(|v| v["slot"] == "off_hand")
            .expect("off_hand synthetic entry missing from Combo 2 metadata");
        assert_eq!(off["item_id"], json!(0), "off_hand item_id must be 0");
        assert_eq!(off["is_kept"], json!(false), "off_hand is_kept must be false");
        assert_eq!(off["origin"], json!("system"), "off_hand origin must be system");
    }

    /// Behavior test (Step 1 of the gem-apply fix): pins correct per-item socket behavior
    /// for both the eager and iterator paths.
    ///
    /// Scenario A (positive): equipped `head` with `sockets:1, gem_id:0` (empty socket, NOT
    /// encoded via bonus_id). With gems selected and replace_gems off, a gem combo MUST be
    /// emitted for the equipped head (it has an empty socket). Bug: eager used simc_socket_count
    /// which returned 0 for this item → gem never applied.
    ///
    /// Scenario B (negative, control): a slot whose gem axis exists only because an ALT has a
    /// socket. The equipped item for that slot has `sockets:0`. When the equipped item is used,
    /// it must NOT receive a gem.
    #[test]
    fn gem_apply_uses_per_item_socket_count_from_game_data() {
        ensure_game_data_loaded();

        // ── Scenario A: equipped item with empty socket (sockets:1, no bonus_id encoding) ──
        // The item has sockets:1 in game data but the simc string has no bonus_id that
        // adds a socket, so simc_socket_count returns 0. With the fix, we use the item's
        // "sockets" field from game data, and a gem combo MUST be emitted.
        let base_a = "mage=test\nspec=frost\nhead=,id=100\n";
        let gems_a = [213453_u64];
        // id=100 is in socketed_item_ids → it has a real socket per game data
        let sockets_a = HashSet::from([100_u64]);

        // items_by_slot must be populated with the equipped item carrying sockets:1 so
        // the gem_slots builder finds the socket count from game data, not the simc string.
        let equipped_head_a = serde_json::json!({
            "slot": "head", "simc_string": ",id=100",
            "is_equipped": true, "origin": "equipped", "item_id": 100_u64,
            "ilevel": 0, "name": "Equipped Head", "bonus_ids": [],
            "enchant_id": 0, "gem_id": 0, "sockets": 1,
        });
        let mut items_a: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
        items_a.insert("head".to_string(), vec![equipped_head_a.clone()]);

        // Eager path
        let (input_a, count_a, _) = generate_top_gear_input_with_talents(
            base_a,
            &items_a,
            &HashMap::new(),
            Some(20),
            &[],
            None,
            &GemEnchantOptions {
                gem_options: &gems_a,
                socketed_item_ids: Some(&sockets_a),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            count_a, 1,
            "Scenario A (eager): equipped item with empty socket must emit one gem combo, got {count_a}:\n{input_a}"
        );
        assert!(
            input_a.contains("gem_id=213453"),
            "Scenario A (eager): gem must be applied to equipped head:\n{input_a}"
        );

        // Iterator path
        let gem_opts_a = GemEnchantOptions {
            gem_options: &gems_a,
            socketed_item_ids: Some(&sockets_a),
            ..Default::default()
        };
        let cfg_a = super::build_iterator_config(base_a, &items_a, &HashMap::new(), &[], &gem_opts_a, None);
        let iter_a: Vec<_> = super::ProfilesetIterator::new(cfg_a).collect();
        assert_eq!(
            iter_a.len(), 1,
            "Scenario A (iterator): equipped item with empty socket must emit one gem combo, got {}",
            iter_a.len()
        );
        assert!(
            iter_a[0].profileset_simc.contains("gem_id=213453"),
            "Scenario A (iterator): gem must be applied to equipped head:\n{}",
            iter_a[0].profileset_simc
        );

        // ── Scenario B: 0-socket equipped item whose slot has a gem axis from an alt ──
        // neck slot: equipped=250012 (sockets:0), alt=303 (sockets:1). Gem combo covers
        // the neck slot (because the alt has a socket). When the equipped item is chosen
        // (equipped gear state), the neck must NOT receive a gem.
        let base_b = "mage=test\nspec=frost\nneck=,id=250012\n";
        let gems_b = [213453_u64];
        let sockets_b = HashSet::from([303_u64]); // only the alt is socketable
        let equipped_neck_b = serde_json::json!({
            "slot": "neck", "simc_string": ",id=250012",
            "is_equipped": true, "origin": "equipped", "item_id": 250012_u64,
            "ilevel": 0, "name": "Equipped Neck", "bonus_ids": [],
            "enchant_id": 0, "gem_id": 0, "sockets": 0,
        });
        let alt_neck_b = serde_json::json!({
            "slot": "neck", "simc_string": ",id=303",
            "is_equipped": false, "origin": "bags", "item_id": 303_u64,
            "ilevel": 0, "name": "Alt Neck", "bonus_ids": [],
            "enchant_id": 0, "gem_id": 0, "sockets": 1,
        });
        let mut items_b: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
        items_b.insert("neck".to_string(), vec![equipped_neck_b, alt_neck_b]);
        let mut selected_b: HashMap<String, Vec<String>> = HashMap::new();
        selected_b.insert("neck".to_string(), vec!["303::bags:neck".to_string()]);
        let gem_opts_b = GemEnchantOptions {
            gem_options: &gems_b,
            socketed_item_ids: Some(&sockets_b),
            ..Default::default()
        };

        // Iterator path: the gem-only baseline combo (equipped neck) must NOT have gem_id
        let cfg_b = super::build_iterator_config(base_b, &items_b, &selected_b, &[], &gem_opts_b, None);
        let iter_b: Vec<_> = super::ProfilesetIterator::new(cfg_b).collect();
        // There MUST be at least one combo (the alt neck with gem).
        assert!(
            iter_b.len() >= 1,
            "Scenario B: at least one combo expected (alt+gem), got 0"
        );
        // Any combo using the equipped neck (id=250012) must NOT have gem_id applied.
        for cand in &iter_b {
            if cand.profileset_simc.contains("id=250012") {
                assert!(
                    !cand.profileset_simc.contains("gem_id="),
                    "Scenario B (iterator): 0-socket equipped neck must NOT be gemmed:\n{}",
                    cand.profileset_simc
                );
            }
        }

        // Eager path for Scenario B: same check
        let (input_b, _, _) = generate_top_gear_input_with_talents(
            base_b,
            &items_b,
            &selected_b,
            Some(20),
            &[],
            None,
            &gem_opts_b,
        )
        .unwrap();
        for block in input_b.split("### ").skip(1) {
            if block.contains("neck=,id=250012") && block.contains("gem_id=") {
                panic!(
                    "Scenario B (eager): 0-socket equipped neck must NOT be gemmed:\n{block}"
                );
            }
        }
    }

    #[test]
    fn iterator_emission_set_equals_eager_deduped_set_paired_slots() {
        // The eager generator dedups gear sets (seen_combo_keys); the iterator is
        // dedup-free and relies on cursor uniqueness + baseline/ swapped-slot
        // skips. For paired slots (finger swaps) these MUST still agree, or the
        // refactor would change counts and break resume coverage. Compare the
        // emitted profileset simc bodies as sets (order-independent, name-stripped).
        ensure_game_data_loaded();
        let (base, items, selected, enchants, gems, socketed, talents) = golden_top_gear_inputs();
        let gem_opts = GemEnchantOptions {
            enchant_selections: Some(&enchants),
            gem_options: &gems,
            socketed_item_ids: Some(&socketed),
            ..Default::default()
        };

        let (input, eager_count, _) = generate_top_gear_input_with_talents(
            &base, &items, &selected, None, &talents, None, &gem_opts,
        )
        .unwrap();

        let eager_bodies = strip_named_profileset_bodies(&input);

        let cfg = super::build_iterator_config(&base, &items, &selected, &talents, &gem_opts, None);
        let iter: Vec<_> = super::ProfilesetIterator::new(cfg).collect();
        let iter_bodies: std::collections::BTreeSet<String> = iter
            .iter()
            .map(|c| strip_combo_name(&c.profileset_simc))
            .collect();

        assert_eq!(
            iter.len(),
            eager_count,
            "iterator emitted {} but eager counted {eager_count}",
            iter.len()
        );
        assert_eq!(
            eager_bodies, iter_bodies,
            "eager and iterator emit different profileset sets"
        );
    }

    // Returns the set of profileset bodies from an eager input string, each with
    // its "Combo N" name replaced by a constant so name offsets don't matter.
    fn strip_named_profileset_bodies(input: &str) -> std::collections::BTreeSet<String> {
        input
            .split("### ")
            .filter(|b| b.starts_with("Combo ") && b.contains("profileset."))
            .map(|b| strip_combo_name(b))
            .collect()
    }

    fn strip_combo_name(block: &str) -> String {
        // Replace every "Combo N" with "Combo X" and keep only the "+=" body
        // lines so header lines / name offsets don't affect the comparison.
        let re = regex::Regex::new(r#"Combo \d+"#).unwrap();
        let normalized = re.replace_all(block, "Combo X").to_string();
        normalized
            .lines()
            .filter(|l| l.contains("+="))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn iterator_metadata_matches_eager_per_combo() {
        ensure_game_data_loaded();
        let (base, items, selected, enchants, gems, socketed, talents) = golden_top_gear_inputs();
        let gem_opts = GemEnchantOptions {
            enchant_selections: Some(&enchants),
            gem_options: &gems,
            socketed_item_ids: Some(&socketed),
            ..Default::default()
        };
        let (eager_input, _, eager_meta) = generate_top_gear_input_with_talents(
            &base, &items, &selected, None, &talents, None, &gem_opts,
        )
        .unwrap();

        // Build a map of normalized-simc-body → eager-metadata so we can look up
        // by combo content rather than by Combo-N name (the iterator and eager
        // enumerate in different orders, so the Combo-N numbers don't match).
        // normalized key: "+=" body lines with "Combo N" replaced by "Combo X".
        let eager_body_to_meta: HashMap<String, &Vec<serde_json::Value>> = eager_input
            .split("### ")
            .filter(|b| b.starts_with("Combo ") && b.contains("profileset."))
            .filter_map(|b| {
                let name_end = b.find('\n')?;
                let name = b[..name_end].trim().to_string();
                let meta = eager_meta.get(&name)?;
                Some((strip_combo_name(b), meta))
            })
            .collect();

        let cfg = super::build_iterator_config(&base, &items, &selected, &talents, &gem_opts, None);
        let mut iter = super::ProfilesetIterator::new(cfg);
        iter.set_next_name_idx(2);
        let mut checked = 0;
        for cand in iter {
            let key = strip_combo_name(&cand.profileset_simc);
            let expected = eager_body_to_meta
                .get(&key)
                .unwrap_or_else(|| panic!("eager has no metadata for simc body of {}", cand.profileset_name));
            let actual: Vec<serde_json::Value> =
                serde_json::from_value(cand.metadata.clone()).unwrap();
            assert_eq!(&actual, *expected, "metadata mismatch for {} (simc body lookup)", cand.profileset_name);
            checked += 1;
        }
        assert!(checked > 0, "no candidates checked");
        // Every eager profileset (Combo 2..) must be covered by the iterator.
        let eager_profilesets = eager_meta.keys().filter(|k| k.starts_with("Combo ")).count();
        assert_eq!(checked, eager_profilesets, "iterator did not cover all eager profileset combos");
    }

    #[test]
    fn returned_count_matches_emitted_blocks_and_count_fn() {
        ensure_game_data_loaded();
        let (base, items, selected, enchants, gems, socketed, talents) = golden_top_gear_inputs();
        let gem_opts = GemEnchantOptions {
            enchant_selections: Some(&enchants),
            gem_options: &gems,
            socketed_item_ids: Some(&socketed),
            ..Default::default()
        };
        let (input, count, meta) = generate_top_gear_input_with_talents(
            &base, &items, &selected, None, &talents, None, &gem_opts,
        )
        .unwrap();
        // emitted profileset blocks = "### Combo " count minus the base actor (Combo 1)
        let emitted = input.matches("### Combo ").count().saturating_sub(1);
        assert_eq!(count, emitted, "returned count must match emitted ### Combo blocks");
        // metadata has one entry per profileset plus the baseline "Currently Equipped*" keys
        let profileset_meta = meta.keys().filter(|k| k.starts_with("Combo ")).count();
        assert_eq!(count, profileset_meta, "count must match profileset metadata entries");
        let cnt = count_top_gear_combos_with_talents(
            &base, &items, &selected, None, &talents, None, &gem_opts,
        )
        .unwrap();
        assert_eq!(count, cnt, "generate count must equal count_top_gear_combos_with_talents");
    }

    /// Regression guard: `count_emitted()` must return the SAME count as the full
    /// iterator (`ProfilesetIterator::new(cfg).count()`) across structurally different
    /// configs. The shared `evaluate` logic ensures the emission decision can't drift
    /// between the two paths. This test locks the two paths together permanently.
    #[test]
    fn count_emitted_equals_full_iterator_count() {
        ensure_game_data_loaded();

        // ── Config 1: golden fixture (gear + enchant + gem + talent axes) ────────
        {
            let (base, items, selected, enchants, gems, socketed, talents) =
                golden_top_gear_inputs();
            let gem_opts = GemEnchantOptions {
                enchant_selections: Some(&enchants),
                gem_options: &gems,
                socketed_item_ids: Some(&socketed),
                ..Default::default()
            };
            let cfg =
                super::build_iterator_config(&base, &items, &selected, &talents, &gem_opts, None);
            let full = super::ProfilesetIterator::new(cfg.clone()).count();
            let fast = super::ProfilesetIterator::new(cfg).count_emitted();
            assert_eq!(
                full, fast,
                "golden config: count_emitted={fast} != full iterator count={full}"
            );
            assert!(full > 0, "golden config must emit combos");
        }

        // ── Config 2: gear-only (two slots, no gems/enchants/talents) ────────────
        {
            let base = "mage=test\nspec=frost\nhead=,id=100\nchest=,id=101\n".to_string();
            let head_eq = serde_json::json!({
                "slot": "head", "simc_string": ",id=100", "is_equipped": true,
                "origin": "equipped", "item_id": 100_u64, "ilevel": 0, "name": "head eq",
                "bonus_ids": [], "enchant_id": 0, "gem_id": 0, "sockets": 0,
            });
            let head_alt = serde_json::json!({
                "slot": "head", "simc_string": ",id=200", "is_equipped": false,
                "origin": "bags", "item_id": 200_u64, "ilevel": 0, "name": "head alt",
                "bonus_ids": [], "enchant_id": 0, "gem_id": 0, "sockets": 0,
            });
            let chest_eq = serde_json::json!({
                "slot": "chest", "simc_string": ",id=101", "is_equipped": true,
                "origin": "equipped", "item_id": 101_u64, "ilevel": 0, "name": "chest eq",
                "bonus_ids": [], "enchant_id": 0, "gem_id": 0, "sockets": 0,
            });
            let chest_alt = serde_json::json!({
                "slot": "chest", "simc_string": ",id=201", "is_equipped": false,
                "origin": "bags", "item_id": 201_u64, "ilevel": 0, "name": "chest alt",
                "bonus_ids": [], "enchant_id": 0, "gem_id": 0, "sockets": 0,
            });
            let mut items: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
            items.insert("head".into(), vec![head_eq, head_alt]);
            items.insert("chest".into(), vec![chest_eq, chest_alt]);
            let mut selected: HashMap<String, Vec<String>> = HashMap::new();
            selected.insert("head".into(), vec!["200::bags:head".into()]);
            selected.insert("chest".into(), vec!["201::bags:chest".into()]);
            let gem_opts = GemEnchantOptions::default();
            let cfg =
                super::build_iterator_config(&base, &items, &selected, &[], &gem_opts, None);
            let full = super::ProfilesetIterator::new(cfg.clone()).count();
            let fast = super::ProfilesetIterator::new(cfg).count_emitted();
            assert_eq!(
                full, fast,
                "gear-only config: count_emitted={fast} != full iterator count={full}"
            );
            assert!(full > 0, "gear-only config must emit combos");
        }

        // ── Config 3: gem-only (single socketed equipped item, no gear alts) ────
        {
            let base = "mage=test\nspec=frost\nhead=,id=100,bonus_id=13534\n".to_string();
            let head_eq = serde_json::json!({
                "slot": "head", "simc_string": ",id=100,bonus_id=13534", "is_equipped": true,
                "origin": "equipped", "item_id": 100_u64, "ilevel": 0, "name": "head eq",
                "bonus_ids": [13534_u64], "enchant_id": 0, "gem_id": 0, "sockets": 1,
            });
            let mut items: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
            items.insert("head".into(), vec![head_eq]);
            let gems = [213453_u64, 213454_u64];
            let socketed = std::collections::HashSet::from([100_u64]);
            let gem_opts = GemEnchantOptions {
                gem_options: &gems,
                socketed_item_ids: Some(&socketed),
                ..Default::default()
            };
            let cfg = super::build_iterator_config(
                &base,
                &items,
                &HashMap::new(),
                &[],
                &gem_opts,
                None,
            );
            let full = super::ProfilesetIterator::new(cfg.clone()).count();
            let fast = super::ProfilesetIterator::new(cfg).count_emitted();
            assert_eq!(
                full, fast,
                "gem-only config: count_emitted={fast} != full iterator count={full}"
            );
            assert!(full > 0, "gem-only config must emit combos");
        }
    }

}
