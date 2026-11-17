//! Client loadout strings (Traits.GenerateImportString, version 2) to the engine's
//! one-digit-per-talent string.

use serde::Serialize;

use super::data::{ClassTalents, TalentLayout};

const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

#[derive(Debug)]
pub struct DecodedTalents {
    pub talents_string: String,
    pub points_per_tree: Vec<u32>,
    /// Rank per talent, per tree, in the engine's talent-string order.
    pub ranks: Vec<Vec<u32>>,
    pub unknown_definitions: Vec<u32>,
}

#[derive(Debug, Serialize)]
pub struct TalentView {
    #[serde(flatten)]
    pub layout: TalentLayout,
    pub rank: u32,
}

#[derive(Debug, Serialize)]
pub struct TalentTreeView {
    pub name: String,
    pub points: u32,
    pub talents: Vec<TalentView>,
}

/// The calculator trees with the decoded ranks on them; empty `ranks` (no talents) leaves all at 0.
pub fn tree_views(class: &ClassTalents, ranks: &[Vec<u32>]) -> Vec<TalentTreeView> {
    class
        .trees
        .iter()
        .enumerate()
        .map(|(t, tree)| {
            let talents: Vec<TalentView> = tree
                .talents
                .iter()
                .enumerate()
                .map(|(i, layout)| TalentView {
                    layout: layout.clone(),
                    rank: ranks.get(t).and_then(|r| r.get(i)).copied().unwrap_or(0),
                })
                .collect();
            TalentTreeView {
                name: tree.name.clone(),
                points: talents.iter().map(|t| t.rank).sum(),
                talents,
            }
        })
        .collect()
}

struct Bits {
    bits: Vec<u8>,
    pos: usize,
}

impl Bits {
    fn new(s: &str) -> Result<Self, String> {
        let mut bits = Vec::with_capacity(s.len() * 6);
        for c in s.bytes() {
            let v = ALPHABET
                .iter()
                .position(|&a| a == c)
                .ok_or_else(|| format!("invalid character '{}'", c as char))?;
            bits.extend((0..6).map(|i| ((v >> i) & 1) as u8));
        }
        Ok(Self { bits, pos: 0 })
    }

    fn read(&mut self, n: usize) -> Result<u32, String> {
        if self.pos + n > self.bits.len() {
            return Err("string is too short".into());
        }
        let v = (0..n).fold(0u32, |acc, i| {
            acc | (u32::from(self.bits[self.pos + i]) << i)
        });
        self.pos += n;
        Ok(v)
    }
}

/// A talent string someone edited (a digit per talent, trees split by `-`), checked against the
/// trees: no more trees or talents than the class has and no rank above a talent's maximum.
pub fn from_string(edited: &str, class: &ClassTalents) -> Result<DecodedTalents, String> {
    let parts: Vec<&str> = edited.trim().split('-').collect();
    if parts.len() > class.trees.len() {
        return Err("more trees than the class has".into());
    }
    let mut ranks: Vec<Vec<u32>> = class
        .trees
        .iter()
        .map(|tree| vec![0; tree.talents.len()])
        .collect();
    for (t, part) in parts.iter().enumerate() {
        if part.len() > ranks[t].len() {
            return Err(format!("{} has fewer talents", class.trees[t].name));
        }
        for (i, c) in part.chars().enumerate() {
            let rank = c.to_digit(10).ok_or("only digits and dashes")?;
            let talent = &class.trees[t].talents[i];
            if rank > talent.max_ranks as u32 {
                return Err(format!("{} has {} ranks", talent.name, talent.max_ranks));
            }
            ranks[t][i] = rank;
        }
    }
    let trimmed: Vec<String> = ranks
        .iter()
        .map(|tree| {
            let digits: String = tree.iter().map(u32::to_string).collect();
            digits.trim_end_matches('0').to_string()
        })
        .collect();
    Ok(DecodedTalents {
        talents_string: trimmed.join("-").trim_end_matches('-').to_string(),
        points_per_tree: ranks.iter().map(|tree| tree.iter().sum()).collect(),
        ranks,
        unknown_definitions: Vec::new(),
    })
}

