use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct ForeverItem {
    pub id: u32,
    pub name: String,
    #[serde(default)]
    pub icon: String,
    #[serde(rename = "type")]
    pub item_type: u8,
    pub quality: u8,
    pub ilvl: u32,
    /// Can carry a random suffix ("of the …"), which the export never includes.
    #[serde(default)]
    pub suffix: bool,
    /// 0 when there is none or the bundle predates it.
    #[serde(default)]
    pub req_level: u32,
    /// cloth, leather, mail or plate; empty for jewelry, weapons and older bundles.
    #[serde(default)]
    pub armor: String,
    /// Melee or ranged kind: sword, staff, shield, off_hand (held in the off hand), bow, wand, ...
    #[serde(default)]
    pub weapon: String,
    /// one_hand, main_hand, off_hand or two_hand.
    #[serde(default)]
    pub hand: String,
    /// The classes the item is limited to; empty for any.
    #[serde(default)]
    pub classes: Vec<String>,
}

/// Where items come from (AllTheThings' Forever database): an instance, quest zone, vendor,
/// faction, profession, PvP vendor or world drop list.
#[derive(Debug, Clone, Deserialize)]
pub struct SourceGroup {
    /// dungeon, raid, crafted, reputation, pvp, vendor, quest or world.
    pub category: String,
    pub name: String,
    #[serde(default)]
    pub zone: String,
    /// An instance's entry level.
    #[serde(default)]
    pub level: u32,
    /// Added in Forever.
    #[serde(default)]
    pub new: bool,
    pub items: Vec<SourceItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SourceItem {
    pub id: u32,
    /// Boss, vendor, quest or mob.
    #[serde(default)]
    pub from: String,
    /// horde or alliance when only one side can get it.
    #[serde(default)]
    pub side: String,
    /// The reputation standing it needs.
    #[serde(default)]
    pub standing: String,
    /// A class quest's classes.
    #[serde(default)]
    pub classes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NodeEntry {
    pub definition_id: u32,
    pub max_ranks: u8,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TalentNode {
    pub id: u32,
    pub entries: Vec<NodeEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClassTalents {
    pub tree_id: u32,
    pub spec_ids: Vec<u32>,
    pub nodes: Vec<TalentNode>,
    pub talents: HashMap<String, [usize; 2]>,
    pub tree_sizes: Vec<usize>,
    /// Absent in bundles built before the calculator layout was added.
    #[serde(default)]
    pub trees: Vec<TreeLayout>,
}

/// A calculator tree; its talents are in the engine's talent-string order.
#[derive(Debug, Clone, Deserialize)]
pub struct TreeLayout {
    pub name: String,
    pub talents: Vec<TalentLayout>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TalentLayout {
    pub name: String,
    pub spell_id: u32,
    pub icon: String,
    pub row: u8,
    pub col: u8,
    pub max_ranks: u8,
    /// [row, col] of the talent this one needs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prereq: Option<[u8; 2]>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DataVersion {
    pub engine_commit: String,
    pub client_build: String,
}

pub struct ForeverData {
    pub version: DataVersion,
    pub items: HashMap<u32, ForeverItem>,
    pub enchants: HashMap<u32, String>,
    pub spells: HashMap<u32, String>,
    /// Icon name or FileDataID per spell; empty with a bundle built before spell icons.
    pub spell_icons: HashMap<u32, String>,
    pub talents: HashMap<String, ClassTalents>,
    /// Empty with a bundle built before item sources; the Drop Finder is off then.
    pub sources: Vec<SourceGroup>,
}

#[derive(Deserialize)]
struct Named {
    id: u32,
    name: String,
    #[serde(default)]
    icon: String,
}

fn read<T: serde::de::DeserializeOwned>(dir: &Path, name: &str) -> Result<T, String> {
    let path = dir.join(name);
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&raw).map_err(|e| format!("{}: {e}", path.display()))
}

impl ForeverData {
    pub fn load(dir: &Path) -> Result<Self, String> {
        let items: Vec<ForeverItem> = read(dir, "items.json")?;
        let enchants: Vec<Named> = read(dir, "enchants.json")?;
        let spells: Vec<Named> = read(dir, "spells.json")?;
        Ok(Self {
            version: read(dir, "version.json")?,
            items: items.into_iter().map(|i| (i.id, i)).collect(),
            enchants: enchants.into_iter().map(|e| (e.id, e.name)).collect(),
            spell_icons: spells
                .iter()
                .filter(|s| !s.icon.is_empty())
                .map(|s| (s.id, s.icon.clone()))
                .collect(),
            spells: spells.into_iter().map(|s| (s.id, s.name)).collect(),
            talents: read(dir, "talents.json")?,
            sources: if dir.join("sources.json").is_file() {
                read(dir, "sources.json")?
            } else {
                Vec::new()
            },
        })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_bundle_loads() {
        let data = crate::forever::test_data();
        assert_eq!(data.talents["paladin"].tree_id, 1100);
        assert!(data.talents["paladin"].spec_ids.contains(&1486));
        assert_eq!(data.items[&273637].name, "Blade of Silverlaine");
        assert_eq!(data.items[&273637].ilvl, 26);
        assert!(data.items[&862].suffix);
    }

    #[test]
    fn class_talents_from_an_older_bundle_have_no_trees() {
        let json = r#"{"tree_id":1,"spec_ids":[2],"nodes":[],"talents":{},"tree_sizes":[]}"#;
        let class: super::ClassTalents = serde_json::from_str(json).unwrap();
        assert!(class.trees.is_empty());
    }
}
