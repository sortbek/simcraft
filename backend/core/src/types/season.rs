//! Typed season configuration, loaded from season-config.json.
//! A new season is just a JSON edit — no code changes needed.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DifficultyDef {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub track: Option<String>,
    #[serde(default)]
    pub level: u64,
    #[serde(default)]
    pub sort_order: u32,
    /// For fixed-ilvl difficulties (e.g., normal dungeon drops).
    #[serde(default)]
    pub fixed_ilvl: Option<u64>,
    #[serde(default)]
    pub fixed_quality: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DifficultyGroup {
    pub label: String,
    #[serde(default)]
    pub difficulties: Vec<DifficultyDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DungeonCategory {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub sort_order: u32,
    pub pool_instance_id: i64,
    #[serde(default)]
    pub default_difficulty: String,
    #[serde(default)]
    pub difficulties: Vec<DifficultyDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub difficulty_groups: Option<Vec<DifficultyGroup>>,
}

/// A raid bonus-roll tier. The reward is paid at the Great Vault item level for
/// the difficulty rolled on, so the rank is flat: it replaces the encounter's own
/// upgrade level rather than stacking with it. `base_difficulty` names the raid
/// difficulty whose per-encounter overrides still win (the Very Rare drops).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaidVaultDifficulty {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub track: Option<String>,
    #[serde(default)]
    pub level: u64,
    #[serde(default)]
    pub sort_order: u32,
    pub base_difficulty: String,
}

/// Bonus Rolls wiring: which dungeon category supplies the Mythic+ ladder, and
/// which of its difficulty keys are bonus-roll tiers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BonusRollConfig {
    #[serde(default)]
    pub dungeon_category: String,
    #[serde(default)]
    pub dungeon_difficulties: Vec<String>,
}

/// API response for GET /api/season-config.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeasonConfigResponse {
    pub season: String,
    pub raid_difficulties: Vec<DifficultyDef>,
    pub dungeon_categories: Vec<DungeonCategory>,
    /// Bonus-roll tiers for raid loot. Empty when the season has no bonus rolls.
    #[serde(default)]
    pub raid_vault_difficulties: Vec<RaidVaultDifficulty>,
    /// Bonus Rolls category wiring; absent when the season has no bonus rolls.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bonus_roll: Option<BonusRollConfig>,
    /// Raid instances belonging to the current season, resolved from the season's
    /// raid pool. Clients list only these in the raid picker.
    #[serde(default)]
    pub raid_instance_ids: Vec<i64>,
    /// Stat ids with a crafted missive bonus this season (craftedSecondaryStats
    /// keys) — the client derives the preferred-stats options from these.
    #[serde(default)]
    pub crafted_secondary_stats: Vec<u64>,
    /// Encounter IDs whose loot uses fixed per-difficulty item levels with no
    /// upgrade track (e.g. Sporefall). Clients hide the upgrade-track control
    /// when the selected raid's encounters are all in this set.
    #[serde(default)]
    pub fixed_difficulty_encounters: Vec<i64>,
    /// This season's embellishment options for crafted gear, derived from
    /// crafting data (name-sorted). Includes per-entry applicable item ids so
    /// clients can scope tooltips without re-deriving the recipe join.
    #[serde(default)]
    pub crafted_embellishments: Vec<crate::item_db::EmbellishmentInfo>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The client reads these exact names; serde renames are the only contract.
    #[test]
    fn bonus_roll_types_serialize_with_the_keys_the_client_reads() {
        let tier = RaidVaultDifficulty {
            key: "vault-heroic".to_string(),
            label: "Heroic".to_string(),
            track: Some("Myth".to_string()),
            level: 1,
            sort_order: 3,
            base_difficulty: "heroic".to_string(),
        };
        let json = serde_json::to_value(&tier).unwrap();
        for key in [
            "key",
            "label",
            "track",
            "level",
            "sortOrder",
            "baseDifficulty",
        ] {
            assert!(json.get(key).is_some(), "RaidVaultDifficulty missing {key}");
        }

        let config = BonusRollConfig {
            dungeon_category: "mplus".to_string(),
            dungeon_difficulties: vec!["vault+10-13".to_string()],
        };
        let json = serde_json::to_value(&config).unwrap();
        for key in ["dungeonCategory", "dungeonDifficulties"] {
            assert!(json.get(key).is_some(), "BonusRollConfig missing {key}");
        }

        let response = SeasonConfigResponse {
            season: String::new(),
            raid_difficulties: vec![],
            dungeon_categories: vec![],
            raid_vault_difficulties: vec![tier],
            bonus_roll: Some(config),
            raid_instance_ids: vec![],
            crafted_secondary_stats: vec![],
            fixed_difficulty_encounters: vec![],
            crafted_embellishments: vec![],
        };
        let json = serde_json::to_value(&response).unwrap();
        assert!(json.get("raid_vault_difficulties").is_some());
        assert!(json.get("bonus_roll").is_some());
    }

    /// A tier key that names nothing leaves the dropdown silently short an option.
    #[test]
    fn every_nominated_bonus_roll_tier_exists_in_its_category() {
        let cfg: serde_json::Value =
            serde_json::from_str(include_str!("../../season-config.json")).unwrap();

        let tiers: Vec<RaidVaultDifficulty> =
            serde_json::from_value(cfg["raidVaultDifficulties"].clone()).unwrap();
        assert!(!tiers.is_empty(), "season declares no raid vault tiers");
        let raid_keys: Vec<&str> = cfg["raidDifficulties"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|d| d["key"].as_str())
            .collect();
        for tier in &tiers {
            assert!(
                raid_keys.contains(&tier.base_difficulty.as_str()),
                "{} names a raid difficulty that does not exist",
                tier.key
            );
        }

        let bonus: BonusRollConfig = serde_json::from_value(cfg["bonusRoll"].clone()).unwrap();
        let categories: Vec<DungeonCategory> =
            serde_json::from_value(cfg["dungeonCategories"].clone()).unwrap();
        let category = categories
            .iter()
            .find(|c| c.key == bonus.dungeon_category)
            .expect("bonus roll names a dungeon category that exists");
        for key in &bonus.dungeon_difficulties {
            assert!(
                category.difficulties.iter().any(|d| &d.key == key),
                "{key} is not a difficulty of {}",
                category.key
            );
            assert!(
                cfg["dungeonDifficultyTracks"].get(key).is_some(),
                "{key} has no entry in dungeonDifficultyTracks, so it resolves to nothing"
            );
        }
    }
}
