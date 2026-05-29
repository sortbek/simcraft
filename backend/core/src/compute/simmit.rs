use crate::compute::provider::{
    ProviderAuth, ProviderCaps, RunCtx, RunError, SimcOutput, SimcProvider,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
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

/// Lines whose first `=`-prefix matches any of these are stripped before
/// submitting to Simmit. Source: docs.simmit.com /docs/api/input-constraints.
const BLOCKED_PREFIXES: &[&str] = &[
    "threads", "profileset_work_threads", "profileset_init_threads", "process_priority",
    "output", "html", "json", "json2", "log",
    "save", "save_actor_lists", "save_gear", "save_profiles", "save_talent_str",
    "debug_seed", "debug_each", "debug",
    "full_states", "local_json", "proxy", "http_clear_cache", "guild",
    "apiKey", "apikey", "api_key",
    "spell_query_xml_output_file", "reforge_plot_output_file",
    "progressbar_type",
];

const BLOCKED_PREFIX_GLOBS: &[&str] = &["dps_plot_", "reforge_plot_"];

pub fn strip_simmit_blocked_directives(input: &str) -> String {
    input
        .lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            let key = match trimmed.split_once('=') {
                Some((k, _)) => k.trim(),
                None => return true, // not a directive
            };
            if BLOCKED_PREFIXES.iter().any(|b| *b == key) { return false; }
            if BLOCKED_PREFIX_GLOBS.iter().any(|g| key.starts_with(g)) { return false; }
            true
        })
        .collect::<Vec<_>>()
        .join("\n")
}

const SIMMIT_BASE_URL: &str = "https://api.simmit.com";

#[derive(Serialize)]
struct SubmitBuild { channel: &'static str }
#[derive(Serialize)]
struct SubmitProfile<'a> { text: &'a str }
#[derive(Serialize)]
struct SubmitRuntime {
    #[serde(skip_serializing_if = "Option::is_none", rename = "multiStage")]
    multi_stage: Option<bool>,
    #[serde(rename = "maxRuntimeSeconds")]
    max_runtime_seconds: u32,
}
#[derive(Serialize)]
struct SubmitArtifactsJson { version: u8 }
#[derive(Serialize)]
struct SubmitArtifacts { json: SubmitArtifactsJson }
#[derive(Serialize)]
struct SubmitBody<'a> {
    build: SubmitBuild,
    profile: SubmitProfile<'a>,
    runtime: SubmitRuntime,
    artifacts: SubmitArtifacts,
    metadata: std::collections::HashMap<&'static str, String>,
}

#[derive(Deserialize)]
struct SubmitResponse {
    #[serde(default)]
    success: bool,
    id: Option<String>,
    #[serde(default)]
    warnings: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
struct ErrorBody {
    error: Option<String>,
    code: Option<String>,
}

impl SimmitProvider {
    fn bearer(ctx: &RunCtx<'_>) -> Result<String, RunError> {
        use secrecy::ExposeSecret;
        match &ctx.auth {
            ProviderAuth::BearerToken(s) => Ok(s.expose_secret().to_string()),
            ProviderAuth::None => Err(RunError::Other(
                "Simmit requires a configured API key — set it in Settings.".into(),
            )),
        }
    }

