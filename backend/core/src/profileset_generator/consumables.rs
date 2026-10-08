//! Consumable alternatives for Top Gear. Each mix of consumables becomes part of
//! the profile-variant axis, so every gear combo is simmed with every mix.

use std::collections::{BTreeMap, HashMap};

use serde_json::Value;

use super::ProfileVariant;

/// The slots a consumable mix can change, in the order mixes are built.
pub const CONSUMABLE_SLOTS: [&str; 5] = ["flask", "food", "potion", "augmentation", "weapon_rune"];

/// The SimC option for one consumable. A weapon rune is a main-hand temporary
/// enchant, as on the base actor.
pub fn simc_option(slot: &str, value: &str) -> String {
    if slot == "weapon_rune" {
        format!("temporary_enchant=main_hand:{value}")
    } else {
        format!("{slot}={value}")
    }
}

fn known_values(slot: &str) -> &'static [Value] {
    match slot {
        "flask" => crate::item_db::list_flasks(),
        "food" => crate::item_db::list_foods(),
        "potion" => crate::item_db::list_potions(),
        "augmentation" => crate::item_db::list_augments(),
        "weapon_rune" => crate::item_db::list_temp_enchants(),
        _ => &[],
    }
}

/// Every mix of the baseline and the alternatives, slot by slot, with the
/// all-baseline mix first. A mix holds only the slots it changes, so the first
/// one is empty. Alternatives equal to the baseline or listed twice are
/// dropped. Values become SimC lines, so anything that is not a known
/// consumable is rejected. Returns no mixes when nothing varies.
pub fn consumable_sets(
    baseline: &HashMap<String, String>,
    options: &HashMap<String, Vec<String>>,
) -> Result<Vec<BTreeMap<String, String>>, String> {
    if let Some(slot) = options
        .keys()
        .find(|k| !CONSUMABLE_SLOTS.contains(&k.as_str()))
    {
        return Err(format!("Unknown consumable slot: {slot}"));
    }
    let mut sets = vec![BTreeMap::new()];
    for slot in CONSUMABLE_SLOTS {
        let Some(values) = options.get(slot) else {
            continue;
        };
        let base = baseline.get(slot).map(String::as_str).unwrap_or("");
        let mut alternatives: Vec<&str> = Vec::new();
        for value in values {
            let known = known_values(slot)
                .iter()
                .any(|e| e.get("value").and_then(Value::as_str) == Some(value));
            if !known {
                return Err(format!("Unknown {slot}: {value}"));
            }
            if value != base && !alternatives.contains(&value.as_str()) {
                alternatives.push(value);
            }
        }
        if alternatives.is_empty() {
            continue;
        }
        sets = sets
            .into_iter()
            .flat_map(|set| {
                let changed: Vec<_> = alternatives
                    .iter()
                    .map(|value| {
                        let mut mix = set.clone();
                        mix.insert(slot.to_string(), value.to_string());
                        mix
                    })
                    .collect();
                std::iter::once(set).chain(changed)
            })
            .collect();
    }
    Ok(if sets.len() > 1 { sets } else { Vec::new() })
}

/// Cross the variant axis with consumable mixes, variant-major, so position 0
/// stays the baseline. No mixes leaves the axis unchanged.
pub fn with_consumable_sets(
    variants: Vec<ProfileVariant>,
    sets: &[BTreeMap<String, String>],
) -> Vec<ProfileVariant> {
    if sets.is_empty() {
        return variants;
    }
    let variants = if variants.is_empty() {
        vec![ProfileVariant::default()]
    } else {
        variants
    };
    variants
        .iter()
        .flat_map(|v| {
            sets.iter().map(move |mix| ProfileVariant {
                consumables: mix.clone(),
                ..v.clone()
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn first_value(slot: &str, n: usize) -> String {
        crate::test_support::ensure_game_data_loaded();
        known_values(slot)[n]
            .get("value")
            .and_then(Value::as_str)
            .unwrap()
            .to_string()
    }

    fn opts(pairs: &[(&str, Vec<String>)]) -> HashMap<String, Vec<String>> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    #[test]
    fn every_mix_is_built_with_the_baseline_first() {
        let (f1, f2) = (first_value("flask", 0), first_value("flask", 1));
        let food = first_value("food", 0);
        let sets = consumable_sets(
            &HashMap::new(),
            &opts(&[
                ("flask", vec![f1.clone(), f2.clone()]),
                ("food", vec![food.clone()]),
            ]),
        )
        .unwrap();
        // (baseline + 2 flasks) x (baseline + 1 food)
        assert_eq!(sets.len(), 6);
        assert!(sets[0].is_empty());
        assert!(sets
            .iter()
            .any(|s| s.get("flask") == Some(&f2) && s.get("food") == Some(&food)));
        let unique: std::collections::HashSet<_> = sets.iter().collect();
        assert_eq!(unique.len(), 6);
    }

    #[test]
    fn the_baseline_and_repeats_are_not_alternatives() {
        let f1 = first_value("flask", 0);
        let baseline: HashMap<String, String> = [("flask".to_string(), f1.clone())].into();
        let sets = consumable_sets(&baseline, &opts(&[("flask", vec![f1.clone(), f1])])).unwrap();
        assert!(sets.is_empty(), "nothing varies: {sets:?}");
    }

    #[test]
    fn unknown_values_and_slots_are_rejected() {
        crate::test_support::ensure_game_data_loaded();
        let bad = opts(&[("flask", vec!["flask_x\nfight_style=dungeon".to_string()])]);
        assert!(consumable_sets(&HashMap::new(), &bad).is_err());
        let slot = opts(&[("iterations", vec![first_value("flask", 0)])]);
        assert!(consumable_sets(&HashMap::new(), &slot).is_err());
    }

    #[test]
    fn mixes_multiply_the_variant_axis_variant_major() {
        let mix: BTreeMap<String, String> = [("flask".to_string(), first_value("flask", 0))].into();
        let sets = vec![BTreeMap::new(), mix.clone()];
        let talents = vec![
            ProfileVariant {
                name: "A".into(),
                talent_string: "a".into(),
                ..Default::default()
            },
            ProfileVariant {
                name: "B".into(),
                talent_string: "b".into(),
                ..Default::default()
            },
        ];
        let crossed = with_consumable_sets(talents, &sets);
        let shape: Vec<_> = crossed
            .iter()
            .map(|v| (v.name.as_str(), v.consumables.len()))
            .collect();
        assert_eq!(shape, [("A", 0), ("A", 1), ("B", 0), ("B", 1)]);

        let alone = with_consumable_sets(Vec::new(), &sets);
        assert_eq!(alone.len(), 2);
        assert!(alone[0].consumables.is_empty() && alone[1].consumables == mix);
        assert_eq!(with_consumable_sets(Vec::new(), &[]).len(), 0);
    }

    #[test]
    fn weapon_runes_are_main_hand_temporary_enchants() {
        assert_eq!(
            simc_option("weapon_rune", "oil"),
            "temporary_enchant=main_hand:oil"
        );
        assert_eq!(simc_option("flask", "f"), "flask=f");
    }
}
