use actix_web::{web, HttpResponse};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use super::helpers::{finalize_local_stage_result, validate_batch};
use super::request_json::NormalizedRequest;
use super::types::TopGearRequest;
use super::SimcBinaries;
use crate::db::JobRepo;
use crate::log_buffer::LogBuffer;
use crate::models::{Job, SimcInputMode};
use crate::profileset_generator;
use crate::simc_runner;

pub(super) struct StreamingTopGearStart {
    pub req: web::Json<TopGearRequest>,
    pub repo: web::Data<JobRepo>,
    /// The local SimC binary registry. Resolved to a concrete binary path only
    /// on the LOCAL streaming branch (after the cloud-vs-local fork) so a
    /// cloud-only deploy with no local SimC installed can still run a streaming
    /// Top Gear via the cloud orchestrator (which never touches a local binary).
    pub simc_bins: Arc<SimcBinaries>,
    pub log_buffer: web::Data<Arc<LogBuffer>>,
    pub base_profile: String,
    pub items_by_slot: HashMap<String, Vec<Value>>,
    pub talent_builds: Vec<(String, String)>,
    pub socketed_ids: HashSet<u64>,
    pub catalyst_charges: Option<u32>,
    pub max_combinations: Option<usize>,
    pub estimate: u64,
    /// Exact combo count computed once in `create_top_gear_sim` by
    /// `count_top_gear_combos_with_talents`. Threaded into the cloud path so
    /// `start_cloud_streaming` can use it directly for credit reservation and
    /// the `CloudProgress` denominator without re-counting.
    pub exact_combos: u64,
    pub provider_id: String,
    /// The resolved compute provider for this request. Local ⇒ existing triage
    /// path; a cloud-streaming-capable remote (e.g. Simmit) ⇒ the cloud
    /// orchestrator (`cloud_streaming::start_cloud_streaming`).
    pub provider: Arc<dyn crate::compute::SimcProvider>,
    /// Auth derived from settings/headers for `provider` (`avail.auth_for`).
    pub provider_auth: crate::compute::ProviderAuth,
    pub local_queue: crate::compute::local::LocalSimQueue,
    pub local_provider: Arc<dyn crate::compute::SimcProvider>,
}

/// Branch-selection predicate for the streaming Top Gear handler: a resolved
/// provider routes to the cloud orchestrator iff it advertises cloud-streaming
/// AND is not the local provider. `pick_provider` (routing) already guarantees a
/// streaming-sized + explicit-cloud request resolves to such a provider; this is
/// the live dispatch gate. Pure (no I/O) so it is unit-testable.
pub(super) fn use_cloud_streaming(
    provider: &Arc<dyn crate::compute::SimcProvider>,
) -> bool {
    provider.capabilities().cloud_streaming && provider.id() != "local"
}

