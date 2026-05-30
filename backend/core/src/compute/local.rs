use crate::cancel::CancelToken;
use crate::compute::provider::{
    ProviderCaps, RunCtx, RunError, SimcOutput, SimcProvider, StagedExecutionContext,
};
use crate::server::SimcBinaries;
use crate::simc_runner;
use async_trait::async_trait;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// Local sims share one SimC binary on one machine, so they must run
/// sequentially or each one starves the others of CPU. The shared semaphore
/// has exactly one permit: hold it while a sim is running, release on drop.
///
/// Streaming Top Gear acquires from the same semaphore at the top of its
/// pipeline so triage + handoff are serialized with eager sims too.
pub type LocalSimQueue = Arc<Semaphore>;

pub fn new_local_sim_queue() -> LocalSimQueue {
    Arc::new(Semaphore::new(1))
}

/// Wait for the next available permit on the local sim queue, polling the
/// cancel token every 500ms so a queued job can be aborted before it ever
/// runs. Callers that want to surface a "Queued" status to the user should
/// emit it before invoking this — the helper is silent.
pub(crate) async fn await_local_queue_permit(
    queue: &LocalSimQueue,
    cancel: Option<&CancelToken>,
) -> Result<OwnedSemaphorePermit, RunError> {
    loop {
        if let Some(tok) = cancel {
            if tok.is_cancelled().await {
                return Err(RunError::Cancelled);
            }
        }
        let acquire = queue.clone().acquire_owned();
        let timeout = tokio::time::sleep(std::time::Duration::from_millis(500));
        tokio::select! {
            p = acquire => {
                return p.map_err(|_| RunError::Other("local queue closed".into()));
            }
            _ = timeout => continue,
        }
    }
}

pub struct LocalSimcProvider {
    simc_bins: Arc<SimcBinaries>,
    /// `Some` on web (sqlx-backed JobRepo), `None` on desktop (memory backend).
    /// Threaded through to `run_simc_staged` for pause-resume checkpoint writes.
    pool: Option<sqlx::AnyPool>,
    queue: LocalSimQueue,
}

impl LocalSimcProvider {
    pub fn new(
        simc_bins: Arc<SimcBinaries>,
        pool: Option<sqlx::AnyPool>,
        queue: LocalSimQueue,
    ) -> Self {
        Self {
            simc_bins,
            pool,
            queue,
        }
    }

    fn resolve_path(&self, opts: &Value) -> Result<std::path::PathBuf, RunError> {
        let branch = opts.get("simc_branch").and_then(|v| v.as_str()).unwrap_or("");
        self.simc_bins.resolve(branch).map_err(RunError::Other)
    }

    async fn acquire_queue_permit(
        &self,
        ctx: &RunCtx<'_>,
    ) -> Result<OwnedSemaphorePermit, RunError> {
        if let Ok(permit) = self.queue.clone().try_acquire_owned() {
            return Ok(permit);
        }
        (ctx.on_progress)(0, "Queued", "waiting for active local sim to finish");
        await_local_queue_permit(&self.queue, ctx.cancel.as_ref()).await
    }
}

#[async_trait]
impl SimcProvider for LocalSimcProvider {
    fn id(&self) -> &'static str { "local" }
    fn display_name(&self) -> &'static str { "Local SimC" }
    fn capabilities(&self) -> ProviderCaps {
        ProviderCaps {
            cancel: true,
            pause: true,
            streaming_logs: true,
            server_side_multistage: false,
            cloud_streaming: false,
        }
    }

    async fn run_quick(
        &self,
        ctx: RunCtx<'_>,
        input: &str,
        opts: &Value,
    ) -> Result<SimcOutput, RunError> {
        let _ = ctx.auth;
        let path = self.resolve_path(opts)?;
        let _permit = self.acquire_queue_permit(&ctx).await?;
        let on_log = ctx.on_log;
        simc_runner::run_simc(&path, ctx.job_id, input, opts, move |line| on_log(line), ctx.cancel)
            .await
            .map_err(RunError::from)
    }

