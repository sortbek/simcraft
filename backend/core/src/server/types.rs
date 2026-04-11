use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;

use super::helpers::sanitize_custom_simc;

/// Newtype wrapper to avoid colliding with the simc `web::Data<PathBuf>`.
#[derive(Clone)]
pub(super) struct FrontendDir(pub PathBuf);

// ---------- Request / Response types ----------

/// Shared simulation options common to all sim request types.
#[derive(Debug, Deserialize)]
pub struct SimOptions {
    #[serde(default = "default_iterations")]
    pub iterations: u32,
    #[serde(default = "default_fight_style")]
    pub fight_style: String,
    #[serde(default = "default_target_error")]
    pub target_error: f64,
    #[serde(default = "default_desired_targets")]
    pub desired_targets: u32,
    #[serde(default = "default_max_time")]
    pub max_time: u32,
    #[serde(default)]
    pub threads: u32,
    #[serde(default)]
    pub talents: String,
    #[serde(default)]
    pub spec_override: String,
    /// Custom APL and SimC expansion options (e.g., actions=..., midnight.*, use_blizzard_action_list).
    #[serde(default)]
    pub custom_apl: String,
    // Batch grouping
    #[serde(default)]
    pub batch_id: Option<String>,
    /// Raid buff overrides. Keys are buff names (e.g. "bloodlust"), values are 0 or 1.
    /// Empty = all buffs ON (default).
    #[serde(default)]
    pub raid_buffs: HashMap<String, u8>,
    /// Consumable selections. Keys: "food", "flask", "potion", "augmentation", "weapon_rune".
    /// Values: simc consumable string. Empty map = SimC defaults.
    #[serde(default)]
    pub consumables: HashMap<String, String>,
    /// Expansion-specific option overrides. Keys are the full option name
    /// (e.g. "midnight.crucible_of_erratic_energies_violence"), values are 0 or 1.
    /// Empty = all expansion options ON (default).
    #[serde(default)]
    pub expansion_options: HashMap<String, u8>,
    // Expert Mode injection points
    #[serde(default)]
    pub simc_header: String,
    #[serde(default)]
    pub simc_base_player: String,
    #[serde(default)]
    pub simc_raid_actors: String,
    #[serde(default)]
    pub simc_post_combos: String,
    #[serde(default)]
    pub simc_footer: String,
}

impl SimOptions {
    pub(super) fn has_raid_actors(&self) -> bool {
        !sanitize_custom_simc(&self.simc_raid_actors)
            .trim()
            .is_empty()
    }

    pub(super) fn to_json(&self) -> Value {
        let mut v = json!({
            "fight_style": self.fight_style,
            "target_error": self.target_error,
            "iterations": self.iterations,
            "desired_targets": self.desired_targets,
            "max_time": self.max_time,
            "threads": self.threads,
            "single_actor_batch": !self.has_raid_actors(),
        });
        if !self.raid_buffs.is_empty() {
            v["raid_buffs"] = json!(self.raid_buffs);
        }
        if !self.consumables.is_empty() {
            v["consumables"] = json!(self.consumables);
        }
        if !self.expansion_options.is_empty() {
            v["expansion_options"] = json!(self.expansion_options);
        }
        v
    }

    pub(super) fn to_json_with_sim_type(&self, sim_type: &str) -> Value {
        let mut v = self.to_json();
        v["sim_type"] = json!(sim_type);
        v
    }
}

