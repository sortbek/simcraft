//! Preflight credit/chunk estimate for cloud-streaming Top Gear.
//! `POST /api/top-gear/cloud-estimate` — advisory only; the orchestrator
//! re-validates affordability authoritatively at submit (see B2 spec).

use actix_web::{web, HttpRequest, HttpResponse};
use serde_json::json;
use std::sync::Arc;

use super::cloud_streaming::REMOTE_MAX_PROFILESETS_PER_JOB;
use super::handler_prep::{capped_max_combinations, preprocess_simc_input, socketed_item_ids};
use super::helpers::resolve_provider_for_request;
use super::types::TopGearRequest;
use super::SimcBinaries;
use crate::addon_parser;
use crate::compute::{ProviderRegistry, WorkloadEstimate};
use crate::db::{JobRepo, SettingsRepo};
use crate::game_data;
use crate::gear_resolver;
use crate::profileset_generator;

/// Simmit bills `credits = runtime_seconds × 32`. One constant so the estimate
/// and any future submit-side math agree.
const CREDITS_PER_RUNTIME_SECOND: u64 = 32;

/// Number of chunks for `combos` candidates at the given ceiling.
pub fn chunk_count(combos: u64, ceiling: usize) -> u64 {
    if combos == 0 || ceiling == 0 {
        return 0;
    }
    combos.div_ceil(ceiling as u64)
}

/// Conservative per-chunk runtime model (seconds on 32 vCPU). DELIBERATELY an
/// over-estimate; calibrate against real runs (spec Open Question). Model:
/// `base + per_profileset × profilesets`, scaled up as target_error tightens.
///
/// NOTE: this is a guess, not a measured constant. It exists to give the user a
/// ballpark and to gate obviously-unaffordable jobs. It is NOT used for billing
/// — Simmit bills actual runtime. Marked as tunable.
pub fn est_chunk_runtime_seconds(profilesets: u64, target_error: f64) -> u64 {
    let base: f64 = 30.0;
    let per_ps: f64 = 0.05; // ~50ms/profileset on 32 vCPU at te=0.1 (conservative)
    // Tighter target_error costs ~quadratically more iterations; clamp te.
    let te = target_error.clamp(0.01, 0.5);
    let te_factor = (0.1 / te).max(1.0); // te=0.1 → 1×, te=0.05 → 2×, te=0.01 → 10×
    ((base + per_ps * profilesets as f64) * te_factor).ceil() as u64
}

/// Total estimated credits across all chunks. Chunks are equal-sized except the
/// last; we approximate by costing each full chunk + a partial last chunk.
pub fn est_credits(combos: u64, ceiling: usize, target_error: f64) -> u64 {
    let chunks = chunk_count(combos, ceiling);
    if chunks == 0 {
        return 0;
    }
    let full = chunks.saturating_sub(1);
    let last_ps = combos - full * ceiling as u64;
    let full_runtime = est_chunk_runtime_seconds(ceiling as u64, target_error);
    let last_runtime = est_chunk_runtime_seconds(last_ps, target_error);
    let total_runtime = full * full_runtime + last_runtime;
    total_runtime.saturating_mul(CREDITS_PER_RUNTIME_SECOND)
}

/// Fetch available credits for the given provider. Uses the provider's
/// `test_credential` path via its `ProviderAuth` (bearer token). Returns
/// `Ok(None)` for local or unconfigured providers (no credits concept).
async fn fetch_available_credits(
    provider: &Arc<dyn crate::compute::SimcProvider>,
    avail: &crate::compute::ProviderAvailability,
) -> Result<Option<u64>, String> {
    use crate::compute::ProviderAuth;
    use secrecy::ExposeSecret;

    let auth = avail.auth_for(provider.id());
    let bearer = match &auth {
        ProviderAuth::BearerToken(s) => s.expose_secret().to_string(),
        ProviderAuth::None => return Ok(None),
    };
    let result = provider.test_credential(&bearer).await?;
    Ok(result.credits_available)
}