    async fn run_with_profilesets(
        &self,
        ctx: RunCtx<'_>,
        input: &str,
        opts: &Value,
        combo_count: usize,
        staged_ctx: StagedExecutionContext,
    ) -> Result<SimcOutput, RunError> {
        let _ = ctx.auth;
        let path = self.resolve_path(opts)?;
        let _permit = self.acquire_queue_permit(&ctx).await?;
        let on_progress = ctx.on_progress;
        let on_stage_complete = ctx.on_stage_complete;
        let on_log = ctx.on_log;

        let result = simc_runner::run_simc_staged(
            &path,
            ctx.job_id,
            input,
            opts,
            combo_count,
            staged_ctx.base_start,
            staged_ctx.simc_input_mode,
            self.pool.clone(),
            staged_ctx.resume_state,
            staged_ctx.triage_constants,
            move |pct, lbl, sub| on_progress(pct, lbl, sub),
            move |stage| on_stage_complete(stage),
            move |line| on_log(line),
            ctx.cancel,
        )
        .await;

        match result {
            Ok(output) => Ok(output),
            Err(simc_runner::StagedRunError::Paused) => Err(RunError::Paused),
            Err(simc_runner::StagedRunError::Other(s)) if s == simc_runner::CANCEL_ERR => {
                Err(RunError::Cancelled)
            }
            Err(simc_runner::StagedRunError::Other(s)) => Err(RunError::Other(s)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn empty_bins() -> Arc<SimcBinaries> {
        Arc::new(SimcBinaries::from_dir(&PathBuf::from("/nonexistent")))
    }

    #[test]
    fn local_provider_caps_are_full() {
        let p = LocalSimcProvider::new(empty_bins(), None, new_local_sim_queue());
        let caps = p.capabilities();
        assert!(caps.cancel);
        assert!(caps.pause);
        assert!(caps.streaming_logs);
        assert!(!caps.server_side_multistage);
        assert!(!caps.cloud_streaming);
        assert_eq!(p.id(), "local");
    }

    #[tokio::test]
    async fn queue_serializes_acquisitions() {
        let q = new_local_sim_queue();
        let p1 = q.clone().try_acquire_owned().expect("first permit available");
        // Second try-acquire fails while first is held.
        assert!(q.clone().try_acquire_owned().is_err());
        drop(p1);
        // After drop, second can acquire.
        assert!(q.clone().try_acquire_owned().is_ok());
    }

    #[tokio::test]
    async fn staged_permit_transfer_serializes_against_new_acquire() {
        // Models Task 1: a transferred/held permit must keep a second waiter
        // out until it is dropped (mirrors what the provider path guarantees).
        let q = new_local_sim_queue();
        let held = q
            .clone()
            .try_acquire_owned()
            .expect("first permit available");

        // A concurrent waiter using the production wait helper must not get in.
        let q2 = q.clone();
        let waiter = tokio::spawn(async move { await_local_queue_permit(&q2, None).await });

        // Give the waiter time to poll at least once (its loop sleeps 500ms).
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(!waiter.is_finished(), "waiter must block while permit held");

        drop(held);
        let got = waiter.await.expect("join ok");
        assert!(got.is_ok(), "waiter acquires after held permit drops");
    }

    #[tokio::test]
    async fn permit_blocks_then_releases_for_next_staged_run() {
        // Models Task C: routing staged runs through run_with_profilesets means
        // exactly one permit gates them. While held, a second waiter blocks;
        // after drop, it proceeds. (run_with_profilesets acquires/holds/drops
        // this same permit internally.)
        let q = new_local_sim_queue();
        let held = q.clone().try_acquire_owned().expect("first permit available");

        let q2 = q.clone();
        let waiter = tokio::spawn(async move { await_local_queue_permit(&q2, None).await });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(!waiter.is_finished(), "waiter must block while a staged run holds the permit");

        drop(held);
        let got = waiter.await.expect("join ok");
        assert!(got.is_ok(), "next staged run acquires after the prior one releases");
    }
}
