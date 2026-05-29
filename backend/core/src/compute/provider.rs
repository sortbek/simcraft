use async_trait::async_trait;
use secrecy::SecretString;
use serde_json::Value;

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

pub struct RunCtx<'a> {
    pub job_id: &'a str,
    pub on_progress: Box<dyn Fn(u8, &str, &str) + Send + Sync + 'a>,
    pub on_log: Box<dyn Fn(&str) + Send + Sync + 'a>,
    pub cancel: Option<crate::cancel::CancelToken>,
    pub auth: ProviderAuth,
}

#[derive(Debug)]
pub enum RunError {
    Cancelled,
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
