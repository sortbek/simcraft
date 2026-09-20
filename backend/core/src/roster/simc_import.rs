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
/// A block runs from the character's own header comment, which the addon writes
/// directly above the class line, to just before the next character's. Exactly one
/// line is claimed: backing the split point up over every preceding comment would
/// move a vault section into the wrong block.
pub fn split_simc_profiles(input: &str) -> Vec<SimcProfile> {
    let lines: Vec<&str> = input.lines().collect();
    let starts: Vec<(usize, String)> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| class_line_character(line).map(|name| (i, name)))
        .collect();

    let block_starts: Vec<usize> = starts
        .iter()
        .map(|(i, name)| match i.checked_sub(1) {
            Some(prev) if is_header_for(lines[prev], name) => prev,
            _ => *i,
        })
        .collect();

    starts
        .iter()
        .enumerate()
        .map(|(n, (_, name))| {
            let end = block_starts.get(n + 1).copied().unwrap_or(lines.len());
            let mut block = &lines[block_starts[n]..end];
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

/// The addon's per-character header: `# Duskryth - Devastation - EU/Silvermoon`.
/// The name must be followed by a separator, so `# Annabelle - ...` is not Ann's
/// header and `# head=,id=...` is not a bag line surrendered to a character named
/// `head`. `###` section markers never match: stripping one `#` leaves `##`.
fn is_header_for(line: &str, name: &str) -> bool {
    line.trim()
        .strip_prefix('#')
        .and_then(|rest| rest.trim_start().strip_prefix(name))
        .is_some_and(|rest| rest.is_empty() || rest.starts_with(char::is_whitespace))
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

    #[test]
    fn a_block_keeps_its_own_header_and_not_the_next_characters() {
        let got = split_simc_profiles(&sample());
        assert!(got[0].simc.starts_with("# Duskryth - Devastation - EU/Silvermoon"));
        assert!(!got[0].simc.contains("Sørtbek"));
        assert!(got[1].simc.starts_with("# Sørtbek - unknown - EU/Draenor"));
    }

    #[test]
    fn a_vault_section_stays_with_the_character_it_belongs_to() {
        let paste = concat!(
            "# Jaina - Frost - EU/Draenor\n",
            "mage=\"Jaina\"\nserver=draenor\nhead=,id=111111\n\n",
            "### Weekly Reward Choices\n",
            "# head=,id=222222\n",
            "### End of Weekly Reward Choices\n\n",
            "# Thrall - Enhancement - EU/Draenor\n",
            "shaman=\"Thrall\"\nserver=draenor\nhead=,id=333333\n",
        );
        let got = split_simc_profiles(paste);
        assert_eq!(got.len(), 2);
        assert!(got[0].simc.contains("id=222222"), "vault item belongs to Jaina");
        assert!(!got[1].simc.contains("id=222222"));
        assert!(got[1].simc.starts_with("# Thrall - Enhancement - EU/Draenor"));
    }

    #[test]
    fn a_comment_that_merely_starts_with_the_name_is_not_its_header() {
        // `Ann` is a prefix of `Annabelle`, and a bag line can start with a slot
        // name. Neither is the character's header, so neither joins the block.
        let prefix = "# Annabelle - Frost - EU/Draenor\nmage=\"Ann\"\nserver=draenor\n";
        assert!(split_simc_profiles(prefix)[0].simc.starts_with("mage=\"Ann\""));

        let bag = "# head=,id=222222\nhunter=\"head\"\nserver=draenor\n";
        assert!(split_simc_profiles(bag)[0].simc.starts_with("hunter=\"head\""));
    }
}