fn normalized_talent_builds(
    talent_builds: &[super::types::TalentBuild],
) -> Vec<(String, String)> {
    talent_builds
        .iter()
        .map(|tb| {
            let normalized = crate::talent_normalize::normalize_simc_talents(&format!(
                "talents={}",
                tb.talent_string
            ));
            let ts = normalized
                .strip_prefix("talents=")
                .unwrap_or(&tb.talent_string)
                .to_string();
            (tb.name.clone(), ts)
        })
        .collect()
}

pub(super) async fn cloud_estimate_top_gear(
    http_req: HttpRequest,
    req: web::Json<TopGearRequest>,
    settings_repo: web::Data<SettingsRepo>,
    registry: web::Data<Arc<ProviderRegistry>>,
    _simc_bins: web::Data<Arc<SimcBinaries>>,
    _repo: web::Data<JobRepo>,
) -> HttpResponse {
    // ── 1. Resolve gear + count combos (count-only; mirrors get_top_gear_combo_count) ──
    let raw_input = if req.max_upgrade {
        game_data::upgrade_simc_input(&req.simc_input)
    } else {
        req.simc_input.clone()
    };
    let simc_input =
        preprocess_simc_input(&raw_input, &req.options.talents, &req.options.spec_override);

    let parse_result = addon_parser::parse_simc_input(&simc_input);
    let currency_id = crate::item_db::catalyst_currency_id();
    let catalyst_charges = req
        .catalyst_charges
        .or_else(|| crate::addon_parser::parse_catalyst_charges(&req.simc_input, currency_id));

    let mut resolved = if req.catalyst || catalyst_charges.is_some() {
        gear_resolver::resolve_gear_with_catalyst(&parse_result, catalyst_charges)
    } else {
        gear_resolver::resolve_gear(&parse_result)
    };
    if req.void_forge {
        gear_resolver::generate_void_forge_alternatives(&mut resolved.slots);
    }
    let base_profile = resolved.base_profile.clone();

    let mut items_by_slot = if let Some(ref ibs) = req.items_by_slot {
        ibs.clone()
    } else {
        super::helpers::resolve_to_items_by_slot(&resolved)
    };
    if req.max_upgrade {
        items_by_slot = game_data::upgrade_items_by_slot(&items_by_slot);
    }
    if req.copy_enchants {
        items_by_slot = game_data::apply_copy_enchants(&items_by_slot);
    }

    let talent_builds = normalized_talent_builds(&req.talent_builds);
    let max_combinations = capped_max_combinations(req.max_combinations);
    let socketed_ids = socketed_item_ids(&resolved);
    let gem_opts = profileset_generator::GemEnchantOptions {
        enchant_selections: Some(&req.enchant_selections),
        gem_options: &req.gem_options,
        socketed_item_ids: Some(&socketed_ids),
        replace_gems: req.replace_gems,
        diamond_always_use: req.diamond_always_use,
        max_colors: req.max_colors,
    };

    let combos = match profileset_generator::count_top_gear_combos_with_talents(
        &base_profile,
        &items_by_slot,
        &req.selected_items,
        max_combinations,
        &talent_builds,
        catalyst_charges,
        &gem_opts,
    ) {
        Ok(n) => n as u64,
        Err(e) => {
            return HttpResponse::Ok().json(json!({
                "combos": 0,
                "chunks": 0,
                "est_credits": 0,
                "available_credits": serde_json::Value::Null,
                "affordable": false,
                "ceiling": REMOTE_MAX_PROFILESETS_PER_JOB,
                "would_stream": false,
                "error": e,
            }));
        }
    };

    // ── 2. Chunk math ─────────────────────────────────────────────────────────
    let ceiling = REMOTE_MAX_PROFILESETS_PER_JOB;
    let chunks = chunk_count(combos, ceiling);
    let target_error = req.options.target_error;
    let estimated_credits = est_credits(combos, ceiling, target_error);

    // ── 3. Resolve provider + fetch available credits ─────────────────────────
    let (provider, avail) = match resolve_provider_for_request(
        "top_gear",
        req.options.compute_provider.as_deref(),
        WorkloadEstimate {
            combo_count: combos as usize,
            would_use_streaming_path: true, // cloud-estimate is always for streaming-sized
        },
        http_req.headers(),
        settings_repo.get_ref(),
        registry.get_ref(),
    )
    .await
    {
        Ok(t) => t,
        Err(resp) => return resp,
    };

    // Credit-fetch errors are non-fatal — treat as unknown (None).
    let available_credits = fetch_available_credits(&provider, &avail).await.unwrap_or_default();

    let affordable = available_credits
        .map(|a| estimated_credits <= a)
        .unwrap_or(true); // unknown → assume affordable (user sees est + available)

    // ── 4. Return response — NEVER reserves anything, NEVER starts a job ──────
    HttpResponse::Ok().json(json!({
        "combos": combos,
        "chunks": chunks,
        "est_credits": estimated_credits,
        "available_credits": available_credits,
        "affordable": affordable,
        "ceiling": ceiling,
        // True iff this workload takes the chunked cloud-streaming path (combos ≥
        // the triage threshold). Below it, an explicit cloud run is a single eager
        // Simmit job, so the chunk/credit model here doesn't describe it — the FE
        // gates the chunked estimate display on this flag.
        "would_stream": combos >= crate::profileset_generator::triage::TRIAGE_THRESHOLD,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_count_ceils() {
        assert_eq!(chunk_count(0, 5000), 0);
        assert_eq!(chunk_count(1, 5000), 1);
        assert_eq!(chunk_count(5000, 5000), 1);
        assert_eq!(chunk_count(5001, 5000), 2);
        assert_eq!(chunk_count(12345, 5000), 3);
    }

    #[test]
    fn chunk_count_uses_actual_ceiling() {
        // Verify the real REMOTE_MAX_PROFILESETS_PER_JOB constant (2000) behaves correctly.
        assert_eq!(chunk_count(2000, REMOTE_MAX_PROFILESETS_PER_JOB), 1);
        assert_eq!(chunk_count(2001, REMOTE_MAX_PROFILESETS_PER_JOB), 2);
        assert_eq!(chunk_count(4000, REMOTE_MAX_PROFILESETS_PER_JOB), 2);
        assert_eq!(chunk_count(4001, REMOTE_MAX_PROFILESETS_PER_JOB), 3);
    }

    #[test]
    fn runtime_grows_with_profilesets_and_precision() {
        let a = est_chunk_runtime_seconds(1000, 0.1);
        let b = est_chunk_runtime_seconds(5000, 0.1);
        assert!(b > a, "more profilesets => more runtime");
        let c = est_chunk_runtime_seconds(5000, 0.05);
        assert!(c > b, "tighter target_error => more runtime");
    }

    #[test]
    fn runtime_clamps_target_error_extremes() {
        // Very tight te (< 0.01) should not blow up; very loose (> 0.5) saturates at 0.5 factor.
        let tight = est_chunk_runtime_seconds(1000, 0.001);
        let loose = est_chunk_runtime_seconds(1000, 1.0);
        // Both should return reasonable (> 0) values.
        assert!(tight > 0);
        assert!(loose > 0);
        // Tight should cost more than loose.
        assert!(tight > loose);
    }

    #[test]
    fn credits_scale_with_chunks() {
        let one = est_credits(5000, 5000, 0.1);
        let two = est_credits(10000, 5000, 0.1);
        assert!(two > one);
        assert_eq!(est_credits(0, 5000, 0.1), 0);
    }

    #[test]
    fn credits_single_chunk_exact_ceiling() {
        // Exactly one chunk: combos == ceiling → 1 chunk, billed as "last".
        let combos = 2000u64;
        let ceiling = 2000usize;
        let credits = est_credits(combos, ceiling, 0.1);
        // Should equal est_chunk_runtime_seconds(2000, 0.1) × 32.
        let expected = est_chunk_runtime_seconds(2000, 0.1) * CREDITS_PER_RUNTIME_SECOND;
        assert_eq!(credits, expected);
    }

    #[test]
    fn credits_two_chunks_full_plus_partial() {
        // 3000 combos at ceiling 2000 → 2 chunks: full (2000) + last (1000).
        let combos = 3000u64;
        let ceiling = 2000usize;
        let credits = est_credits(combos, ceiling, 0.1);
        let full_rt = est_chunk_runtime_seconds(2000, 0.1);
        let last_rt = est_chunk_runtime_seconds(1000, 0.1);
        let expected = (full_rt + last_rt) * CREDITS_PER_RUNTIME_SECOND;
        assert_eq!(credits, expected);
    }
}
