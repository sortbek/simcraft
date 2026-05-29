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
}

/// Result of probing a provider credential (the Settings "Test connection" button).
pub struct CredentialTest {
    /// Credits / quota remaining, if the provider reports one. Display-only.
    pub credits_available: Option<u64>,
}
