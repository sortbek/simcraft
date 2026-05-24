//! Low-level helpers for reading and mutating SimulationCraft gear lines.
//!
//! These operate on the value portion of a simc gear directive (the text after
//! `slot=`). They don't depend on the game-data tables, so both `item_db` and
//! `profileset_generator` can use them without circular imports.

use once_cell::sync::Lazy;
use regex::Regex;

static ENCHANT_ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"enchant_id=\d+").unwrap());
static ENCHANT_ID_CAPTURE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"enchant_id=(\d+)").unwrap());
// `gem_id` can hold a slash-separated list for multi-socket items
// (e.g. `gem_id=213470/213470` for a 2-socket neck). All regex/capture
// helpers below accept the multi-value form; single-value is just the
// length-1 case.
static GEM_ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"gem_id=[\d/]+").unwrap());
static GEM_ID_CAPTURE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"gem_id=([\d/]+)").unwrap());
static ITEM_ID_CAPTURE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"id=(\d+)").unwrap());
static AFTER_ITEM_ID_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(,id=\d+)").unwrap());
static BONUS_ID_CAPTURE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"bonus_id=([0-9/:]+)").unwrap());
static STRIP_GEM_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r",?gem_id=[\d/]+").unwrap());

/// Replace the existing `enchant_id=N` if present, otherwise insert one right after `,id=N`.
pub fn set_enchant_id(simc: &str, enchant_id: u64) -> String {
    if ENCHANT_ID_RE.is_match(simc) {
        ENCHANT_ID_RE
            .replace(simc, &format!("enchant_id={}", enchant_id))
            .to_string()
    } else {
        AFTER_ITEM_ID_RE
            .replace(simc, &format!("$1,enchant_id={}", enchant_id))
            .to_string()
    }
}

/// Replace the existing `gem_id=…` if present, otherwise insert one right after `,id=N`.
/// Convenience wrapper around `set_gem_ids` for the common single-socket case.
pub fn set_gem_id(simc: &str, gem_id: u64) -> String {
    set_gem_ids(simc, &[gem_id])
}

/// Replace the existing `gem_id=…` with a slash-separated list, or insert one
/// right after `,id=N`. An empty slice strips any existing `gem_id` (use
/// `strip_gem_id` directly if that's all you want).
pub fn set_gem_ids(simc: &str, gem_ids: &[u64]) -> String {
    if gem_ids.is_empty() {
        return strip_gem_id(simc);
    }
    let joined = gem_ids
        .iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join("/");
    if GEM_ID_RE.is_match(simc) {
        GEM_ID_RE
            .replace(simc, &format!("gem_id={}", joined))
            .to_string()
    } else {
        AFTER_ITEM_ID_RE
            .replace(simc, &format!("$1,gem_id={}", joined))
            .to_string()
    }
}

/// Strip any existing `gem_id=…` from a simc gear line (leading comma included).
pub fn strip_gem_id(simc: &str) -> String {
    STRIP_GEM_RE.replace(simc, "").to_string()
}

pub fn extract_enchant_id(simc: &str) -> u64 {
    ENCHANT_ID_CAPTURE_RE
        .captures(simc)
        .and_then(|c| c[1].parse().ok())
        .unwrap_or(0)
}

/// Return the first gem id, or 0 if none. For a multi-socket line like
/// `gem_id=A/B` this returns `A` — sufficient for the binary "is any socket
/// filled" checks scattered through the generator. Use `extract_gem_ids`
/// when the full list matters.
pub fn extract_gem_id(simc: &str) -> u64 {
    extract_gem_ids(simc).into_iter().next().unwrap_or(0)
}

/// Return every gem id from a `gem_id=A/B/...` value. Empty Vec when no
/// `gem_id` is present.
pub fn extract_gem_ids(simc: &str) -> Vec<u64> {
    GEM_ID_CAPTURE_RE
        .captures(simc)
        .map(|c| {
            c[1].split('/')
                .filter_map(|s| s.parse().ok())
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod gem_tests {
    use super::*;

    #[test]
    fn set_gem_ids_emits_slash_separated_for_multi() {
        let s = ",id=100,bonus_id=12";
        assert_eq!(set_gem_ids(s, &[111, 222]), ",id=100,gem_id=111/222,bonus_id=12");
    }

    #[test]
    fn set_gem_ids_replaces_existing_multi() {
        let s = ",id=100,gem_id=999/888,bonus_id=12";
        assert_eq!(set_gem_ids(s, &[111, 222]), ",id=100,gem_id=111/222,bonus_id=12");
    }

    #[test]
    fn set_gem_ids_replaces_existing_single_with_multi() {
        let s = ",id=100,gem_id=999,bonus_id=12";
        assert_eq!(set_gem_ids(s, &[111, 222]), ",id=100,gem_id=111/222,bonus_id=12");
    }

    #[test]
    fn set_gem_ids_empty_strips() {
        let s = ",id=100,gem_id=111/222,bonus_id=12";
        assert_eq!(set_gem_ids(s, &[]), ",id=100,bonus_id=12");
    }

    #[test]
    fn extract_gem_ids_parses_slash_list() {
        assert_eq!(extract_gem_ids(",id=100,gem_id=111/222/333"), vec![111, 222, 333]);
    }

    #[test]
    fn extract_gem_ids_returns_empty_when_no_gem() {
        assert!(extract_gem_ids(",id=100").is_empty());
    }

    #[test]
    fn extract_gem_id_returns_first_of_multi() {
        // Compat: legacy callers using single-valued extract still see a
        // non-zero answer when the line has any gem at all.
        assert_eq!(extract_gem_id(",id=100,gem_id=111/222"), 111);
    }

    #[test]
    fn strip_gem_id_handles_multi() {
        let s = ",id=100,gem_id=111/222,bonus_id=12";
        assert_eq!(strip_gem_id(s), ",id=100,bonus_id=12");
    }
}

pub fn extract_item_id(simc: &str) -> u64 {
    ITEM_ID_CAPTURE_RE
        .captures(simc)
        .and_then(|c| c[1].parse().ok())
        .unwrap_or(0)
}

/// Parse the comma- or slash-separated bonus_id list from a simc gear line.
/// Returns an empty Vec when no `bonus_id=` is present.
pub fn extract_bonus_ids(simc: &str) -> Vec<u64> {
    BONUS_ID_CAPTURE_RE
        .captures(simc)
        .map(|c| {
            c[1].split(&['/', ':'][..])
                .filter_map(|s| s.parse().ok())
                .collect()
        })
        .unwrap_or_default()
}
