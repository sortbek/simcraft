/// Lines whose first `=`-prefix matches any of these are stripped before
/// submitting to Simmit and from re-runs of shared results.
/// Source: docs.simmit.com /docs/api/input-constraints.
pub const BLOCKED_PREFIXES: &[&str] = &[
    "threads",
    "profileset_work_threads",
    "profileset_init_threads",
    "process_priority",
    "output",
    "html",
    "json",
    "json2",
    "log",
    "save",
    "save_actor_lists",
    "save_gear",
    "save_profiles",
    "save_talent_str",
    "debug_seed",
    "debug_each",
    "debug",
    "full_states",
    "local_json",
    "proxy",
    "http_clear_cache",
    "guild",
    "apiKey",
    "apikey",
    "api_key",
    "spell_query_xml_output_file",
    "reforge_plot_output_file",
    "progressbar_type",
];

pub const BLOCKED_PREFIX_GLOBS: &[&str] = &["dps_plot_", "reforge_plot_"];

/// Re-runs of shared results also block whole option families: SimC has many
/// file-writing variants (save_actions, save_talents, json2, ...).
pub const RERUN_BLOCKED_KEY_PREFIXES: &[&str] = &[
    "save",
    "output",
    "json",
    "html",
    "log",
    "xml",
    "report",
    "debug",
    "spell_query",
    "reforge_plot",
    "dps_plot",
    // includes a local file the re-run could then leak into a later share
    "input",
];

/// Splits a line into the tokens SimC sees: whitespace outside double quotes
/// separates tokens, quotes are dropped, and a token starting with `#` ends the line.
pub fn simc_tokens(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let (mut in_quotes, mut started) = (false, false);
    for c in line.chars() {
        if c == '"' {
            in_quotes = !in_quotes;
            started = true;
        } else if c.is_whitespace() && !in_quotes {
            if started {
                tokens.push(std::mem::take(&mut cur));
                started = false;
            }
        } else if c == '#' && !in_quotes && !started {
            break;
        } else {
            cur.push(c);
            started = true;
        }
    }
    if started {
        tokens.push(cur);
    }
    tokens
}

fn option_key(key: &str) -> String {
    key.trim().trim_end_matches('+').trim().to_ascii_lowercase()
}

/// A token a shared sim may not carry. Without `=` SimC opens the token as an
/// input file and runs it. A shared `request` is held to the Simmit blocklist as
/// well as the file-writing families; the finished input only to the latter, and
/// keeps the `report_details=` line the backend writes itself.
pub fn is_blocked_rerun_token(tok: &str, request: bool) -> bool {
    let Some((key, rest)) = tok.split_once('=') else {
        return true;
    };
    let key = option_key(key);
    (request && BLOCKED_PREFIXES.iter().any(|p| p.eq_ignore_ascii_case(&key)))
        || (RERUN_BLOCKED_KEY_PREFIXES.iter().any(|p| key.starts_with(p))
            && (request || key != "report_details"))
        // `profileset."x"+=output=...` applies a sim option to the profileset's sim
        || (key.starts_with("profileset.") && is_blocked_rerun_token(rest, request))
}

/// `$(var)` substitution can assemble a blocked key or an include from parts.
pub fn has_substitution(line: &str) -> bool {
    line.contains("$(")
}

/// The first line of a finished SimC input a shared sim must not run: an
/// include, a `$(var)` substitution or a file-writing option. Checks the text
/// SimC actually reads, so backend rewrites of sanitized fields are covered too.
pub fn first_unsafe_line(input: &str) -> Option<&str> {
    input.lines().find(|line| {
        has_substitution(line)
            || simc_tokens(line)
                .iter()
                .any(|t| is_blocked_rerun_token(t, false))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_follow_simc_quoting_and_comments() {
        assert_eq!(
            simc_tokens(r#"evoker="A b" x=1 # c=2"#),
            ["evoker=A b", "x=1"]
        );
        assert!(simc_tokens("  # whole line").is_empty());
        assert_eq!(simc_tokens("x=1#y"), ["x=1#y"]);
    }

    #[test]
    fn final_check_allows_backend_lines_and_blocks_includes() {
        let ok = "warrior=\"X\"\nname=X\nreport_details=1\nprofileset_work_threads=1\n\
            profileset.\"Combo 2\"+=head=,id=1\n# Consumables\n\ntemporary_enchant=";
        assert_eq!(first_unsafe_line(ok), None);
        assert_eq!(
            first_unsafe_line(r"name=A C:\inc.simc"),
            Some(r"name=A C:\inc.simc")
        );
        assert_eq!(first_unsafe_line("x=1\nou$(t)put=a"), Some("ou$(t)put=a"));
        assert!(first_unsafe_line("save_actions=a").is_some());
    }
}
