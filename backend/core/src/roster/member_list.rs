/// Parse pasted roster text into (name, realm) pairs. Accepts `Realm-Playername`
/// (realm may contain spaces/extra dashes — split on the LAST dash, since a
/// character name never contains one). Skips lines without both parts. Dedupes
/// case-insensitively, preserving first-seen order.
pub fn parse_member_list(input: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for line in input.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Some((realm, name)) = line.rsplit_once('-') else {
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
    fn parses_realm_dash_name_lines() {
        let input = "Draenor-Thrall\nTarren Mill-Jaina\n";
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
        // Realm with an internal dash; name is always the segment after the LAST dash.
        let input = "Azjol-Nerub-Thrall";
        let got = parse_member_list(input);
        assert_eq!(got, vec![("Thrall".to_string(), "Azjol-Nerub".to_string())]);
    }

    #[test]
    fn trims_blank_lines_and_whitespace() {
        let input = "  Draenor - Thrall  \n\n\nTarren Mill-Jaina";
        let got = parse_member_list(input);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0], ("Thrall".to_string(), "Draenor".to_string()));
    }

    #[test]
    fn dedupes_case_insensitively() {
        let input = "Draenor-Thrall\ndraenor-thrall";
        assert_eq!(parse_member_list(input).len(), 1);
    }

    #[test]
    fn skips_lines_without_a_realm() {
        let input = "JustAName\nDraenor-Thrall";
        let got = parse_member_list(input);
        assert_eq!(got, vec![("Thrall".to_string(), "Draenor".to_string())]);
    }
}
