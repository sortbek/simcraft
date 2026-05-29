use crate::compute::provider::{
    ProviderAuth, ProviderCaps, RunCtx, RunError, SimcOutput, SimcProvider,
};
use async_trait::async_trait;
use serde_json::Value;

pub struct SimmitProvider {
    http: reqwest::Client,
}

impl SimmitProvider {
    pub fn new(http: reqwest::Client) -> Self {
        Self { http }
    }
}

#[async_trait]
impl SimcProvider for SimmitProvider {
    fn id(&self) -> &'static str { "simmit" }
    fn display_name(&self) -> &'static str { "Simmit Cloud" }
    fn capabilities(&self) -> ProviderCaps {
        ProviderCaps {
            cancel: true,
            pause: false,
            streaming_logs: true,
            server_side_multistage: true,
        }
    }
    async fn run_quick(&self, _ctx: RunCtx<'_>, _input: &str, _opts: &Value) -> Result<SimcOutput, RunError> {
        let _ = &self.http;
        let _ = ProviderAuth::None; // Silence dead-code warning until Phase 2.
        Err(RunError::Other("SimmitProvider not yet implemented".into()))
    }
    async fn run_with_profilesets(&self, _ctx: RunCtx<'_>, _input: &str, _opts: &Value, _combo_count: usize) -> Result<SimcOutput, RunError> {
        Err(RunError::Other("SimmitProvider not yet implemented".into()))
    }
}
