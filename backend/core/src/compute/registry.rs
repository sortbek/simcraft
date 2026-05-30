use crate::compute::provider::{ProviderAuth, ProviderError, SimcProvider};
use crate::db::SettingsRepo;
use crate::server::SimcBinaries;
use actix_web::http::header::HeaderMap;
use secrecy::SecretString;
use std::collections::HashMap;
use std::sync::Arc;

/// Workload size + whether the handler is about to take its streaming-only path.
/// Routing consumes this; the handler computes it once.
#[derive(Debug, Clone, Copy)]
pub struct WorkloadEstimate {
    pub combo_count: usize,
    pub would_use_streaming_path: bool,
}

/// In-memory snapshot of provider readiness for one request. Built by the
/// handler from `ProviderSettings` (desktop server-side keys) and request
/// headers (web per-request keys).
pub struct ProviderAvailability {
    pub(crate) ready: std::collections::HashSet<&'static str>,
    pub(crate) remote_order: Vec<&'static str>,
    pub(crate) auth_by_id: std::collections::HashMap<&'static str, ProviderAuth>,
}

impl ProviderAvailability {
    pub fn build(
        settings: &ProviderSettings,
        registry: &ProviderRegistry,
        req_headers: &HeaderMap,
    ) -> Self {
        let mut ready: std::collections::HashSet<&'static str> = ["local"].into_iter().collect();
        let mut auth_by_id = std::collections::HashMap::new();
        auth_by_id.insert("local", ProviderAuth::None);
        let remote_order = registry.remote_ids();

        for &id in &remote_order {
            if let Some(key) = settings.get_api_key(id) {
                ready.insert(id);
                auth_by_id.insert(id, ProviderAuth::BearerToken(SecretString::new(key.to_string().into())));
                continue;
            }
            let header_name = format!("X-Provider-{}-Key", id);
            if let Some(val) = req_headers.get(&header_name).and_then(|h| h.to_str().ok()) {
                if !val.is_empty() {
                    ready.insert(id);
                    auth_by_id.insert(id, ProviderAuth::BearerToken(SecretString::new(val.to_string().into())));
                }
            }
        }
        Self { ready, remote_order, auth_by_id }
    }

    pub fn is_ready(&self, id: &str) -> bool {
        self.ready.contains(id)
    }

    pub fn first_configured_remote(&self) -> Option<&'static str> {
        self.remote_order.iter().copied().find(|id| self.ready.contains(id))
    }

    pub fn auth_for(&self, id: &str) -> ProviderAuth {
        self.auth_by_id.get(id).cloned().unwrap_or(ProviderAuth::None)
    }
}

