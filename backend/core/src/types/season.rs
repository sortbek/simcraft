//! Typed season configuration — loaded from season-config.json.
//!
//! When a new WoW season drops, update the JSON file. No code changes needed.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonConfig {
    #[serde(default)]
    pub season: String,

    #[serde(default)]
    pub raid_difficulties: Vec<DifficultyDef>,

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
pub struct DungeonCategory {
    pub key: String,
    pub label: String,
    pub pool_instance_id: i64,
    #[serde(default)]
    pub default_difficulty: String,
    #[serde(default)]
    pub difficulties: Vec<DifficultyDef>,
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
}
