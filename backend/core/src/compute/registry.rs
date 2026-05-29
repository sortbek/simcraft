use crate::compute::provider::ProviderError;

/// Workload size + whether the handler is about to take its streaming-only path.
/// Routing consumes this; the handler computes it once.
#[derive(Debug, Clone, Copy)]
pub struct WorkloadEstimate {
    pub combo_count: usize,
    pub would_use_streaming_path: bool,
}

/// In-memory snapshot of provider readiness for one request. Built by the
/// handler from `ProviderSettings` (desktop server-side keys) and request
/// headers (web per-request keys). See Task 10.
pub struct ProviderAvailability {
    pub(crate) ready: std::collections::HashSet<&'static str>,
    pub(crate) remote_order: Vec<&'static str>,
}

impl ProviderAvailability {
    pub fn is_ready(&self, id: &str) -> bool {
        self.ready.contains(id)
    }
    pub fn first_configured_remote(&self) -> Option<&'static str> {
        self.remote_order.iter().copied().find(|id| self.ready.contains(id))
    }
}

/// Decides which provider id should run this request.
///
/// Order of precedence:
///   1. Explicit Local → always succeeds.
///   2. Explicit remote → 400 if unknown/unconfigured/streaming-sized.
///   3. Auto/absent + streaming-sized → Local (quiet fallback).
///   4. Auto/absent → smart_default.
pub fn pick_provider(
    sim_type: &str,
    requested: Option<&str>,
    avail: &ProviderAvailability,
    est: &WorkloadEstimate,
    known_remote_ids: &[&'static str],
) -> Result<&'static str, ProviderError> {
    match requested {
        Some("local") => Ok("local"),
        Some(id) if id != "auto" => {
            let canonical = if id == "local" {
                "local"
            } else {
                known_remote_ids
                    .iter()
                    .copied()
                    .find(|known| *known == id)
                    .ok_or_else(|| ProviderError::UnknownProvider(id.to_string()))?
            };
            if canonical == "local" {
                Ok("local")
            } else if !avail.is_ready(canonical) {
                Err(ProviderError::UnconfiguredProvider(canonical.to_string()))
            } else if est.would_use_streaming_path {
                Err(ProviderError::StreamingTooLargeForRemote)
            } else {
                Ok(canonical)
            }
        }
        _ => Ok(if est.would_use_streaming_path {
            "local"
        } else {
            smart_default(sim_type, avail, est)
        }),
    }
}

fn smart_default(
    sim_type: &str,
    avail: &ProviderAvailability,
    est: &WorkloadEstimate,
) -> &'static str {
    let big_job = matches!(sim_type, "top_gear" | "drop_finder" | "upgrade_compare")
        && est.combo_count >= 50;
    if big_job {
        avail.first_configured_remote().unwrap_or("local")
    } else {
        "local"
    }
}

// Stubs kept for the `pub use` in compute/mod.rs; replaced by real impls in Tasks 9-10.
pub struct ProviderRegistry;
pub struct ProviderSettings;

#[cfg(test)]
mod tests {
    use super::*;

    fn avail(ready: &[&'static str]) -> ProviderAvailability {
        ProviderAvailability {
            ready: ready.iter().copied().collect(),
            remote_order: vec!["simmit"],
        }
    }
    fn est(combos: usize, streaming: bool) -> WorkloadEstimate {
        WorkloadEstimate { combo_count: combos, would_use_streaming_path: streaming }
    }
    const REMOTES: &[&'static str] = &["simmit"];

    #[test]
    fn explicit_local_always_succeeds_even_streaming() {
        let r = pick_provider("top_gear", Some("local"), &avail(&[]), &est(2000, true), REMOTES);
        assert_eq!(r.unwrap(), "local");
    }
    #[test]
    fn explicit_simmit_unconfigured_errors() {
        let r = pick_provider("top_gear", Some("simmit"), &avail(&["local"]), &est(100, false), REMOTES);
        assert!(matches!(r, Err(ProviderError::UnconfiguredProvider(ref id)) if id == "simmit"));
    }
    #[test]
    fn explicit_simmit_configured_streaming_errors() {
        let r = pick_provider("top_gear", Some("simmit"), &avail(&["local","simmit"]), &est(2000, true), REMOTES);
        assert!(matches!(r, Err(ProviderError::StreamingTooLargeForRemote)));
    }
    #[test]
    fn explicit_simmit_configured_normal_ok() {
        let r = pick_provider("top_gear", Some("simmit"), &avail(&["local","simmit"]), &est(100, false), REMOTES);
        assert_eq!(r.unwrap(), "simmit");
    }
    #[test]
    fn explicit_unknown_provider_errors() {
        let r = pick_provider("top_gear", Some("raidbots"), &avail(&["local"]), &est(100, false), REMOTES);
        assert!(matches!(r, Err(ProviderError::UnknownProvider(ref id)) if id == "raidbots"));
    }
    #[test]
    fn auto_streaming_falls_back_to_local_quietly() {
        let r = pick_provider("top_gear", Some("auto"), &avail(&["local","simmit"]), &est(2000, true), REMOTES);
        assert_eq!(r.unwrap(), "local");
    }
    #[test]
    fn auto_big_job_picks_remote_when_configured() {
        let r = pick_provider("top_gear", None, &avail(&["local","simmit"]), &est(100, false), REMOTES);
        assert_eq!(r.unwrap(), "simmit");
    }
    #[test]
    fn auto_big_job_falls_back_to_local_when_remote_unconfigured() {
        let r = pick_provider("top_gear", None, &avail(&["local"]), &est(100, false), REMOTES);
        assert_eq!(r.unwrap(), "local");
    }
    #[test]
    fn auto_quick_sim_stays_local_even_when_remote_ready() {
        let r = pick_provider("quick", None, &avail(&["local","simmit"]), &est(0, false), REMOTES);
        assert_eq!(r.unwrap(), "local");
    }
    #[test]
    fn auto_small_top_gear_stays_local() {
        let r = pick_provider("top_gear", None, &avail(&["local","simmit"]), &est(20, false), REMOTES);
        assert_eq!(r.unwrap(), "local");
    }
}
