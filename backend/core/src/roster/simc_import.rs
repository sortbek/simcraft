use crate::types::class_data::{class_line_character, title_case};

/// One character's SimC profile, carved out of a multi-profile paste.
pub struct SimcProfile {
    pub name: String,
    pub realm: String,
    pub simc: String,
}

/// Split a paste containing one or more SimC profiles into a block per character.
/// An empty result means the text holds no profiles at all (the caller falls back
/// to the armory path).
///
/// A block runs from its class line to just before the next one. Comments are kept
/// verbatim, so a block absorbs the *following* character's header comment — inert
/// for both SimC and `addon_parser`, and preferable to backing the split point up
/// over preceding comments, which would move a vault section into the wrong block.
pub fn split_simc_profiles(input: &str) -> Vec<SimcProfile> {
    let lines: Vec<&str> = input.lines().collect();
    let starts: Vec<(usize, String)> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| class_line_character(line).map(|name| (i, name)))
        .collect();

    starts
        .iter()
        .enumerate()
        .map(|(n, (start, name))| {
            let end = starts.get(n + 1).map_or(lines.len(), |(next, _)| *next);
            let mut block = &lines[*start..end];
            while block.last().is_some_and(|l| l.trim().is_empty()) {
                block = &block[..block.len() - 1];
            }
            let simc = block.join("\n");
            SimcProfile {
                name: name.clone(),
                realm: server_realm(&simc),
                simc,
            }
        })
        .collect()
}

/// `server=tarren_mill` -> `Tarren Mill`. Empty when the profile has no server line.
fn server_realm(block: &str) -> String {
    block
        .lines()
        .find_map(|line| line.trim().strip_prefix("server="))
        .map(|slug| title_case(&slug.trim().replace('_', " ")))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> String {
        let p = format!(
            "{}/tests/fixtures/roster_simc_paste.txt",
            env!("CARGO_MANIFEST_DIR")
        );
        std::fs::read_to_string(p).unwrap()
    }

    #[test]
    fn splits_a_two_raider_paste_into_one_block_each() {
        let got = split_simc_profiles(&sample());
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].name, "Duskryth");
        assert_eq!(got[1].name, "Sørtbek");
    }

    #[test]
    fn each_block_keeps_only_its_own_gear() {
        let got = split_simc_profiles(&sample());
        // Duskryth's head, not the hunter's.
        assert!(got[0].simc.contains("id=249997"));
        assert!(!got[0].simc.contains("id=249988"));
        assert!(got[1].simc.contains("id=249988"));
        assert!(!got[1].simc.contains("id=249997"));
    }

    #[test]
    fn reads_realm_from_the_server_line() {
        let got = split_simc_profiles(&sample());
        assert_eq!(got[0].realm, "Silvermoon");
        assert_eq!(got[1].realm, "Draenor");
    }

    #[test]
    fn title_cases_a_multi_word_realm_slug() {
        let got = split_simc_profiles("mage=\"Jaina\"\nserver=tarren_mill\n");
        assert_eq!(got[0].realm, "Tarren Mill");
    }

    #[test]
    fn recognises_class_aliases_the_addon_emits() {
        // The addon writes `deathknight=`, not `death_knight=`.
        let got = split_simc_profiles("deathknight=\"Arthas\"\nserver=frostmourne\n");
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "Arthas");
    }

    #[test]
    fn text_without_a_class_line_yields_no_profiles() {
        assert!(split_simc_profiles("Thrall-Draenor\nJaina-Tarren Mill").is_empty());
    }

    #[test]
    fn a_profile_without_a_server_line_gets_an_empty_realm() {
        let got = split_simc_profiles("mage=\"Jaina\"\nlevel=90\n");
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].realm, "");
    }
}
