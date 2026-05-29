use crate::compute::provider::{
    ProviderCaps, RunCtx, RunError, SimcOutput, SimcProvider, StagedExecutionContext,
};
use crate::server::SimcBinaries;
use crate::simc_runner;
use async_trait::async_trait;
use serde_json::Value;
use std::sync::Arc;

pub struct LocalSimcProvider {
    simc_bins: Arc<SimcBinaries>,
    /// `Some` on web (sqlx-backed JobRepo), `None` on desktop (memory backend).
    /// Threaded through to `run_simc_staged` for pause-resume checkpoint writes.
    pool: Option<sqlx::AnyPool>,
}

impl LocalSimcProvider {
    pub fn new(simc_bins: Arc<SimcBinaries>, pool: Option<sqlx::AnyPool>) -> Self {
        Self { simc_bins, pool }
    }

    fn resolve_path(&self, opts: &Value) -> Result<std::path::PathBuf, RunError> {
        let branch = opts.get("simc_branch").and_then(|v| v.as_str()).unwrap_or("");
        self.simc_bins.resolve(branch).map_err(RunError::Other)
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
        let p = LocalSimcProvider::new(empty_bins(), None);
        let caps = p.capabilities();
        assert!(caps.cancel);
        assert!(caps.pause);
        assert!(caps.streaming_logs);
        assert!(!caps.server_side_multistage);
        assert_eq!(p.id(), "local");
    }
}
