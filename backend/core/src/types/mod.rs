pub mod class_data;
pub mod season;

use serde::{Deserialize, Serialize};

// ---- Item Origin ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemOrigin {
    Equipped,
    Bags,
    Vault,
}

impl ItemOrigin {
    pub fn as_str(&self) -> &'static str {
        match self {
            ItemOrigin::Equipped => "equipped",
            ItemOrigin::Bags => "bags",
            ItemOrigin::Vault => "vault",
        }
    }
}

// ---- Raw Parsed Item (output of addon_parser, input to gear_resolver) ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawParsedItem {
    pub raw_slot: String,
    pub simc_string: String,
    pub item_id: u64,
    pub ilevel: u64,
    pub name: String,
    pub bonus_ids: Vec<u64>,
    pub enchant_id: u64,
    pub gem_id: u64,
    pub origin: ItemOrigin,
}

// ---- Character Info ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterInfo {
    pub class_name: Option<String>,
    pub spec: Option<String>,
}

impl CharacterInfo {
    pub fn can_dual_wield(&self) -> bool {
        self.spec.as_deref().is_some_and(class_data::can_dual_wield)
    }

    pub fn max_armor(&self) -> Option<u64> {
        self.class_name
            .as_deref()
            .and_then(class_data::class_max_armor)
    }
}

// ---- Talent Loadout ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TalentLoadout {
    pub name: String,
    pub talent_string: String,
    pub is_active: bool,
}

// ---- Parse Result (output of addon_parser) ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseResult {
    pub items: Vec<RawParsedItem>,
    pub character: CharacterInfo,
    pub base_profile: String,
    pub talent_loadouts: Vec<TalentLoadout>,
}

// ---- Enriched Item Info (display metadata from item DB) ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemDisplayInfo {
    pub name: String,
    pub icon: String,
    pub quality: u64,
    pub quality_name: String,
    pub quality_color: String,
    pub tag: String,
    pub upgrade: String,
    pub sockets: u64,
    pub armor_subclass: u64,
    pub inventory_type: u64,
}

// ---- Resolved Item (output of gear_resolver) ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedItem {
    /// Stable identity: "item_id:sorted_bonus_ids:origin:raw_slot"
    pub uid: String,
    pub slot: String,
    pub item_id: u64,
    pub ilevel: u64,
    pub simc_string: String,
    pub origin: ItemOrigin,
    pub bonus_ids: Vec<u64>,
    pub enchant_id: u64,
    pub gem_id: u64,
    /// Display info from item DB.
    pub name: String,
    pub icon: String,
    pub quality: u64,
    pub quality_color: String,
    pub tag: String,
    pub upgrade: String,
    pub sockets: u64,
    /// Enchant display name (empty if none).
    pub enchant_name: String,
    /// Gem display name (empty if none).
    pub gem_name: String,
    /// Gem icon (empty if none).
    pub gem_icon: String,
}

// ---- Slot Resolution ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotResolution {
    pub equipped: Option<ResolvedItem>,
    pub alternatives: Vec<ResolvedItem>,
}

// ---- Full Gear Resolve Result ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveGearResponse {
    pub character: CharacterResolveInfo,
    pub base_profile: String,
    pub slots: std::collections::HashMap<String, SlotResolution>,
    pub excluded: Vec<ExcludedItem>,
    pub talent_loadouts: Vec<TalentLoadout>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterResolveInfo {
    pub class_name: Option<String>,
    pub spec: Option<String>,
    pub can_dual_wield: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExcludedItem {
    pub uid: String,
    pub item_id: u64,
    pub name: String,
    pub reason: String,
}