    async fn submit(
        &self,
        bearer: &str,
        job_id: &str,
        input: &str,
        enable_multistage: bool,
    ) -> Result<String, RunError> {
        let mut metadata = std::collections::HashMap::new();
        metadata.insert("simhammer_job_id", job_id.to_string());
        let body = SubmitBody {
            build: SubmitBuild { channel: "nightly" },
            profile: SubmitProfile { text: input },
            runtime: SubmitRuntime {
                multi_stage: if enable_multistage { Some(true) } else { None },
                max_runtime_seconds: 1800,
            },
            artifacts: SubmitArtifacts { json: SubmitArtifactsJson { version: 2 } },
            metadata,
        };

        let resp = self.http
            .post(format!("{}/v1/simc/jobs", SIMMIT_BASE_URL))
            .bearer_auth(bearer)
            .header("idempotency-key", job_id)
            .json(&body)
            .send()
            .await
            .map_err(|e| RunError::Other(format!("Simmit submit network error: {}", e)))?;

        let status = resp.status();
        if status.is_success() {
            let parsed: SubmitResponse = resp.json().await
                .map_err(|e| RunError::Other(format!("Simmit submit decode: {}", e)))?;
            if !parsed.success {
                return Err(RunError::Other("Simmit returned success=false".into()));
            }
            let _ = parsed.warnings;  // We don't surface warnings in v1.
            parsed.id.ok_or_else(|| RunError::Other("Simmit submit returned no id".into()))
        } else {
            let err: ErrorBody = resp.json().await.unwrap_or(ErrorBody { error: None, code: None });
            Err(map_simmit_error(status, err))
        }
    }
}

fn map_simmit_error(status: reqwest::StatusCode, err: ErrorBody) -> RunError {
    let code = err.code.as_deref().unwrap_or("");
    let msg = err.error.unwrap_or_else(|| status.to_string());
    match (status.as_u16(), code) {
        (401, _) => RunError::Other(format!("Invalid Simmit API key — re-enter in Settings ({})", msg)),
        (402, _) | (_, "insufficient_credits") | (_, "inactive_entitlement") => {
            RunError::Other(format!("Simmit: out of credits — add credits at dashboard.simmit.com ({})", msg))
        }
        (_, "input_sanitized_rejected") => {
            RunError::Other(format!("Simmit rejected the profile: {}", msg))
        }
        (429, _) | (_, "rate_limit_exceeded") | (_, "max_active_jobs_exceeded") => {
            RunError::Other(format!("Simmit rate-limited — try again shortly ({})", msg))
        }
        _ => RunError::Other(format!("Simmit error [{} {}]: {}", status, code, msg)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_threads_directive() {
        let out = strip_simmit_blocked_directives("threads=8\niterations=1000");
        assert_eq!(out, "iterations=1000");
    }
    #[test]
    fn drops_output_html_json_log() {
        let input = "output=foo\nhtml=a\njson=b\njson2=c\nlog=d\niterations=10";
        let out = strip_simmit_blocked_directives(input);
        assert_eq!(out, "iterations=10");
    }
    #[test]
    fn drops_save_variants() {
        let input = "save=foo\nsave_gear=bar\nsave_profiles=x";
        let out = strip_simmit_blocked_directives(input);
        assert!(out.is_empty() || out == "");
    }
    #[test]
    fn drops_dps_plot_anything() {
        let out = strip_simmit_blocked_directives("dps_plot_stats=strength\ndps_plot_iterations=100\niterations=10");
        assert_eq!(out, "iterations=10");
    }
    #[test]
    fn keeps_normal_directives() {
        let input = "iterations=1000\nfight_style=Patchwerk\ntarget_error=0.1\noverride.bloodlust=1";
        assert_eq!(strip_simmit_blocked_directives(input), input);
    }
    #[test]
    fn keeps_actor_and_apl_lines() {
        let input = "warrior=\"Test\"\nactions=cleave\nactions+=/execute,if=target.health.pct<20";
        assert_eq!(strip_simmit_blocked_directives(input), input);
    }
    #[test]
    fn case_sensitive_exact_match() {
        // "Threads=8" with capital T isn't an exact key match — stays.
        let input = "Threads=8";
        assert_eq!(strip_simmit_blocked_directives(input), input);
    }
    #[test]
    fn drops_apikey_variants() {
        let input = "apiKey=secret\napi_key=secret\napikey=secret\nfight_style=Patchwerk";
        let out = strip_simmit_blocked_directives(input);
        assert_eq!(out, "fight_style=Patchwerk");
    }
}
