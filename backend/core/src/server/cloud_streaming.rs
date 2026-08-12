//! HTTP entry point for cloud-streamed Top Gear.
//!
//! Thin actix wrapper: build the iterator config, validate + insert the streamed
//! `Job`, then hand off to [`crate::compute::cloud_streaming`], which owns the
//! chunk orchestration. That module depends on `crate::jobs` for persistence and
//! finalization, never on this one — the HTTP shape stops here.

use serde_json::json;

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use crate::cancel::CancelToken;
use crate::compute::cloud_streaming::AffordabilityCheck;
use crate::compute::cloud_streaming::{
    build_production_chunk_runner, CloudProgress, CloudStreamingRun, REMOTE_MAX_PROFILESETS_PER_JOB,
};
use crate::db::CloudChunksRepo;

// ── Fresh-run HTTP wrapper (the live cloud streaming entry point) ─────────────

/// HTTP entry point for a streaming-sized Top Gear that resolved to a
/// cloud-capable remote. Mirrors the LOCAL `start_streaming_top_gear_job`
/// (build iterator config, validate batch, create + insert the streamed Job with
/// the same request_json envelope) but spawns [`CloudStreamingRun::execute`] with
/// the PRODUCTION chunk runner. Returns
/// `{ id, status: "pending", created_at, estimate }`.
pub(super) async fn start_cloud_streaming(
    start: super::streaming_top_gear::StreamingTopGearStart,
) -> actix_web::HttpResponse {
    use crate::jobs::request_json::NormalizedRequest;
    use crate::models::{Job, SimcInputMode};
    use crate::profileset_generator;

    let super::streaming_top_gear::StreamingTopGearStart {
        req,
        repo,
        simc_bins: _simc_bins,
        log_buffer: _log_buffer,
        base_profile,
        items_by_slot,
        talent_builds,
        socketed_ids,
        catalyst_charges,
        max_combinations,
        estimate,
        exact_combos,
        provider_id,
        provider,
        provider_auth,
        local_queue: _local_queue,
        local_provider: _local_provider,
    } = start;

    // Chunk submit/fetch are `SimcProvider` trait methods (default "unsupported"),
    // so the orchestrator drives `Arc<dyn SimcProvider>` directly — no downcast. A
    // provider that doesn't override them fails at the first chunk submit, not here.

    // ── Build the iterator config exactly as the local triage path does. ──────
    let gem_opts = profileset_generator::GemEnchantOptions {
        enchant_selections: Some(&req.enchant_selections),
        gem_options: &req.gem_options,
        socketed_item_ids: Some(&socketed_ids),
        replace_gems: req.replace_gems,
        diamond_always_use: req.diamond_always_use,
        max_colors: req.max_colors,
    };
    let iter_cfg = profileset_generator::build_iterator_config(
        &base_profile,
        &items_by_slot,
        &req.selected_items,
        &talent_builds,
        &gem_opts,
        catalyst_charges,
    );

    if let Some(resp) =
        super::job_spawn::validate_batch(&req.options.batch_id, repo.get_ref()).await
    {
        return resp;
    }

    // ── Create + insert the streamed Job (identical envelope to local). ───────
    let options_json = req.options.to_json();
    let display_input =
        crate::simc_runner::build_simc_input_from_options(&base_profile, &options_json);
    let target_error = req.options.target_error;

    let mut job = Job::new_with_provider(
        display_input,
        "top_gear".to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        target_error,
        provider_id,
    );
    job.simc_input_mode = SimcInputMode::Streamed;
    job.batch_id = req.options.batch_id.clone();

    let envelope = NormalizedRequest::new(
        "top_gear",
        json!({
            "items_by_slot": items_by_slot,
            "selected_items": req.selected_items,
            "enchant_selections": req.enchant_selections,
            "gem_options": req.gem_options,
            "socketed_item_ids": socketed_ids.iter().collect::<Vec<_>>(),
            "replace_gems": req.replace_gems,
            "diamond_always_use": req.diamond_always_use,
            "max_colors": req.max_colors,
            "talent_builds": talent_builds,
            "catalyst_charges": catalyst_charges,
            "spec": req.options.spec_override,
            "base_profile": base_profile,
            "max_combinations": max_combinations,
            "void_forge": req.void_forge,
            "options": req.options.to_json(),
            "streaming": true,
            "estimate": estimate,
        }),
    );
    job.request_json = Some(envelope.to_json_string().unwrap_or_default());

    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    // ── Streaming requires SQLite storage (cloud_chunks + combo_metadata). ────
    let Some(pool) = repo.pool().cloned() else {
        return actix_web::HttpResponse::InternalServerError().json(json!({
            "detail": "Cloud streaming requires SQLite storage"
        }));
    };

    if let Err(e) = repo.insert(&job).await {
        return actix_web::HttpResponse::InternalServerError()
            .json(json!({"detail": e.to_string()}));
    }

    // ── Affordability gate: re-validate the estimate authoritatively at submit. ─
    // `est_credits` from the exact combo count + ceiling + target_error; the check
    // closure fetches available credits via the provider's credential endpoint.
    // `None` auth / no-credits-concept → `Ok(None)` (affordable).
    let ceiling = REMOTE_MAX_PROFILESETS_PER_JOB;
    // Reuse `exact_combos` (already counted in `create_top_gear_sim`) to avoid a
    // second O(total) count and to keep the credit gate + progress denominator
    // matching the figure `cloud_estimate` showed the user.
    let est_credits_needed =
        super::cloud_estimate::est_credits(exact_combos, ceiling, target_error);
    let affordability: Option<AffordabilityCheck> = {
        let provider = provider.clone();
        let auth = provider_auth.clone();
        Some(Arc::new(move || {
            let provider = provider.clone();
            let auth = auth.clone();
            Box::pin(async move {
                use secrecy::ExposeSecret;
                let bearer = match &auth {
                    crate::compute::ProviderAuth::BearerToken(s) => s.expose_secret().to_string(),
                    crate::compute::ProviderAuth::None => return Ok(None),
                };
                provider
                    .test_credential(&bearer)
                    .await
                    .map(|c| c.credits_available)
            }) as Pin<Box<dyn Future<Output = Result<Option<u64>, String>> + Send>>
        }))
    };

    // ── In-flight bound from the account's usage limits (best effort; error /
    // unknown limit falls back to CONFIG_MAX_INFLIGHT). ───────────────────────
    let max_active_jobs = provider
        .get_usage(&provider_auth)
        .await
        .ok()
        .and_then(|u| u.max_active_jobs)
        .map(|n| n as usize);

    // ── Production chunk runner + cancel token; spawn the orchestrator. ───────
    let cloud_repo = CloudChunksRepo::new(pool.clone());
    let cancel = Some(CancelToken::new(repo.get_ref().clone(), job_id.clone()));
    // Job-level progress bar weights each chunk's live percent against
    // `exact_combos` (the deduped count, == iterator's emitted total). The O(axes)
    // upper-bound `estimate` is huge for gem-heavy jobs and would peg the bar near
    // 0%; exact count lets it reach 100%. No extra Simmit calls.
    let progress = CloudProgress::new(
        repo.get_ref().clone(),
        job_id.clone(),
        exact_combos as usize,
    );
    let runner = build_production_chunk_runner(
        provider.clone(),
        cloud_repo,
        provider_auth,
        cancel.clone(),
        Some(progress),
    );

    let run = CloudStreamingRun {
        repo: repo.get_ref().clone(),
        pool,
        iter_cfg,
        base_profile,
        options: options_json.clone(),
        job_id: job_id.clone(),
        sim_type: "top_gear".to_string(),
        ceiling,
        max_active_jobs,
        cancel,
        affordability,
        est_credits_needed,
    };

    // Flip to Running so the UI shows the cancel affordance while chunks submit.
    let _ = repo
        .update_status(&job_id, crate::models::JobStatus::Running)
        .await;

    tokio::spawn(async move {
        run.execute(runner).await;
    });

    actix_web::HttpResponse::Ok().json(json!({
        "id": job_id,
        "status": "pending",
        "created_at": created_at,
        "estimate": estimate,
    }))
}