/// Decides which provider id should run this request.
///
/// Order of precedence:
///   1. Explicit Local → always succeeds.
///   2. Explicit remote → 400 if unknown/unconfigured; if streaming-sized,
///      returns the provider only if it is cloud-streaming-capable (B2 path),
///      otherwise errors with StreamingTooLargeForRemote.
///   3. Auto/absent + streaming-sized → Local (quiet fallback; never silently
///      start a cloud bill).
///   4. Auto/absent → smart_default.
///
/// `cloud_streaming_ids` is the subset of `known_remote_ids` whose providers
/// report `capabilities().cloud_streaming == true`. Callers that hold a
/// `ProviderRegistry` compute this set from the registry; tests pass it
/// directly. Must not be empty when cloud routing is expected to succeed.
pub fn pick_provider(
    sim_type: &str,
    requested: Option<&str>,
    avail: &ProviderAvailability,
    est: &WorkloadEstimate,
    known_remote_ids: &[&'static str],
    cloud_streaming_ids: &[&'static str],
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
                // B2: a cloud-streaming-capable provider handles the large job
                // via the chunk orchestrator. Otherwise it's still too large.
                if cloud_streaming_ids.contains(&canonical) {
                    Ok(canonical)
                } else {
                    Err(ProviderError::StreamingTooLargeForRemote)
                }
            } else {
                Ok(canonical)
            }
        }
        _ => Ok(if est.would_use_streaming_path {
            // Auto/absent + streaming-sized: stay local. Never silently start
            // a cloud bill.
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
    let big_job = matches!(sim_type, "top_gear" | "droptimizer" | "enchant_gem" | "upgrade_compare")
        && est.combo_count >= 50;
    if big_job {
        avail.first_configured_remote().unwrap_or("local")
    } else {
        "local"
    }
}

pub struct ProviderSettings {
    api_keys: HashMap<&'static str, String>,
    enabled: HashMap<&'static str, bool>,
}

impl ProviderSettings {
    /// One async call per sim-create. Reads provider.<id>.api_key and
    /// provider.<id>.enabled for every remote provider id in the registry.
    pub async fn load(
        repo: &SettingsRepo,
        remote_ids: &[&'static str],
    ) -> Result<Self, sqlx::Error> {
        let mut api_keys = HashMap::new();
        let mut enabled = HashMap::new();
        for &id in remote_ids {
            if let Some(k) = repo.get(&format!("provider.{}.api_key", id)).await? {
                if !k.is_empty() {
                    api_keys.insert(id, k);
                }
            }
            let on = repo.get(&format!("provider.{}.enabled", id)).await?
                .map(|v| v == "true")
                .unwrap_or(true);
            enabled.insert(id, on);
        }
        Ok(Self { api_keys, enabled })
    }

    pub fn get_api_key(&self, id: &str) -> Option<&str> {
        if !self.enabled.get(id).copied().unwrap_or(true) {
            return None;
        }
        self.api_keys.get(id).map(|s| s.as_str())
    }
}

pub struct ProviderRegistry {
    providers: std::collections::HashMap<&'static str, Arc<dyn SimcProvider>>,
    remote_order: Vec<&'static str>,
}

impl ProviderRegistry {
    pub fn new_default(
        simc_bins: Arc<SimcBinaries>,
        pool: Option<sqlx::AnyPool>,
        local_queue: crate::compute::local::LocalSimQueue,
        http: reqwest::Client,
    ) -> Self {
        let mut providers: std::collections::HashMap<&'static str, Arc<dyn SimcProvider>> =
            std::collections::HashMap::new();
        providers.insert(
            "local",
            Arc::new(crate::compute::local::LocalSimcProvider::new(
                simc_bins,
                pool,
                local_queue,
            )),
        );
        providers.insert(
            "simmit",
            Arc::new(crate::compute::simmit::SimmitProvider::new(http.clone())),
        );
        Self {
            providers,
            remote_order: vec!["simmit"],
        }
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn SimcProvider>> {
        self.providers.get(id).cloned()
    }

    pub fn ids(&self) -> Vec<&'static str> {
        let mut v: Vec<&'static str> = self.providers.keys().copied().collect();
        v.sort();
        v
    }

    pub fn remote_ids(&self) -> Vec<&'static str> {
        self.remote_order.clone()
    }

    /// Convenience: combines pick_provider lookup + registry get.
    pub fn for_request(
        &self,
        sim_type: &str,
        compute_provider: Option<&str>,
        avail: &ProviderAvailability,
        est: &WorkloadEstimate,
    ) -> Result<Arc<dyn SimcProvider>, crate::compute::provider::ProviderError> {
        let known: Vec<&'static str> = self.remote_ids();
        let cloud_streaming: Vec<&'static str> = self
            .providers
            .iter()
            .filter(|(_, p)| p.capabilities().cloud_streaming)
            .map(|(id, _)| *id)
            .collect();
        let id = pick_provider(sim_type, compute_provider, avail, est, &known, &cloud_streaming)?;
        self.get(id).ok_or_else(|| {
            crate::compute::provider::ProviderError::UnknownProvider(id.to_string())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn avail(ready: &[&'static str]) -> ProviderAvailability {
        let mut auth_by_id = std::collections::HashMap::new();
        auth_by_id.insert("local", ProviderAuth::None);
        ProviderAvailability {
            ready: ready.iter().copied().collect(),
            remote_order: vec!["simmit"],
            auth_by_id,
        }
    }
    fn est(combos: usize, streaming: bool) -> WorkloadEstimate {
        WorkloadEstimate { combo_count: combos, would_use_streaming_path: streaming }
    }
    const REMOTES: &[&'static str] = &["simmit"];
    const CLOUD_STREAMING: &[&'static str] = &["simmit"];

    #[test]
    fn explicit_local_always_succeeds_even_streaming() {
        let r = pick_provider("top_gear", Some("local"), &avail(&[]), &est(2000, true), REMOTES, CLOUD_STREAMING);
        assert_eq!(r.unwrap(), "local");
    }
    #[test]
    fn explicit_simmit_unconfigured_errors() {
        let r = pick_provider("top_gear", Some("simmit"), &avail(&["local"]), &est(100, false), REMOTES, CLOUD_STREAMING);
        assert!(matches!(r, Err(ProviderError::UnconfiguredProvider(ref id)) if id == "simmit"));
    }
    #[test]
    fn explicit_simmit_streaming_errors_when_not_cloud_capable() {
        // A configured remote that is NOT in cloud_streaming_ids still errors
        // for a streaming-sized job.
        let r = pick_provider(
            "top_gear", Some("simmit"), &avail(&["local", "simmit"]),
            &est(2000, true), REMOTES, &[], // empty cloud-streaming set
        );
        assert!(matches!(r, Err(ProviderError::StreamingTooLargeForRemote)));
    }
    #[test]
    fn explicit_simmit_configured_normal_ok() {
        let r = pick_provider("top_gear", Some("simmit"), &avail(&["local","simmit"]), &est(100, false), REMOTES, CLOUD_STREAMING);
        assert_eq!(r.unwrap(), "simmit");
    }
    #[test]
    fn explicit_unknown_provider_errors() {
        let r = pick_provider("top_gear", Some("raidbots"), &avail(&["local"]), &est(100, false), REMOTES, CLOUD_STREAMING);
        assert!(matches!(r, Err(ProviderError::UnknownProvider(ref id)) if id == "raidbots"));
    }
    #[test]
    fn auto_streaming_falls_back_to_local_quietly() {
        let r = pick_provider("top_gear", Some("auto"), &avail(&["local","simmit"]), &est(2000, true), REMOTES, CLOUD_STREAMING);
        assert_eq!(r.unwrap(), "local");
    }
    #[test]
    fn auto_big_job_picks_remote_when_configured() {
        let r = pick_provider("top_gear", None, &avail(&["local","simmit"]), &est(100, false), REMOTES, CLOUD_STREAMING);
        assert_eq!(r.unwrap(), "simmit");
    }
    #[test]
    fn auto_big_job_falls_back_to_local_when_remote_unconfigured() {
        let r = pick_provider("top_gear", None, &avail(&["local"]), &est(100, false), REMOTES, CLOUD_STREAMING);
        assert_eq!(r.unwrap(), "local");
    }
    #[test]
    fn auto_quick_sim_stays_local_even_when_remote_ready() {
        let r = pick_provider("quick", None, &avail(&["local","simmit"]), &est(0, false), REMOTES, CLOUD_STREAMING);
        assert_eq!(r.unwrap(), "local");
    }
    #[test]
    fn auto_small_top_gear_stays_local() {
        let r = pick_provider("top_gear", None, &avail(&["local","simmit"]), &est(20, false), REMOTES, CLOUD_STREAMING);
        assert_eq!(r.unwrap(), "local");
    }

    // --- B2 routing: new cases ---

    #[test]
    fn explicit_simmit_configured_streaming_returns_simmit_when_cloud_capable() {
        // Explicit cloud-streaming-capable remote + streaming-sized job → returns
        // that provider (not StreamingTooLargeForRemote). The B2 orchestrator
        // takes over from here.
        let r = pick_provider(
            "top_gear", Some("simmit"), &avail(&["local", "simmit"]),
            &est(2000, true), REMOTES, CLOUD_STREAMING,
        );
        assert_eq!(r.unwrap(), "simmit");
    }

    #[test]
    fn auto_streaming_still_falls_back_to_local_even_when_cloud_capable() {
        // Auto + streaming-sized must never silently start a cloud bill, even
        // when a cloud-streaming-capable provider is configured.
        let r = pick_provider(
            "top_gear", Some("auto"), &avail(&["local", "simmit"]),
            &est(2000, true), REMOTES, CLOUD_STREAMING,
        );
        assert_eq!(r.unwrap(), "local");
    }
}