pub fn decode(loadout: &str, class: &ClassTalents) -> Result<DecodedTalents, String> {
    let mut bits = Bits::new(loadout.trim())?;
    let version = bits.read(8)?;
    if version != 2 {
        return Err(format!("unsupported talent string version {version}"));
    }
    let spec_id = bits.read(16)?;
    if !class.spec_ids.contains(&spec_id) {
        return Err("talents are from another class".into());
    }
    for _ in 0..16 {
        bits.read(8)?; // tree hash
    }
    let mut points: Vec<Vec<u32>> = class.tree_sizes.iter().map(|&n| vec![0; n]).collect();
    let mut unknown = Vec::new();
    for node in &class.nodes {
        if bits.read(1)? == 0 {
            continue;
        }
        let purchased = bits.read(1)? == 1;
        let (mut rank, mut choice) = (None, 0usize);
        if purchased {
            if bits.read(1)? == 1 {
                rank = Some(bits.read(6)?);
            }
            if bits.read(1)? == 1 {
                choice = bits.read(2)? as usize;
            }
        }
        if !purchased {
            continue; // granted for free, not a talent point
        }
        let entry = node
            .entries
            .get(choice)
            .ok_or_else(|| format!("node {} has no choice {choice}", node.id))?;
        let rank = rank.unwrap_or(u32::from(entry.max_ranks));
        match class.talents.get(&entry.definition_id.to_string()) {
            Some(&[tree, idx]) if tree < points.len() && idx < points[tree].len() => {
                points[tree][idx] = rank;
            }
            _ => unknown.push(entry.definition_id),
        }
    }
    let talents_string = points
        .iter()
        .map(|tree| {
            tree.iter()
                .map(|p| char::from_digit(*p, 10).unwrap_or('9'))
                .collect::<String>()
                .trim_end_matches('0')
                .to_string()
        })
        .collect::<Vec<_>>()
        .join("-")
        .trim_end_matches('-')
        .to_string();
    Ok(DecodedTalents {
        talents_string,
        points_per_tree: points.iter().map(|t| t.iter().sum()).collect(),
        ranks: points,
        unknown_definitions: unknown,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SYLFREY: &str = "C4cBVQDZr24kTJEclZxwfbGlGBAYmLAjZAAAwMDA";

    #[test]
    fn sylfrey_translates_to_engine_string() {
        let d = decode(SYLFREY, &crate::forever::test_data().talents["paladin"]).unwrap();
        assert_eq!(d.talents_string, "-05005133210012");
        assert_eq!(d.points_per_tree, vec![0, 23, 0]);
        assert!(d.unknown_definitions.is_empty());
    }

    #[test]
    fn tree_views_put_ranks_on_the_calculator_layout() {
        let class = &crate::forever::test_data().talents["paladin"];
        let d = decode(SYLFREY, class).unwrap();
        let views = tree_views(class, &d.ranks);
        let names: Vec<&str> = views.iter().map(|v| v.name.as_str()).collect();
        assert_eq!(names, ["Holy", "Protection", "Retribution"]);
        assert_eq!(
            views.iter().map(|v| v.points).collect::<Vec<_>>(),
            [0, 23, 0]
        );
        let redoubt = &views[1].talents[1];
        assert_eq!(
            (
                redoubt.layout.name.as_str(),
                redoubt.rank,
                redoubt.layout.max_ranks
            ),
            ("Redoubt", 5, 5)
        );
        assert!(views[0].talents.iter().all(|t| t.rank == 0));
    }

    #[test]
    fn tree_views_without_ranks_are_all_zero() {
        let class = &crate::forever::test_data().talents["paladin"];
        let views = tree_views(class, &[]);
        assert_eq!(views.len(), 3);
        assert!(views
            .iter()
            .all(|v| v.points == 0 && v.talents.iter().all(|t| t.rank == 0)));
    }

    #[test]
    fn garbage_is_an_error_not_a_panic() {
        let class = &crate::forever::test_data().talents["paladin"];
        assert!(decode("!!!", class).is_err());
        assert!(decode("", class).is_err());
        assert!(decode("C4cB", class).is_err());
    }

    #[test]
    fn other_class_string_is_rejected() {
        // Decoding the bits against the warrior tree would "work" and yield garbage; the spec id catches it.
        let err = decode(SYLFREY, &crate::forever::test_data().talents["warrior"]).unwrap_err();
        assert!(err.contains("another class"), "{err}");
    }
}