/// Full streaming triage path.
///
/// Creates a streamed job, inserts it, then spawns the background triage and
/// staged pipeline. HTTP handlers should stay thin and delegate here once they
/// have decided that a Top Gear request needs streaming.
pub(super) async fn start_streaming_top_gear_job(start: StreamingTopGearStart) -> HttpResponse {
    // ── Provider branch ──────────────────────────────────────────────────────
    // A cloud-streaming-capable remote (resolved by `pick_provider` for an
    // explicit cloud + streaming-sized request) runs through the chunk
    // orchestrator on the remote (e.g. Simmit). Everything else (local) takes
    // the existing local triage path below, unchanged.
    if use_cloud_streaming(&start.provider) {
        return super::cloud_streaming::start_cloud_streaming(start).await;
    }

    let StreamingTopGearStart {
        req,
        repo,
        simc_bins,
        log_buffer,
        base_profile,
        items_by_slot,
        talent_builds,
        socketed_ids,
        catalyst_charges,
        max_combinations,
        estimate,
        exact_combos: _,
        provider_id,
        provider: _provider,
        provider_auth: _provider_auth,
        local_queue,
        local_provider: _local_provider,
    } = start;

    // Resolve the local SimC binary ONLY here, on the local branch — the cloud
    // branch above returned already and never needs a local binary. A bad branch
    // on a genuine local run still surfaces as a 400 to the user.
    let simc = match simc_bins.resolve(&req.options.simc_branch) {
        Ok(path) => path,
        Err(e) => return HttpResponse::BadRequest().json(json!({ "detail": e })),
    };

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

    if let Some(resp) = validate_batch(&req.options.batch_id, repo.get_ref()).await {
        return resp;
    }

    let options_json = req.options.to_json();
    let display_input = simc_runner::build_simc_input_from_options(&base_profile, &options_json);

    let mut job = Job::new_with_provider(
        display_input,
        "top_gear".to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
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

    if let Err(e) = repo.insert(&job).await {
        return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}));
    }

    let repo_for_task = repo.get_ref().clone();
    let simc_bin_for_task = simc.clone();
    let job_id_task = job_id.clone();
    let fight_style = job.fight_style.clone();
    let options_for_task = options_json.clone();
    let base_profile_owned = base_profile.clone();
    let log_buffer_owned = log_buffer.get_ref().clone();

    let queue_for_task = local_queue.clone();
    let repo_for_queue_wait = repo_for_task.clone();
    let jid_for_queue_wait = job_id_task.clone();
    tokio::spawn(async move {
        // Streaming Top Gear shares the local sim queue with eager local jobs.
        // Hold a permit for the duration of TRIAGE so we don't fight a Quick Sim
        // for the CPU. The permit is then released before the staged handoff (the
        // provider re-acquires it for the staged phase — see the `drop(permit)` on
        // the Completed arm below). This opens a brief queue gap at the
        // triage→staged boundary, accepted to avoid deadlocking the single-permit
        // queue; the two phases are no longer one contiguous reservation.
        let permit = if let Ok(p) = queue_for_task.clone().try_acquire_owned() {
            p
        } else {
            let _ = repo_for_queue_wait
                .update_progress(&jid_for_queue_wait, 0, "Queued", "waiting for active local sim to finish")
                .await;
            let cancel_tok = crate::cancel::CancelToken::new(
                repo_for_queue_wait.clone(),
                jid_for_queue_wait.clone(),
            );
            match crate::compute::local::await_local_queue_permit(
                &queue_for_task,
                Some(&cancel_tok),
            )
            .await
            {
                Ok(p) => p,
                Err(_) => return,
            }
        };

        // Flip status to Running so the UI shows the Pause affordance and the
        // pause endpoint accepts requests during Triage. Without this the job
        // sits at Pending throughout triage and pause is unreachable.
        if let Err(e) = repo_for_task
            .update_status(&job_id_task, crate::models::JobStatus::Running)
            .await
        {
            eprintln!("[{}] Failed to set Running status: {}", job_id_task, e);
        }

        let repo_progress = repo_for_task.clone();
        let jid_progress = job_id_task.clone();

        let on_progress = move |pct: u8, detail: String| {
            let mapped: u8 = 5u8.saturating_add(((pct as f64) * 0.90) as u8);
            let r = repo_progress.clone();
            let i = jid_progress.clone();
            tokio::spawn(async move {
                let _ = r.update_progress(&i, mapped, "Staging", &detail).await;
            });
        };

        let Some(pool) = repo_for_task.pool().cloned() else {
            let _ = repo_for_task
                .set_error(&job_id_task, "Streaming path requires SQLite storage")
                .await;
            return;
        };

        let stage_inputs = crate::profileset_generator::stage_pipeline::StagePipelineInputs {
            pool: &pool,
            job_id: &job_id_task,
            simc_bin: &simc_bin_for_task,
            fight_style: &fight_style,
            options: &options_for_task,
            base_profile: &base_profile_owned,
            log_buffer: log_buffer_owned.clone(),
            simc_input_mode: SimcInputMode::Streamed,
            on_progress: Box::new(on_progress),
            on_stage_complete: Box::new({
                let repo = repo_for_task.clone();
                let jid = job_id_task.clone();
                move |summary| {
                    let r = repo.clone();
                    let i = jid.clone();
                    tokio::spawn(async move {
                        let _ = r.update_progress(&i, 90, "Staging", &summary).await;
                    });
                }
            }),
        };

        let plan = crate::profileset_generator::stage_pipeline::default_local_topgear_plan(
            &options_for_task,
        );
        match crate::profileset_generator::stage_pipeline::run_stage_pipeline(
            iter_cfg,
            stage_inputs,
            plan,
            None,
        )
        .await
        {
            Ok(crate::profileset_generator::stage_pipeline::StagePipelineOutcome::Completed(
                result,
            )) => {
                // Release the triage permit so the provider-driven staged run
                // can acquire it itself (single-permit queue → holding it here
                // while the provider re-acquires would deadlock).
                drop(permit);
                finalize_local_stage_result(
                    &repo_for_task,
                    &job_id_task,
                    &base_profile_owned,
                    &result.output.json,
                    &log_buffer_owned,
                )
                .await;
            }
            Ok(crate::profileset_generator::stage_pipeline::StagePipelineOutcome::Paused) => {}
            Err(e) => {
                let _ = repo_for_task.set_error(&job_id_task, &e).await;
                log_buffer_owned.remove(&job_id_task);
            }
        }
    });

    HttpResponse::Ok().json(json!({
        "id": job_id,
        "status": "pending",
        "created_at": created_at,
        "estimate": estimate,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simmit_provider_routes_to_cloud_streaming() {
        // A cloud-streaming-capable, non-local provider takes the cloud branch.
        let provider: Arc<dyn crate::compute::SimcProvider> =
            Arc::new(crate::compute::simmit::SimmitProvider::new(reqwest::Client::new()));
        assert!(use_cloud_streaming(&provider));
    }

    #[test]
    fn local_provider_stays_on_triage_path() {
        // A provider that does not advertise cloud-streaming (or is the local
        // provider) stays on the local triage path.
        struct NonCloud;
        #[async_trait::async_trait]
        impl crate::compute::SimcProvider for NonCloud {
            fn id(&self) -> &'static str {
                "local"
            }
            fn display_name(&self) -> &'static str {
                "Local"
            }
            fn capabilities(&self) -> crate::compute::ProviderCaps {
                crate::compute::ProviderCaps {
                    cancel: true,
                    pause: true,
                    streaming_logs: true,
                    server_side_multistage: false,
                    cloud_streaming: false,
                }
            }
            async fn run_quick(
                &self,
                _ctx: crate::compute::RunCtx<'_>,
                _input: &str,
                _opts: &Value,
            ) -> Result<crate::simc_runner::SimcOutput, crate::compute::RunError> {
                unreachable!()
            }
            async fn run_with_profilesets(
                &self,
                _ctx: crate::compute::RunCtx<'_>,
                _input: &str,
                _opts: &Value,
                _combo_count: usize,
                _staged_ctx: crate::compute::StagedExecutionContext,
            ) -> Result<crate::simc_runner::SimcOutput, crate::compute::RunError> {
                unreachable!()
            }
        }
        let provider: Arc<dyn crate::compute::SimcProvider> = Arc::new(NonCloud);
        assert!(!use_cloud_streaming(&provider));
    }
}
