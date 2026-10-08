//! Normalize WoW talent export strings for SimC compatibility.
//!
//! WoW's talent export may omit freeNode talents and subtree selector nodes.
//! SimC requires these to be present. This module decodes the talent string,
//! adds missing free nodes and subtree selectors, and re-encodes.

use regex::Regex;

use crate::item_db;

const BASE64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BITS_PER_CHAR: usize = 6;

fn to_bits(s: &str) -> Vec<bool> {
    let mut bits = Vec::new();
    for ch in s.bytes() {
        let val = BASE64.iter().position(|&b| b == ch);
        if let Some(val) = val {
            for bit in 0..BITS_PER_CHAR {
                bits.push((val >> bit) & 1 == 1);
            }
        }
    }
    bits
}

fn read_bits(bits: &[bool], pos: usize, width: usize) -> (u64, usize) {
    let mut value = 0u64;
    for i in 0..width {
        if pos + i < bits.len() && bits[pos + i] {
            value |= 1 << i;
        }
    }
    (value, pos + width)
}

/// Extract the spec ID encoded in a WoW talent loadout export string.
///
/// Layout (LSB-first, 6 bits/char base64): 8-bit serialization version, then a
/// 16-bit spec id. Returns `None` if the string is too short to hold the header.
pub fn spec_id_from_loadout(code: &str) -> Option<u64> {
    let bits = to_bits(code.trim());
    if bits.len() < 24 {
        return None;
    }
    let (_version, pos) = read_bits(&bits, 0, 8);
    let (spec_id, _) = read_bits(&bits, pos, 16);
    Some(spec_id)
}

struct BitWriter {
    bits: Vec<bool>,
}

impl BitWriter {
    fn new() -> Self {
        Self { bits: Vec::new() }
    }

    fn write(&mut self, value: u64, width: usize) {
        for i in 0..width {
            self.bits.push((value >> i) & 1 == 1);
        }
    }

    fn to_base64(&self) -> String {
        let mut bits = self.bits.clone();
        while !bits.len().is_multiple_of(BITS_PER_CHAR) {
            bits.push(false);
        }
        let mut result = String::new();
        for chunk in bits.chunks(BITS_PER_CHAR) {
            let mut val = 0usize;
            for (bit, &set) in chunk.iter().enumerate() {
                if set {
                    val |= 1 << bit;
                }
            }
            result.push(BASE64[val] as char);
        }
        result
    }
}

#[derive(Clone)]
struct NodeSelection {
    ranks: u64,
    choice_index: i32,
}

/// SimC's token for a talent name: "Rite of Adjuration" -> `rite_of_adjuration`.
fn simc_token(name: &str) -> String {
    let mut out = String::new();
    for ch in name.chars().filter(|c| *c != '\'') {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('_') {
            out.push('_');
        }
    }
    out.trim_matches('_').to_string()
}

/// The talents a WoW talent string selects, as SimC tokens (what `talent.x`
/// expressions name). For a choice node only the picked entry counts. None
/// when the string doesn't decode against a known tree.
pub fn selected_talent_tokens(talent_str: &str) -> Option<std::collections::HashSet<String>> {
    let decoded = decode(talent_str.trim())?;
    let mut tokens = std::collections::HashSet::new();
    for key in ["classNodes", "specNodes", "heroNodes"] {
        for node in decoded
            .tree
            .get(key)
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
        {
            let id = node.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
            let Some(selection) = decoded.selections.get(&id) else {
                continue;
            };
            let entries = node.get("entries").and_then(|v| v.as_array());
            let entry = entries.and_then(|e| e.get(selection.choice_index.max(0) as usize));
            let name = entry
                .and_then(|e| e.get("name"))
                .or_else(|| node.get("name"))
                .and_then(|v| v.as_str());
            if let Some(name) = name {
                tokens.insert(simc_token(name));
            }
        }
    }
    Some(tokens)
}

/// Normalize all `talents=` lines in a simc input string.
pub fn normalize_simc_talents(simc_input: &str) -> String {
    let re = Regex::new(r"(?m)^((?:profileset\.[^\n]*\+?=)?talents=)(.+)$").unwrap();
    re.replace_all(simc_input, |caps: &regex::Captures| {
        let prefix = &caps[1];
        let talent_str = caps[2].trim();
        match normalize_talent_string(talent_str) {
            Some(normalized) => format!("{}{}", prefix, normalized),
            None => caps[0].to_string(),
        }
    })
    .to_string()
}

