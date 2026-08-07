/// Parse pasted roster text into (name, realm) pairs. Accepts `CharacterName-Realm`
/// (realm may contain spaces/extra dashes — split on the FIRST dash, since a
/// character name never contains one). Skips lines without both parts, and any
/// line holding `#` or `=`: a truncated SimC paste reaches this parser, and its
/// `# Name - Spec - EU/Realm` headers would otherwise become bogus pairs. Dedupes
/// case-insensitively, preserving first-seen order.
pub fn parse_member_list(input: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for line in input.lines() {
        let line = line.trim();
        if line.is_empty() || line.contains('#') || line.contains('=') {
            continue;
        }
        let Some((name, realm)) = line.split_once('-') else {
            continue;
        };
        let name = name.trim();
        let realm = realm.trim();
        if name.is_empty() || realm.is_empty() {
            continue;
        }
        let key = format!("{}-{}", name.to_lowercase(), realm.to_lowercase());
        if seen.insert(key) {
            out.push((name.to_string(), realm.to_string()));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_name_dash_realm_lines() {
        let input = "Thrall-Draenor\nJaina-Tarren Mill\n";
        let got = parse_member_list(input);
        assert_eq!(
            got,
            vec![
                ("Thrall".to_string(), "Draenor".to_string()),
                ("Jaina".to_string(), "Tarren Mill".to_string()),
            ]
        );
    }

    #[test]
    fn realm_may_contain_dashes() {
        // Realm with an internal dash; name is always the segment before the FIRST dash.
        let input = "Thrall-Azjol-Nerub";
        let got = parse_member_list(input);
        assert_eq!(got, vec![("Thrall".to_string(), "Azjol-Nerub".to_string())]);
    }

    #[test]
    fn trims_blank_lines_and_whitespace() {
        let input = "  Thrall - Draenor  \n\n\nJaina-Tarren Mill";
        let got = parse_member_list(input);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0], ("Thrall".to_string(), "Draenor".to_string()));
    }

    #[test]
    fn dedupes_case_insensitively() {
        let input = "Thrall-Draenor\nthrall-draenor";
        assert_eq!(parse_member_list(input).len(), 1);
    }

    #[test]
    fn skips_simc_lines_so_a_truncated_paste_cant_mint_junk_members() {
        // A SimC paste missing its class line falls through to this parser, where
        // `# Duskryth - Devastation - EU/Silvermoon` would otherwise become a pair.
        let input = "# Duskryth - Devastation - EU/Silvermoon\nserver=silvermoon\nThrall-Draenor";
        let got = parse_member_list(input);
        assert_eq!(got, vec![("Thrall".to_string(), "Draenor".to_string())]);
    }

    #[test]
    fn skips_lines_without_a_realm() {
        let input = "JustAName\nThrall-Draenor";
        let got = parse_member_list(input);
        assert_eq!(got, vec![("Thrall".to_string(), "Draenor".to_string())]);
    }
}
