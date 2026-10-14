use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;

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
    pub talents: HashMap<String, ClassTalents>,
}

#[derive(Deserialize)]
struct Named {
    id: u32,
    name: String,
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
            spells: spells.into_iter().map(|s| (s.id, s.name)).collect(),
            talents: read(dir, "talents.json")?,
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
}
