use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Game {
    Retail,
    Forever,
}

impl Game {
    pub fn as_str(self) -> &'static str {
        match self {
            Game::Retail => "retail",
            Game::Forever => "forever",
        }
    }
}

fn wow_header(simc_input: &str) -> Option<&str> {
    simc_input
        .lines()
        .take(20)
        .find_map(|line| line.trim().strip_prefix("# WoW "))
}

/// Reads the `# WoW <version>, TOC <toc>` header the SimC addon writes. Forever runs a 1.x
/// client (TOC 16001); anything else, or no header, is retail.
pub fn detect_game(simc_input: &str) -> Game {
    let Some(rest) = wow_header(simc_input) else {
        return Game::Retail;
    };
    let major = rest
        .split('.')
        .next()
        .and_then(|m| m.trim().parse::<u32>().ok());
    let toc = rest
        .split("TOC")
        .nth(1)
        .and_then(|t| t.trim().parse::<u32>().ok());
    if major == Some(1) || toc.is_some_and(|t| t < 20000) {
        Game::Forever
    } else {
        Game::Retail
    }
}

/// The client build from the header, e.g. `1.60.1.70374`.
pub fn client_build(simc_input: &str) -> Option<String> {
    let version = wow_header(simc_input)?.split(',').next()?.trim();
    (!version.is_empty()).then(|| version.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FOREVER: &str = "# Sylfrey - 2026-10-14 10:30 - /Classic Beta PvE\n# SimC Addon 12.1.5-01\n# WoW 1.60.1.70374, TOC 16001\n";

    #[test]
    fn forever_header_is_forever() {
        assert_eq!(detect_game(FOREVER), Game::Forever);
        assert_eq!(client_build(FOREVER).as_deref(), Some("1.60.1.70374"));
    }

    #[test]
    fn retail_header_is_retail() {
        assert_eq!(
            detect_game("# SimC Addon 12.1.5-01\n# WoW 12.0.5.66102, TOC 120005\n"),
            Game::Retail
        );
    }

    #[test]
    fn missing_header_is_retail() {
        assert_eq!(detect_game("paladin=\"X\"\nlevel=80\n"), Game::Retail);
        assert_eq!(client_build("paladin=\"X\"\n"), None);
    }
}