#[derive(Debug, Deserialize)]
pub struct SimRequest {
    pub simc_input: String,
    #[serde(default = "default_sim_type")]
    pub sim_type: String,
    #[serde(default)]
    pub max_upgrade: bool,
    /// When true, send simc_input directly to SimC without any processing.
    #[serde(default)]
    pub raw: bool,
    #[serde(flatten)]
    pub options: SimOptions,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TalentBuild {
    pub name: String,
    pub talent_string: String,
}

#[derive(Debug, Deserialize)]
pub struct TopGearRequest {
    pub simc_input: String,
    pub selected_items: HashMap<String, Vec<String>>,
    pub items_by_slot: Option<HashMap<String, Vec<Value>>>,
    #[serde(default)]
    pub max_upgrade: bool,
    #[serde(default)]
    pub copy_enchants: bool,
    #[serde(default)]
    pub max_combinations: Option<usize>,
    #[serde(default)]
    pub talent_builds: Vec<TalentBuild>,
    #[serde(default)]
    pub catalyst: bool,
    #[serde(default)]
    pub catalyst_charges: Option<u32>,
    /// Enchant selections: slot -> list of enchant IDs to sim
    #[serde(default)]
    pub enchant_selections: HashMap<String, Vec<u64>>,
    /// Gem options: flat list of gem item IDs to sim across all socketed slots
    #[serde(default)]
    pub gem_options: Vec<u64>,
    /// When true, replace ALL existing gems (not just empty sockets)
    #[serde(default)]
    pub replace_gems: bool,
    /// When true, selected diamonds are always placed in a socket (one per combo)
    #[serde(default)]
    pub diamond_always_use: bool,
    /// When true, maximize unique gem colors across sockets
    #[serde(default)]
    pub max_colors: bool,
    #[serde(flatten)]
    pub options: SimOptions,
}

#[derive(Debug, Deserialize)]
pub struct DroptimizerRequest {
    pub simc_input: String,
    pub drop_items: Vec<Value>,
    #[serde(flatten)]
    pub options: SimOptions,
}

#[derive(Debug, Deserialize)]
pub struct UpgradeCompareRequest {
    pub simc_input: String,
    pub selected_slots: Vec<String>,
    #[serde(default)]
    pub max_combinations: Option<usize>,
    #[serde(flatten)]
    pub options: SimOptions,
}

#[derive(Debug, Serialize)]
pub struct SimResponse {
    pub id: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct ItemInfoBatchRequest {
    #[serde(default)]
    pub items: Vec<Value>,
    #[serde(default)]
    pub item_ids: Vec<u64>,
}

#[derive(Debug, Deserialize)]
pub(super) struct BonusIdsQuery {
    #[serde(default)]
    pub bonus_ids: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct ResolveGearRequest {
    pub simc_input: String,
    #[serde(default)]
    pub max_upgrade: bool,
    #[serde(default)]
    pub catalyst: bool,
}

#[derive(Debug, Deserialize)]
pub(super) struct CatalystConvertRequest {
    pub class_name: String,
    pub slot: String,
    pub item: crate::types::ResolvedItem,
}

#[cfg(not(feature = "desktop"))]
#[derive(Debug, Deserialize)]
pub(super) struct ListSimsQuery {
    #[serde(default)]
    pub player: String,
    #[serde(default)]
    pub realm: String,
}

#[derive(Deserialize)]
pub(super) struct LogsQuery {
    #[serde(default)]
    pub after: usize,
}

#[derive(Debug, Deserialize)]
pub(super) struct DropsQuery {
    #[serde(default)]
    pub class_name: String,
    #[serde(default)]
    pub spec: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct EnchantListQuery {
    pub expansion: u64,
    pub slot: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct GemListQuery {
    pub expansion: u64,
}

#[derive(Debug, Deserialize)]
pub struct EnchantGemSimRequest {
    pub simc_input: String,
    /// Map of slot -> list of enchant IDs to sim
    pub enchant_selections: HashMap<String, Vec<u64>>,
    /// Gem options: flat list of gem item IDs to sim across all socketed slots
    #[serde(default)]
    pub gem_options: Vec<u64>,
    #[serde(default)]
    pub max_combinations: Option<usize>,
    #[serde(flatten)]
    pub options: SimOptions,
}

fn default_iterations() -> u32 {
    1000
}
fn default_fight_style() -> String {
    "Patchwerk".to_string()
}
fn default_target_error() -> f64 {
    0.05
}
fn default_sim_type() -> String {
    "quick".to_string()
}
fn default_desired_targets() -> u32 {
    1
}
fn default_max_time() -> u32 {
    300
}
