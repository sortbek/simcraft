use crate::compute::provider::{
    ProviderCaps, RunCtx, RunError, SimcOutput, SimcProvider,
};
use crate::server::SimcBinaries;
use crate::simc_runner;
use async_trait::async_trait;
use serde_json::Value;
use std::sync::Arc;

pub struct LocalSimcProvider {
    simc_bins: Arc<SimcBinaries>,
}

impl LocalSimcProvider {
    pub fn new(simc_bins: Arc<SimcBinaries>) -> Self {
        Self { simc_bins }
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
        _ctx: RunCtx<'_>,
        _input: &str,
        _opts: &Value,
        _combo_count: usize,
    ) -> Result<SimcOutput, RunError> {
        Err(RunError::Other(
            "LocalSimcProvider::run_with_profilesets not wired in Phase 1; call simc_runner::run_simc_staged directly".into(),
        ))
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
        let p = LocalSimcProvider::new(empty_bins());
        let caps = p.capabilities();
        assert!(caps.cancel);
        assert!(caps.pause);
        assert!(caps.streaming_logs);
        assert!(!caps.server_side_multistage);
        assert_eq!(p.id(), "local");
    }
}
