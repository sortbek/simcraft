use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;

use super::simc_input::sanitize_custom_simc;
use crate::types::RotationMode;

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
    /// Omnium Folio override: `<entryId>:<rank>` pairs, slash-separated. Empty
    /// leaves the profile's exported `omnium_talents=` line alone.
    #[serde(default)]
    pub omnium_talents: String,
    #[serde(default)]
    pub spec_override: String,
    /// Custom APL and SimC expansion options (e.g., actions=..., midnight.*, use_blizzard_action_list).
    #[serde(default)]
    pub custom_apl: String,
    /// Which rotation source to use: SimC's default APL, Blizzard's Assisted Combat APL, or One Button mode.
    #[serde(default)]
    pub rotation_mode: RotationMode,
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
    /// SimC branch to use for this sim ("weekly", "nightly", or "" for default).
    #[serde(default)]
    pub simc_branch: String,
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
    /// When set, forces profileset parallelism on (Some(true)) or off (Some(false)).
    /// When None, falls back to the combo-count threshold in build_full_simc_input.
    #[serde(default)]
    pub parallel_profilesets: Option<bool>,
    /// Optional streamed Top Gear Triage batch cap. Larger batches trade pause
    /// responsiveness for fewer SimC invocations and less per-batch retention overhead.
    #[serde(default)]
    pub triage_max_batch_profilesets: Option<usize>,
    /// Provider routing hint from the frontend: None / Some("auto") = let the
    /// backend pick; Some("local") / Some("simmit") = explicit selection.
    #[serde(default)]
    pub compute_provider: Option<String>,
    /// The SimC text came from a shared result: the finished input is checked
    /// again before SimC runs it. Forced on for re-runs; the editor sets it for a
    /// loaded share. Only ever adds a check, so a body can't use it to skip one.
    #[serde(default)]
    pub untrusted: bool,
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
        if !self.simc_branch.is_empty() {
            v["simc_branch"] = json!(self.simc_branch);
        }
        if self.rotation_mode != RotationMode::Default {
            v["rotation_mode"] = json!(self.rotation_mode);
        }
        if let Some(b) = self.parallel_profilesets {
            v["parallel_profilesets"] = json!(b);
        }
        if let Some(n) = self.triage_max_batch_profilesets {
            v["triage_max_batch_profilesets"] = json!(n);
        }
        if self.untrusted {
            v["untrusted"] = json!(true);
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

#[derive(Debug, Clone, Deserialize)]
pub struct OmniumBuild {
    pub name: String,
    /// `<entryId>:<rank>` pairs for `omnium_talents=`.
    pub omnium_string: String,
}

#[derive(Debug, Deserialize)]
pub struct TopGearRequest {
    pub simc_input: String,
    pub selected_items: HashMap<String, Vec<String>>,
    pub items_by_slot: Option<HashMap<String, Vec<Value>>>,
    /// Slot → uid of the alternative that replaces the unticked equipped item
    /// as the baseline everything is compared against.
    #[serde(default)]
    pub equipped_replacements: HashMap<String, String>,
    #[serde(default)]
    pub max_upgrade: bool,
    #[serde(default)]
    pub copy_enchants: bool,
    #[serde(default)]
    pub max_combinations: Option<usize>,
    #[serde(default)]
    pub talent_builds: Vec<TalentBuild>,
    /// Folio combinations to multiply the gear combos by. One entry (or none)
    /// means the folio doesn't vary — the primary folio rides `omnium_talents`
    /// on `SimOptions` instead.
    #[serde(default)]
    pub omnium_builds: Vec<OmniumBuild>,
    /// Consumable slot -> alternatives to the `consumables` baseline. Every mix
    /// of them is crossed with the gear combos.
    #[serde(default)]
    pub consumable_options: HashMap<String, Vec<String>>,
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
    /// When true, generate Void Forge candidates for eligible slots
    #[serde(default)]
    pub void_forge: bool,
    #[serde(flatten)]
    pub options: SimOptions,
}

#[derive(Debug, Deserialize)]
pub struct DroptimizerRequest {
    pub simc_input: String,
    pub drop_items: Vec<Value>,
    /// Raise equipped gear to this rank on its own track before comparing, so
    /// the baseline sits level with the rank the candidates are being tested at.
    /// Absent leaves equipped gear exactly as exported. Never downgrades.
    #[serde(default)]
    pub upgrade_equipped_to: Option<u64>,
    /// Gem used for sockets the equipped item in that slot does not already
    /// cover. Absent falls back to the player's most-used equipped gem.
    #[serde(default)]
    pub preferred_gem_id: Option<u64>,
    /// Sim every eligible candidate as if it carried a vault reward's extra socket.
    #[serde(default)]
    pub add_vault_socket: bool,
    /// Sim every combo in one pass at the requested target_error. Off means the
    /// staged run, whose pruned rows keep the coarse number of the stage they
    /// died in — every Drop Finder row is an answer, so this defaults on.
    #[serde(default = "default_true")]
    pub force_single_pass: bool,
    /// Chosen secondary-stat IDs (e.g. `[49, 36]` = Mastery/Haste) applied to
    /// every crafted candidate; order irrelevant. Only sent for crafted runs.
    #[serde(default)]
    pub preferred_crafted_stats: Option<[u64; 2]>,
    #[serde(flatten)]
    pub options: SimOptions,
}

#[derive(Debug, Deserialize)]
pub struct ResolveDropsRequest {
    pub simc_input: String,
    pub drop_items: Vec<Value>,
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
pub(super) struct IdsBatchRequest {
    pub ids: Vec<u64>,
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
    #[serde(default)]
    pub void_forge: bool,
}

#[derive(Debug, Deserialize)]
pub(super) struct CatalystConvertRequest {
    pub class_name: String,
    pub slot: String,
    pub item: crate::types::ResolvedItem,
}

#[derive(Debug, Deserialize)]
pub(super) struct VoidForgeConvertRequest {
    pub item: crate::types::ResolvedItem,
}

#[derive(Debug, Deserialize)]
pub(super) struct ModifyItemRequest {
    pub item: crate::types::ResolvedItem,
    #[serde(default)]
    pub gem_ids: Vec<u64>,
    #[serde(default)]
    pub enchant_id: u64,
}

#[derive(Deserialize)]
pub(super) struct DeleteJobQuery {
    /// Delete even when the public share link could not be revoked.
    #[serde(default)]
    pub force: bool,
}

#[derive(Deserialize)]
pub(super) struct LogsQuery {
    #[serde(default)]
    pub after: usize,
}

#[derive(Deserialize)]
pub(super) struct CombosQuery {
    /// Comma-separated profileset names, e.g. `Combo 5,Combo 6`.
    #[serde(default)]
    pub names: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct DropsQuery {
    #[serde(default)]
    pub class_name: String,
    #[serde(default)]
    pub spec: String,
    #[serde(default)]
    pub void_forge: bool,
    #[serde(default)]
    pub catalyst: bool,
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
pub(super) struct ItemSearchQuery {
    #[serde(default)]
    pub q: String,
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub class_name: Option<String>,
    #[serde(default)]
    pub spec: Option<String>,
    /// When true/absent, search the current-season drop catalog; when false,
    /// search all equippable items across every expansion.
    #[serde(default)]
    pub seasonal: Option<bool>,
    /// When true/absent, the seasonal search honours each item's loot-spec
    /// allowlist and primary stat; when false it returns everything the class can
    /// equip. Ignored by the all-expansions search, which does no spec filtering.
    #[serde(default)]
    pub loot_spec: Option<bool>,
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
fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn droptimizer_runs_sim_every_combo_at_the_users_precision_by_default() {
        let req: DroptimizerRequest = serde_json::from_value(json!({
            "simc_input": "deathknight=\"Test\"",
            "drop_items": [],
        }))
        .unwrap();
        assert!(req.force_single_pass);
    }

    #[test]
    fn droptimizer_honors_an_explicit_opt_out_of_single_pass() {
        let req: DroptimizerRequest = serde_json::from_value(json!({
            "simc_input": "deathknight=\"Test\"",
            "drop_items": [],
            "force_single_pass": false,
        }))
        .unwrap();
        assert!(!req.force_single_pass);
    }
}
