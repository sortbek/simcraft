//! Typed season configuration, loaded from season-config.json.
//! A new season is just a JSON edit — no code changes needed.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonConfig {
    #[serde(default)]
    pub season: String,

    #[serde(default)]
    pub raid_difficulties: Vec<DifficultyDef>,

    /// Meta-instance holding this season's raid bosses. Unlike a dungeon pool,
    /// its `encounters` are boss encounter IDs, not instance IDs.
    #[serde(default)]
    pub raid_pool_instance_id: Option<i64>,

    #[serde(default)]
    pub dungeon_categories: Vec<DungeonCategory>,

    #[serde(default)]
    pub encounter_overrides: Vec<EncounterOverride>,

    #[serde(default)]
    pub instance_overrides: Vec<InstanceOverride>,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncounterOverride {
    pub encounter_id: i64,
    pub upgrade_level: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceOverride {
    pub instance_id: i64,
    #[serde(default)]
    pub difficulty_key: String,
    #[serde(default)]
    pub track: String,
    #[serde(default)]
    pub level: u64,
}

/// API response for GET /api/season-config.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeasonConfigResponse {
    pub season: String,
    pub raid_difficulties: Vec<DifficultyDef>,
    pub dungeon_categories: Vec<DungeonCategory>,
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