/// A talent string decoded against its class's trees.
struct Decoded {
    version: u64,
    spec_id: u64,
    hash_lo: u64,
    hash_hi: u64,
    tree: &'static serde_json::Value,
    full_node_order: Vec<u64>,
    node_max_ranks: std::collections::HashMap<u64, u64>,
    node_is_free: std::collections::HashMap<u64, bool>,
    node_is_choice: std::collections::HashMap<u64, bool>,
    selections: std::collections::HashMap<u64, NodeSelection>,
}

fn decode(talent_str: &str) -> Option<Decoded> {
    let bits = to_bits(talent_str);
    if bits.len() < 152 {
        return None; // too short for header
    }

    let (version, mut pos) = read_bits(&bits, 0, 8);
    let (spec_id, new_pos) = read_bits(&bits, pos, 16);
    pos = new_pos;
    let (hash_lo, new_pos) = read_bits(&bits, pos, 64);
    pos = new_pos;
    let (hash_hi, new_pos) = read_bits(&bits, pos, 64);
    pos = new_pos;

    let tree = item_db::talent_tree(spec_id)?;

    // Build full node order and metadata from talent tree + all sibling specs
    let full_node_order: Vec<u64> = tree
        .get("fullNodeOrder")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
        .unwrap_or_default();

    if full_node_order.is_empty() {
        return None;
    }

    // Collect node metadata from all sibling specs
    let siblings = item_db::talent_trees_for_class(spec_id);
    let mut node_max_ranks: std::collections::HashMap<u64, u64> = std::collections::HashMap::new();
    let mut node_is_free: std::collections::HashMap<u64, bool> = std::collections::HashMap::new();
    let mut node_is_choice: std::collections::HashMap<u64, bool> = std::collections::HashMap::new();

    for sibling in &siblings {
        for key in &["classNodes", "specNodes", "heroNodes"] {
            if let Some(nodes) = sibling.get(key).and_then(|v| v.as_array()) {
                for node in nodes {
                    let id = node.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                    if id == 0 {
                        continue;
                    }
                    let mr = node.get("maxRanks").and_then(|v| v.as_u64()).unwrap_or(1);
                    node_max_ranks.insert(id, mr);
                    let free = node
                        .get("freeNode")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    if free {
                        node_is_free.insert(id, true);
                    }
                    let ntype = node.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    let entries_len = node
                        .get("entries")
                        .and_then(|v| v.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0);
                    if (ntype == "choice" || ntype == "subtree") && entries_len > 1 {
                        node_is_choice.insert(id, true);
                    }
                }
            }
        }
        // SubTree selector nodes
        if let Some(nodes) = sibling.get("subTreeNodes").and_then(|v| v.as_array()) {
            for node in nodes {
                let id = node.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                if id == 0 {
                    continue;
                }
                node_max_ranks.entry(id).or_insert(1);
                let entries_len = node
                    .get("entries")
                    .and_then(|v| v.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                if entries_len > 1 {
                    node_is_choice.insert(id, true);
                }
            }
        }
    }

    // Decode selections
    let mut selections: std::collections::HashMap<u64, NodeSelection> =
        std::collections::HashMap::new();
    for &node_id in &full_node_order {
        if pos >= bits.len() {
            break;
        }
        let (is_sel, new_pos) = read_bits(&bits, pos, 1);
        pos = new_pos;
        if is_sel == 0 {
            continue;
        }

        let (is_purch, new_pos) = read_bits(&bits, pos, 1);
        pos = new_pos;
        if is_purch == 0 {
            // Free/granted node
            selections.insert(
                node_id,
                NodeSelection {
                    ranks: *node_max_ranks.get(&node_id).unwrap_or(&1),
                    choice_index: -1,
                },
            );
            continue;
        }

        let mut ranks = *node_max_ranks.get(&node_id).unwrap_or(&1);
        let (is_partial, new_pos) = read_bits(&bits, pos, 1);
        pos = new_pos;
        if is_partial == 1 {
            let (r, new_pos) = read_bits(&bits, pos, 6);
            pos = new_pos;
            ranks = r;
        }

        let mut choice_index: i32 = -1;
        let (is_choice_bit, new_pos) = read_bits(&bits, pos, 1);
        pos = new_pos;
        if is_choice_bit == 1 {
            let (ci, new_pos) = read_bits(&bits, pos, 2);
            pos = new_pos;
            choice_index = ci as i32;
        }

        selections.insert(
            node_id,
            NodeSelection {
                ranks,
                choice_index,
            },
        );
    }

    Some(Decoded {
        version,
        spec_id,
        hash_lo,
        hash_hi,
        tree,
        full_node_order,
        node_max_ranks,
        node_is_free,
        node_is_choice,
        selections,
    })
}

fn normalize_talent_string(talent_str: &str) -> Option<String> {
    let Decoded {
        version,
        spec_id,
        hash_lo,
        hash_hi,
        tree,
        full_node_order,
        node_max_ranks,
        node_is_free,
        node_is_choice,
        mut selections,
    } = decode(talent_str)?;

    // Auto-grant freeNode talents (only from this spec's tree, not siblings)
    let mut changed = false;
    for key in &["classNodes", "specNodes", "heroNodes"] {
        if let Some(nodes) = tree.get(key).and_then(|v| v.as_array()) {
            for node in nodes {
                let id = node.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                let free = node
                    .get("freeNode")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if free && id != 0 && !selections.contains_key(&id) {
                    let mr = node.get("maxRanks").and_then(|v| v.as_u64()).unwrap_or(1);
                    selections.insert(
                        id,
                        NodeSelection {
                            ranks: mr,
                            choice_index: -1,
                        },
                    );
                    changed = true;
                }
            }
        }
    }

    // Fix subtree selectors: add if missing, fix choiceIndex if -1 (this spec only)
    if let Some(st_nodes) = tree.get("subTreeNodes").and_then(|v| v.as_array()) {
        for st_node in st_nodes {
            let id = st_node.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
            if id == 0 {
                continue;
            }
            let sel = selections.get(&id);
            if sel.is_some() && sel.unwrap().choice_index >= 0 {
                continue;
            }
            // Infer from selected hero nodes
            if let Some(entries) = st_node.get("entries").and_then(|v| v.as_array()) {
                for (i, entry) in entries.iter().enumerate() {
                    if let Some(nodes) = entry.get("nodes").and_then(|v| v.as_array()) {
                        let any_selected = nodes.iter().any(|n| {
                            n.as_u64()
                                .map(|nid| selections.contains_key(&nid))
                                .unwrap_or(false)
                        });
                        if any_selected {
                            selections.insert(
                                id,
                                NodeSelection {
                                    ranks: 1,
                                    choice_index: i as i32,
                                },
                            );
                            changed = true;
                            break;
                        }
                    }
                }
            }
        }
    }

    if !changed {
        return None; // no changes needed
    }

    // Re-encode
    let mut writer = BitWriter::new();
    writer.write(version, 8);
    writer.write(spec_id, 16);
    // Preserve the original 128-bit talent-tree hash; simc validates against it
    // and decoding misaligns when it's zeroed.
    writer.write(hash_lo, 64);
    writer.write(hash_hi, 64);

    for &node_id in &full_node_order {
        let sel = match selections.get(&node_id) {
            Some(s) => s,
            None => {
                writer.write(0, 1);
                continue;
            }
        };

        writer.write(1, 1); // isSelected

        if *node_is_free.get(&node_id).unwrap_or(&false) {
            writer.write(0, 1); // isPurchased = false
            continue;
        }

        writer.write(1, 1); // isPurchased

        let max = *node_max_ranks.get(&node_id).unwrap_or(&1);
        let is_partial = sel.ranks < max;
        writer.write(if is_partial { 1 } else { 0 }, 1);
        if is_partial {
            writer.write(sel.ranks, 6);
        }

        let is_choice = *node_is_choice.get(&node_id).unwrap_or(&false);
        writer.write(if is_choice { 1 } else { 0 }, 1);
        if is_choice {
            writer.write(sel.choice_index.max(0) as u64, 2);
        }
    }

    Some(writer.to_base64())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_id_from_loadout_decodes_known_code() {
        // Frost mage (spec id 64) export captured from the live armory endpoint.
        let code = "CAEAMhlVtghLZL4RZzExaQoBYZGGLzMzsgZmYmZGzMzMziZmZmZMzsMTDLDAwMDWmZaDAAWAAAA2AYbZMjZwsxMmZsAAAwMbzMYGGDAA";
        assert_eq!(spec_id_from_loadout(code), Some(64));
    }

    #[test]
    fn talent_names_become_simc_tokens() {
        assert_eq!(simc_token("Rite of Adjuration"), "rite_of_adjuration");
        assert_eq!(simc_token("Light's Guidance"), "lights_guidance");
        assert_eq!(simc_token("Flametongue Weapon"), "flametongue_weapon");
    }

    #[test]
    fn spec_id_from_loadout_rejects_short_input() {
        assert_eq!(spec_id_from_loadout(""), None);
        assert_eq!(spec_id_from_loadout("AB"), None);
    }
}
