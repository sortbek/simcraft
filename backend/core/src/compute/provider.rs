use async_trait::async_trait;
use secrecy::SecretString;
use serde_json::Value;
use std::sync::Arc;

pub use crate::simc_runner::SimcOutput;

#[derive(Clone)]
pub enum ProviderAuth {
    None,
    BearerToken(SecretString),
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct ProviderCaps {
    pub cancel: bool,
    pub pause: bool,
    pub streaming_logs: bool,
    pub server_side_multistage: bool,
    /// Coarse routing/menu flag: can this provider run a streaming-sized job
    /// via the cloud-chunking orchestrator? `false` for local (local uses the
    /// triage path). Per-RUN pause/cancel come from `effective_capabilities`,
    /// not this static flag.
    pub cloud_streaming: bool,
}

/// Callbacks passed through the `SimcProvider` trait. Arc-wrapped so providers
/// can clone them into the multiple sub-tasks `run_simc_staged` requires
/// (`on_log` needs `Clone`; we make the others Clone too for symmetry).
pub struct RunCtx<'a> {
    pub job_id: &'a str,
    pub on_progress: Arc<dyn Fn(u8, &str, &str) + Send + Sync + 'a>,
    pub on_stage_complete: Arc<dyn Fn(&str) + Send + Sync + 'a>,
    pub on_log: Arc<dyn Fn(&str) + Send + Sync + 'a>,
    pub cancel: Option<crate::cancel::CancelToken>,
    pub auth: ProviderAuth,
}

/// Profileset-specific execution context (irrelevant for `run_quick`).
/// Local providers wire these into `simc_runner::run_simc_staged`.
/// Server-side-multistage providers (Simmit) ignore everything.
#[derive(Default, Clone)]
pub struct StagedExecutionContext {
    pub base_start: u8,
    pub simc_input_mode: crate::models::SimcInputMode,
    pub resume_state: crate::simc_runner::StagedResumeState,
    pub triage_constants: crate::profileset_generator::triage::TriageConstants,
}

#[derive(Debug)]
pub enum RunError {
    Cancelled,
    /// User-requested pause hit a checkpoint (local-staged only). Caller
    /// must NOT write an error message — `simc_runner` already set the job
    /// status to `Paused` before returning.
    Paused,
    Other(String),
}

impl From<String> for RunError {
    fn from(s: String) -> Self { Self::Other(s) }
}
impl From<&str> for RunError {
    fn from(s: &str) -> Self { Self::Other(s.to_string()) }
}
impl std::fmt::Display for RunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Cancelled => f.write_str("cancelled"),
            Self::Paused => f.write_str("paused_by_user"),
            Self::Other(s) => f.write_str(s),
        }
    }
}

#[derive(Debug, Clone)]
pub enum ProviderError {
    UnknownProvider(String),
    UnconfiguredProvider(String),
    StreamingTooLargeForRemote,
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownProvider(id) => write!(f, "unknown provider '{}'", id),
            Self::UnconfiguredProvider(id) => write!(f, "provider '{}' is not configured", id),
            Self::StreamingTooLargeForRemote => {
                f.write_str("this workload is too large for cloud submission — use Local SimC or reduce selections")
            }
        }
    }
}

#[async_trait]
pub trait SimcProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    fn capabilities(&self) -> ProviderCaps;

    async fn run_quick(
        &self,
        ctx: RunCtx<'_>,
        input: &str,
        opts: &Value,
    ) -> Result<SimcOutput, RunError>;

    async fn run_with_profilesets(
        &self,
        ctx: RunCtx<'_>,
        input: &str,
        opts: &Value,
        combo_count: usize,
        staged_ctx: StagedExecutionContext,
    ) -> Result<SimcOutput, RunError>;

    /// Probe a credential against the provider's usage/health endpoint.
    /// Default (suitable for `local`): success with no credits info.
    /// Remote providers override to hit their own endpoint.
    async fn test_credential(&self, _api_key: &str) -> Result<CredentialTest, String> {
        Ok(CredentialTest { credits_available: None })
    }

    /// Fetch per-account runtime/concurrency limits. Default: unknown (no
    /// limits reported). Remote providers override.
    async fn get_usage(&self, _auth: &ProviderAuth) -> Result<ProviderUsage, String> {
        Ok(ProviderUsage::default())
    }

    /// Submit ONE chunk of profilesets and return the provider's remote job id
    /// immediately (before it runs), so the cloud-streaming orchestrator can
    /// persist it to `cloud_chunks.remote_job_id` for resume re-polling. Pair
    /// with [`poll_and_fetch_chunk`](Self::poll_and_fetch_chunk).
    ///
    /// Default: the provider does not support cloud chunk streaming. Providers
    /// that drive the cloud-streaming orchestrator (e.g. Simmit) override this.
    async fn submit_chunk_for_id(
        &self,
        _auth: &ProviderAuth,
        _job_id: &str,
        _idempotency_key: &str,
        _input: &str,
    ) -> Result<String, RunError> {
        Err(RunError::Other(
            "provider does not support cloud chunk streaming".into(),
        ))
    }

    /// Poll an already-submitted remote chunk to terminal and fetch its result,
    /// adapted to the SimC-shaped [`SimcOutput`]. Used both for the live submit
    /// path and for resume re-polling.
    ///
    /// Default: the provider does not support cloud chunk streaming. Providers
    /// that drive the cloud-streaming orchestrator (e.g. Simmit) override this.
    async fn poll_and_fetch_chunk(
        &self,
        _ctx: RunCtx<'_>,
        _remote_job_id: &str,
    ) -> Result<SimcOutput, RunError> {
        Err(RunError::Other(
            "provider does not support cloud chunk streaming".into(),
        ))
    }
}

/// Result of probing a provider credential (the Settings "Test connection" button).
pub struct CredentialTest {
    /// Credits / quota remaining, if the provider reports one. Display-only.
    pub credits_available: Option<u64>,
}

/// Per-account runtime/concurrency limits, from `GET /v1/simc/usage`. The
/// orchestrator uses `max_active_jobs` to bound in-flight chunk submissions and
/// `max_runtime_seconds` to inform the chunk ceiling / estimate.
#[derive(Debug, Clone, Copy, Default)]
pub struct ProviderUsage {
    pub max_runtime_seconds: Option<u32>,
    pub max_active_jobs: Option<u32>,
}
