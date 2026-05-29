use crate::compute::provider::{
    ProviderCaps, RunCtx, RunError, SimcOutput, SimcProvider,
};
use crate::simc_runner;
use async_trait::async_trait;
use serde_json::Value;
use std::path::PathBuf;

pub struct LocalSimcProvider {
    simc_path: PathBuf,
}

impl LocalSimcProvider {
    pub fn new(simc_path: PathBuf) -> Self {
        Self { simc_path }
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
        let on_log = ctx.on_log;
        simc_runner::run_simc(&self.simc_path, ctx.job_id, input, opts, move |line| on_log(line), ctx.cancel)
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
        // run_simc_staged has a different signature (progress + stage callbacks);
        // the call sites in top_gear / drop_finder etc. still invoke it directly
        // in this phase. Providers gain a generic staged path in a later task,
        // but for now this method exists only so the trait object compiles.
        Err(RunError::Other(
            "LocalSimcProvider::run_with_profilesets not wired in Phase 1; call simc_runner::run_simc_staged directly".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_provider_caps_are_full() {
        let p = LocalSimcProvider::new(PathBuf::from("/nonexistent"));
        let caps = p.capabilities();
        assert!(caps.cancel);
        assert!(caps.pause);
        assert!(caps.streaming_logs);
        assert!(!caps.server_side_multistage);
        assert_eq!(p.id(), "local");
    }
}
