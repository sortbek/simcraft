use crate::compute::provider::{
    ProviderAuth, ProviderCaps, RunCtx, RunError, SimcOutput, SimcProvider,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone)]
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
            cloud_streaming: true,
        }
    }
    async fn run_quick(
        &self,
        ctx: RunCtx<'_>,
        input: &str,
        _opts: &Value,
    ) -> Result<SimcOutput, RunError> {
        // Input is already in final form — the handler ran it through
        // build_simc_input_from_options before invoking the provider.
        // We only strip Simmit-forbidden directives (threads=, output=, ...).
        let bearer = Self::bearer(&ctx)?;
        let stripped = strip_simmit_blocked_directives(input);
        // One submission per job → idempotency key = job_id (dedups a network retry).
        let remote_id = self.submit(&bearer, ctx.job_id, ctx.job_id, &stripped, false).await?;
        let _final_status = self.poll_to_terminal(&bearer, &remote_id, &ctx).await?;
        self.fetch_result(&bearer, &remote_id).await
    }

    async fn run_with_profilesets(
        &self,
        ctx: RunCtx<'_>,
        input: &str,
        _opts: &Value,
        _combo_count: usize,
        _staged_ctx: crate::compute::StagedExecutionContext,
    ) -> Result<SimcOutput, RunError> {
        // Server-side multistage handles its own staged execution — the
        // resume_state / triage_constants from staged_ctx don't apply here.
        // Input is pre-built by the handler.
        let bearer = Self::bearer(&ctx)?;
        let stripped = strip_simmit_blocked_directives(input);
        let remote_id = self.submit(&bearer, ctx.job_id, ctx.job_id, &stripped, true).await?;
        let _final_status = self.poll_to_terminal(&bearer, &remote_id, &ctx).await?;
        self.fetch_result(&bearer, &remote_id).await
    }

    async fn test_credential(&self, api_key: &str) -> Result<crate::compute::CredentialTest, String> {
        let resp = self.http
            .get(format!("{}/v1/simc/credits", SIMMIT_BASE_URL))
            .bearer_auth(api_key)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("Simmit returned {}", resp.status()));
        }
        let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!({}));
        // Simmit /v1/simc/credits shape:
        //   { purchased, reserved, grants: [{ remaining, ... }, ...] }
        // Available = purchased + Σ grants[].remaining − reserved.
        let purchased = body.get("purchased").and_then(|v| v.as_u64()).unwrap_or(0);
        let reserved = body.get("reserved").and_then(|v| v.as_u64()).unwrap_or(0);
        let granted: u64 = body
            .get("grants")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|g| g.get("remaining").and_then(|v| v.as_u64()))
                    .sum()
            })
            .unwrap_or(0);
        let available = purchased.saturating_add(granted).saturating_sub(reserved);
        Ok(crate::compute::CredentialTest { credits_available: Some(available) })
    }

    async fn get_usage(
        &self,
        auth: &crate::compute::ProviderAuth,
    ) -> Result<crate::compute::ProviderUsage, String> {
        use secrecy::ExposeSecret;
        let bearer = match auth {
            crate::compute::ProviderAuth::BearerToken(s) => s.expose_secret().to_string(),
            crate::compute::ProviderAuth::None => {
                return Err("Simmit requires a configured API key".into())
            }
        };
        let resp = self
            .http
            .get(format!("{}/v1/simc/usage", SIMMIT_BASE_URL))
            .bearer_auth(&bearer)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("Simmit usage returned {}", resp.status()));
        }
        let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!({}));
        Ok(parse_usage(&body))
    }

    /// Submit a chunk and return Simmit's remote job id immediately (before it
    /// runs), so the orchestrator can persist it to `cloud_chunks.remote_job_id`
    /// for resume re-polling. Pair with `poll_and_fetch_chunk`.
    async fn submit_chunk_for_id(
        &self,
        auth: &crate::compute::ProviderAuth,
        job_id: &str,
        idempotency_key: &str,
        input: &str,
    ) -> Result<String, RunError> {
        let bearer = match auth {
            crate::compute::ProviderAuth::BearerToken(s) => {
                use secrecy::ExposeSecret;
                s.expose_secret().to_string()
            }
            crate::compute::ProviderAuth::None => {
                return Err(RunError::Other("Simmit requires a configured API key".into()))
            }
        };
        let stripped = strip_simmit_blocked_directives(input);
        // Each chunk is a DISTINCT Simmit job, so it needs its own idempotency key
        // (Simmit rejects key reuse with 409). `simhammer_job_id` metadata still
        // carries the real job id for mapping.
        self.submit(&bearer, job_id, idempotency_key, &stripped, true).await
    }

    /// Poll an already-submitted remote chunk to terminal and fetch its result.
    /// Used both for the live submit path and for resume re-polling.
    async fn poll_and_fetch_chunk(
        &self,
        ctx: RunCtx<'_>,
        remote_job_id: &str,
    ) -> Result<SimcOutput, RunError> {
        let bearer = Self::bearer(&ctx)?;
        let _final = self.poll_to_terminal(&bearer, remote_job_id, &ctx).await?;
        self.fetch_result(&bearer, remote_job_id).await
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

/// Submission runtime ceiling. We never ask Simmit for more than 1800s, and we
/// honor a lower per-account cap (`ProviderUsage.max_runtime_seconds`) when it's
/// known — submitting above the account cap gets the job rejected.
fn submit_runtime_seconds(account_max: Option<u32>) -> u32 {
    account_max.map(|a| a.min(1800)).unwrap_or(1800)
}

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
struct SubmitArtifactsJson { version: &'static str }
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
        idempotency_key: &str,
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
                // The per-account cap (`ProviderUsage.max_runtime_seconds` from
                // `get_usage`) is not threaded to this private submit path today —
                // the provider is a shared `Arc<dyn SimcProvider>` singleton, so it
                // can't cache a per-account value safely, and `RunCtx` carries no
                // usage. `None` preserves the 1800s ceiling; once the cap is
                // threaded in, pass it here and the helper clamps it correctly.
                max_runtime_seconds: submit_runtime_seconds(None),
            },
            artifacts: SubmitArtifacts { json: SubmitArtifactsJson { version: "2" } },
            metadata,
        };

        let resp = self.http
            .post(format!("{}/v1/simc/jobs", SIMMIT_BASE_URL))
            .bearer_auth(bearer)
            .header("idempotency-key", idempotency_key)
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

#[derive(Deserialize, Debug)]
struct StatusResponse {
    status: String,
    #[serde(default, rename = "errorCode")]
    error_code: Option<String>,
    #[serde(default, rename = "statusReason")]
    status_reason: Option<String>,
    #[serde(default)]
    queue: Option<StatusQueue>,
    #[serde(default)]
    progress: Option<StatusProgress>,
    #[serde(default, rename = "logEntries")]
    log_entries: Option<Vec<StatusLog>>,
}
#[derive(Deserialize, Debug, Default)]
struct StatusQueue {
    #[serde(default, rename = "estimatedStartSeconds")]
    estimated_start_seconds: Option<u32>,
}
#[derive(Deserialize, Debug, Default)]
struct StatusProgress {
    #[serde(default)]
    percent: Option<f64>,
    #[serde(default)]
    stage: Option<StatusStage>,
}
#[derive(Deserialize, Debug, Default)]
struct StatusStage {
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    current: Option<u32>,
    #[serde(default)]
    total: Option<u32>,
}
#[derive(Deserialize, Debug)]
struct StatusLog {
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default, deserialize_with = "deserialize_ts")]
    ts: u64,
}

/// Accept either an integer or a float for `ts` (epoch ms). Treat absent or
/// non-numeric as 0 so log dedup still progresses.
fn deserialize_ts<'de, D>(d: D) -> Result<u64, D::Error>
where D: serde::Deserializer<'de> {
    let v = serde_json::Value::deserialize(d)?;
    match v {
        serde_json::Value::Number(n) => {
            if let Some(u) = n.as_u64() {
                Ok(u)
            } else if let Some(f) = n.as_f64() {
                Ok(f.max(0.0) as u64)
            } else {
                Ok(0)
            }
        }
        serde_json::Value::String(s) => Ok(s.parse::<u64>().unwrap_or(0)),
        serde_json::Value::Null => Ok(0),
        _ => Ok(0),
    }
}

#[derive(Deserialize, Debug)]
/// We deserialize but don't inspect the body — Simmit's HTTP status code is
/// the source of truth for whether the cancel was accepted. The fields are
/// kept structured for forward-compat (we may surface `status` in the UI
/// later) but marked allow(dead_code) so the compiler doesn't complain.
#[allow(dead_code)]
struct CancelResponse {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    status: Option<String>,
}

fn is_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled" | "timed_out")
}

/// Maps a terminal `StatusResponse` to `Ok` (completed) or the appropriate `RunError`.
/// Extracted as a pure helper so it can be unit-tested without HTTP.
fn terminal_status_to_result(s: &StatusResponse) -> Result<(), RunError> {
    if s.status == "completed" {
        return Ok(());
    }
    if s.status == "cancelled" {
        return Err(RunError::Cancelled);
    }
    let reason = s.status_reason.clone().unwrap_or_default();
    let code = s.error_code.clone().unwrap_or_default();
    let msg = match (code.is_empty(), reason.is_empty()) {
        (false, false) => format!("Simmit job {}: {} ({})", s.status, reason, code),
        (false, true)  => format!("Simmit job {}: {}", s.status, code),
        (true, false)  => format!("Simmit job {}: {}", s.status, reason),
        (true, true)   => format!("Simmit job ended with status {}", s.status),
    };
    Err(RunError::Other(msg))
}

/// Poll cadence (ms) by Simmit job status. A queued job won't change for a while,
/// so we back off to spare Simmit's API read limit (a 60s queue at 1.5s is ~40
/// pointless reads); once it's starting/running we poll faster to keep progress
/// and logs live. Cancel latency is bounded by this interval too, but a queued
/// job is fine to cancel a few seconds late.
fn poll_interval_ms(status: &str) -> u64 {
    match status {
        "queued" | "pending" => 5000,
        "starting" => 2000,
        _ => 1500, // running, etc. — keep progress/logs responsive
    }
}

/// Max consecutive transient poll failures (network blip, 5xx, 429) tolerated
/// before a chunk gives up. The remote job keeps running regardless, so a flaky
/// connection must not abort a chunk (and, via split-retry, the whole sim).
const MAX_POLL_TRANSIENT_FAILURES: u32 = 5;

/// Backoff (ms) before retrying a transient poll failure. Escalates
/// 1s → 2s → 4s → 8s and caps there.
fn poll_retry_backoff_ms(failures: u32) -> u64 {
    1000u64 * (1u64 << failures.saturating_sub(1).min(3))
}

impl SimmitProvider {
    async fn poll_to_terminal(
        &self,
        bearer: &str,
        remote_job_id: &str,
        ctx: &RunCtx<'_>,
    ) -> Result<StatusResponse, RunError> {
        let mut last_log_ts: u64 = 0;
        // Consecutive transient failures (network blip, 5xx, 429). Reset to 0 on
        // every clean poll; a long-running remote job must survive a flaky link.
        let mut transient_failures: u32 = 0;
        loop {
            // Cancel between polls.
            if let Some(tok) = ctx.cancel.as_ref() {
                if tok.is_cancelled().await {
                    self.cancel_remote(bearer, remote_job_id).await;
                    return Err(RunError::Cancelled);
                }
            }
            let url = format!("{}/v1/simc/jobs/{}/status?include=logEntries", SIMMIT_BASE_URL, remote_job_id);

            // ── One poll attempt. Transient transport errors, 5xx and 429 are
            // retried with backoff instead of aborting the chunk. ────────────
            let resp = match self.http.get(&url).bearer_auth(bearer).send().await {
                Ok(r) => r,
                Err(e) => {
                    transient_failures += 1;
                    if transient_failures >= MAX_POLL_TRANSIENT_FAILURES {
                        return Err(RunError::Other(format!(
                            "Simmit poll: {} (after {} retries)", e, transient_failures
                        )));
                    }
                    (ctx.on_log)(&format!(
                        "[simmit] poll network error ({}/{}), retrying: {}",
                        transient_failures, MAX_POLL_TRANSIENT_FAILURES, e
                    ));
                    tokio::time::sleep(std::time::Duration::from_millis(
                        poll_retry_backoff_ms(transient_failures),
                    )).await;
                    continue;
                }
            };
            if !resp.status().is_success() {
                let status_code = resp.status();
                // 5xx and 429 are transient — retry rather than fail the sim.
                if status_code.is_server_error()
                    || status_code == reqwest::StatusCode::TOO_MANY_REQUESTS
                {
                    transient_failures += 1;
                    if transient_failures < MAX_POLL_TRANSIENT_FAILURES {
                        (ctx.on_log)(&format!(
                            "[simmit] poll {} ({}/{}), retrying",
                            status_code, transient_failures, MAX_POLL_TRANSIENT_FAILURES
                        ));
                        tokio::time::sleep(std::time::Duration::from_millis(
                            poll_retry_backoff_ms(transient_failures),
                        )).await;
                        continue;
                    }
                }
                let err: ErrorBody = resp.json().await.unwrap_or(ErrorBody { error: None, code: None });
                return Err(map_simmit_error(status_code, err));
            }
            let body_text = match resp.text().await {
                Ok(t) => t,
                Err(e) => {
                    transient_failures += 1;
                    if transient_failures >= MAX_POLL_TRANSIENT_FAILURES {
                        return Err(RunError::Other(format!(
                            "Simmit poll body read: {} (after {} retries)", e, transient_failures
                        )));
                    }
                    (ctx.on_log)(&format!(
                        "[simmit] poll body read error ({}/{}), retrying: {}",
                        transient_failures, MAX_POLL_TRANSIENT_FAILURES, e
                    ));
                    tokio::time::sleep(std::time::Duration::from_millis(
                        poll_retry_backoff_ms(transient_failures),
                    )).await;
                    continue;
                }
            };
            let s: StatusResponse = serde_json::from_str(&body_text)
                .map_err(|e| {
                    let preview: String = body_text.chars().take(400).collect();
                    eprintln!("[simmit] status decode failed: {} | body: {}", e, preview);
                    RunError::Other(format!("Simmit poll decode: {}", e))
                })?;
            // A clean poll → connectivity is back; reset the transient counter.
            transient_failures = 0;

            // Stream new log lines, dedup by ts.
            let logs_slice = s.log_entries.as_deref().unwrap_or(&[]);
            let new_logs: Vec<&StatusLog> = logs_slice.iter().filter(|l| l.ts > last_log_ts).collect();
            for log in new_logs {
                let src = log.source.as_deref().unwrap_or("?");
                let msg = log.message.as_deref().unwrap_or("");
                (ctx.on_log)(&format!("[{}] {}", src, msg));
                last_log_ts = log.ts;
            }

            // Map progress. Single-stage Simmit jobs report stage = {1,1,"initial"};
            // suppress that as noise and just show the percent. Multistage shows
            // the live stage label + N/M.
            let pct = s.progress.as_ref()
                .and_then(|p| p.percent)
                .unwrap_or(0.0)
                .clamp(0.0, 100.0) as u8;
            let queue_eta = s.queue.as_ref().and_then(|q| q.estimated_start_seconds);
            let (label, sub) = match s.status.as_str() {
                "queued" | "pending" => (
                    "Queued on Simmit".to_string(),
                    queue_eta.map(|n| format!("starts in ~{}s", n)).unwrap_or_else(|| "in queue".to_string()),
                ),
                "starting" => (
                    "Starting on Simmit".to_string(),
                    "spinning up worker".to_string(),
                ),
                "running" => {
                    let multistage = s.progress.as_ref()
                        .and_then(|p| p.stage.as_ref())
                        .filter(|st| st.total.unwrap_or(1) > 1);
                    match multistage {
                        Some(st) => (
                            format!("Stage {}/{} on Simmit",
                                st.current.unwrap_or(0),
                                st.total.unwrap_or(0),
                            ),
                            st.label.clone().unwrap_or_else(|| "running".into()),
                        ),
                        None => ("Running on Simmit".to_string(), format!("{}%", pct)),
                    }
                }
                other => (format!("Simmit: {}", other), String::new()),
            };
            // Floor the percent at 5 while pending/queued so the bar doesn't sit at 0.
            let display_pct = if matches!(s.status.as_str(), "queued" | "pending" | "starting") {
                pct.max(5)
            } else {
                pct
            };
            (ctx.on_progress)(display_pct, &label, &sub);

            if is_terminal(&s.status) {
                terminal_status_to_result(&s)?;
                return Ok(s);
            }
            tokio::time::sleep(std::time::Duration::from_millis(poll_interval_ms(&s.status))).await;
        }
    }

    async fn fetch_result(&self, bearer: &str, remote_job_id: &str) -> Result<SimcOutput, RunError> {
        let url = format!("{}/v1/simc/jobs/{}/result", SIMMIT_BASE_URL, remote_job_id);
        let resp = self.http.get(&url).bearer_auth(bearer).send().await
            .map_err(|e| RunError::Other(format!("Simmit result fetch: {}", e)))?;
        if !resp.status().is_success() {
            let status_code = resp.status();
            let err: ErrorBody = resp.json().await.unwrap_or(ErrorBody { error: None, code: None });
            return Err(map_simmit_error(status_code, err));
        }
        let body_text = resp.text().await
            .map_err(|e| RunError::Other(format!("Simmit result body read: {}", e)))?;
        let body: ResultBody = serde_json::from_str(&body_text)
            .map_err(|e| {
                let preview: String = body_text.chars().take(400).collect();
                eprintln!("[simmit] result decode failed: {} | body: {}", e, preview);
                RunError::Other(format!("Simmit result decode: {}", e))
            })?;

        // Prefer the full SimC JSON artifact (has per-ability damage breakdown).
        // Fall back to the synthesized summary if the artifact isn't downloadable.
        let artifact_url = body
            .result
            .as_ref()
            .and_then(|r| {
                r.artifacts
                    .iter()
                    .find(|a| a.kind.as_deref() == Some("json_report"))
                    .and_then(|a| a.url.clone())
            });

        if let Some(url) = artifact_url {
            match self.http.get(&url).send().await {
                Ok(r) if r.status().is_success() => {
                    match r.json::<serde_json::Value>().await {
                        Ok(mut full_json) => {
                            // Inject the simmit metadata block so the result-page
                            // footer can show credits / build commit.
                            if let Some(obj) = full_json.as_object_mut() {
                                obj.insert("simmit".to_string(), simmit_metadata(&body));
                            }
                            return Ok(SimcOutput { json: full_json, html_report: None, text_output: None });
                        }
                        Err(e) => eprintln!("[simmit] artifact JSON decode failed: {}", e),
                    }
                }
                Ok(r) => eprintln!("[simmit] artifact fetch returned {}", r.status()),
                Err(e) => eprintln!("[simmit] artifact fetch error: {}", e),
            }
        }
        Ok(simmit_result_to_simc_output(&body))
    }

    async fn cancel_remote(&self, bearer: &str, remote_job_id: &str) {
        let url = format!("{}/v1/simc/jobs/{}/cancel", SIMMIT_BASE_URL, remote_job_id);
        let resp = self.http.post(&url).bearer_auth(bearer).send().await;
        match resp {
            Ok(r) if r.status().is_success() => {
                let _ = r.json::<CancelResponse>().await;
            }
            Ok(r) if r.status() == reqwest::StatusCode::CONFLICT => {
                // 409 = already terminal — fine.
            }
            Ok(r) => {
                eprintln!("Simmit cancel returned {}", r.status());
            }
            Err(e) => {
                eprintln!("Simmit cancel network error: {}", e);
            }
        }
    }
}

#[derive(Deserialize, Debug)]
struct ResultBody {
    result: Option<ResultPayload>,
    #[serde(default)]
    runtime: Option<RuntimeInfo>,
    #[serde(default)]
    build: Option<BuildInfo>,
}
#[derive(Deserialize, Debug)]
struct ResultPayload {
    summary: SummaryBlock,
    #[serde(default)]
    artifacts: Vec<ArtifactRef>,
}
#[derive(Deserialize, Debug, Clone)]
struct ArtifactRef {
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    url: Option<String>,
}
#[derive(Deserialize, Debug)]
struct SummaryBlock {
    #[serde(rename = "mainActor")]
    main_actor: MainActor,
}
#[derive(Deserialize, Debug)]
struct MainActor {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    mean: Option<f64>,
    #[serde(default, rename = "mean_error")]
    mean_error: Option<f64>,
    #[serde(default, rename = "mean_stddev")]
    mean_stddev: Option<f64>,
    #[serde(default)]
    profilesets: Option<ProfilesetsBlock>,
}
#[derive(Deserialize, Debug, Default)]
struct ProfilesetsBlock {
    // `count` is in Simmit's response shape but we don't use it — we trust
    // `results.len()` instead. Drop the field rather than carry a dead one.
    #[serde(default)]
    results: Vec<serde_json::Value>,
}
#[derive(Deserialize, Debug, Default)]
struct RuntimeInfo {
    #[serde(default, rename = "creditsConsumed")]
    credits_consumed: Option<u64>,
    #[serde(default, rename = "simDurationMs")]
    sim_duration_ms: Option<u64>,
}
#[derive(Deserialize, Debug, Default)]
struct BuildInfo {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    commit: Option<String>,
}

/// Parse `GET /v1/simc/usage` → ProviderUsage. Shape:
///   { "limits": { "maxRuntimeSeconds": N, "maxActiveJobs": M, ... }, ... }
fn parse_usage(body: &serde_json::Value) -> crate::compute::ProviderUsage {
    let limits = body.get("limits");
    crate::compute::ProviderUsage {
        max_runtime_seconds: limits
            .and_then(|l| l.get("maxRuntimeSeconds"))
            .and_then(|v| v.as_u64())
            .map(|n| n as u32),
        max_active_jobs: limits
            .and_then(|l| l.get("maxActiveJobs"))
            .and_then(|v| v.as_u64())
            .map(|n| n as u32),
    }
}

/// Provider metadata block injected into the result JSON. The frontend's
/// result-page footer reads `result.simmit.{credits_consumed,build_commit}`.
fn simmit_metadata(body: &ResultBody) -> serde_json::Value {
    serde_json::json!({
        "credits_consumed": body.runtime.as_ref().and_then(|r| r.credits_consumed),
        "sim_duration_ms": body.runtime.as_ref().and_then(|r| r.sim_duration_ms),
        "build_id": body.build.as_ref().and_then(|b| b.id.clone()),
        "build_commit": body.build.as_ref().and_then(|b| b.commit.clone()),
    })
}

/// Adapter: build a SimC-shaped JSON from Simmit's response body so the
/// existing `result_parser::parse_simc_result` can ingest it unchanged.
fn simmit_result_to_simc_output(body: &ResultBody) -> SimcOutput {
    let actor = body.result.as_ref().map(|r| &r.summary.main_actor);
    let actor_name = actor.and_then(|a| a.name.clone()).unwrap_or_default();
    let dps_mean = actor.and_then(|a| a.mean).unwrap_or(0.0);
    let dps_error = actor.and_then(|a| a.mean_error).unwrap_or(0.0);
    let dps_stddev = actor.and_then(|a| a.mean_stddev).unwrap_or(0.0);
    let profilesets = actor
        .and_then(|a| a.profilesets.as_ref())
        .map(|p| p.results.clone())
        .unwrap_or_default();

    let json = serde_json::json!({
        "sim": {
            "players": [{
                "name": actor_name,
                "collected_data": {
                    "dps": {
                        "mean": dps_mean,
                        "mean_std_dev": dps_error,
                        "std_dev": dps_stddev,
                    }
                }
            }],
            "profilesets": { "results": profilesets },
        },
        "simmit": {
            "credits_consumed": body.runtime.as_ref().and_then(|r| r.credits_consumed),
            "sim_duration_ms": body.runtime.as_ref().and_then(|r| r.sim_duration_ms),
            "build_id": body.build.as_ref().and_then(|b| b.id.clone()),
            "build_commit": body.build.as_ref().and_then(|b| b.commit.clone()),
        }
    });

    SimcOutput { json, html_report: None, text_output: None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn poll_interval_backs_off_while_queued() {
        // Queued/pending back off to spare Simmit's read limit; active states stay snappy.
        assert_eq!(poll_interval_ms("queued"), 5000);
        assert_eq!(poll_interval_ms("pending"), 5000);
        assert_eq!(poll_interval_ms("starting"), 2000);
        assert_eq!(poll_interval_ms("running"), 1500);
        assert_eq!(poll_interval_ms("anything-else"), 1500);
    }

    #[test]
    fn poll_retry_backoff_escalates_and_caps() {
        assert_eq!(poll_retry_backoff_ms(1), 1000);
        assert_eq!(poll_retry_backoff_ms(2), 2000);
        assert_eq!(poll_retry_backoff_ms(3), 4000);
        assert_eq!(poll_retry_backoff_ms(4), 8000);
        // Caps at 8s for any further failures.
        assert_eq!(poll_retry_backoff_ms(9), 8000);
    }

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

    #[test]
    fn parse_usage_reads_limits() {
        let body = serde_json::json!({
            "limits": { "maxRuntimeSeconds": 3600, "maxActiveJobs": 4 }
        });
        let u = parse_usage(&body);
        assert_eq!(u.max_runtime_seconds, Some(3600));
        assert_eq!(u.max_active_jobs, Some(4));
    }

    #[test]
    fn parse_usage_absent_limits_is_none() {
        let u = parse_usage(&serde_json::json!({}));
        assert!(u.max_runtime_seconds.is_none());
        assert!(u.max_active_jobs.is_none());
    }

    #[test]
    fn submit_runtime_respects_account_cap() {
        assert_eq!(submit_runtime_seconds(None), 1800);
        assert_eq!(submit_runtime_seconds(Some(600)), 600);
        assert_eq!(submit_runtime_seconds(Some(3600)), 1800); // clamp down to ceiling
    }

    #[test]
    fn deserialize_ts_tolerates_non_numeric() {
        #[derive(serde::Deserialize)]
        struct W { #[serde(default, deserialize_with = "deserialize_ts")] ts: u64 }
        // bool / object / unparseable string must NOT error — they become 0.
        assert_eq!(serde_json::from_str::<W>(r#"{"ts": true}"#).unwrap().ts, 0);
        assert_eq!(serde_json::from_str::<W>(r#"{"ts": {}}"#).unwrap().ts, 0);
        assert_eq!(serde_json::from_str::<W>(r#"{"ts": "abc"}"#).unwrap().ts, 0);
        // numeric still works
        assert_eq!(serde_json::from_str::<W>(r#"{"ts": 42}"#).unwrap().ts, 42);
    }

    #[test]
    fn simmit_caps_cloud_streaming_true() {
        let p = SimmitProvider::new(reqwest::Client::new());
        assert!(p.capabilities().cloud_streaming);
    }

    #[test]
    fn adapter_main_actor_dps_lands_in_sim_players() {
        let body: ResultBody = serde_json::from_value(serde_json::json!({
            "result": {
                "summary": {
                    "mainActor": {
                        "name": "Testchar",
                        "mean": 123456.78,
                        "mean_error": 250.0,
                        "mean_stddev": 1500.0,
                        "profilesets": { "count": 10, "results": [] }
                    }
                }
            },
            "runtime": { "creditsConsumed": 9600 },
            "build": { "id": "b-1", "commit": "abc123" }
        })).unwrap();
        let out = simmit_result_to_simc_output(&body);
        assert_eq!(out.json["sim"]["players"][0]["name"], "Testchar");
        let dps = &out.json["sim"]["players"][0]["collected_data"]["dps"]["mean"];
        assert!((dps.as_f64().unwrap() - 123456.78).abs() < 0.001);
        assert_eq!(out.json["simmit"]["credits_consumed"], 9600);
        assert!(out.html_report.is_none());
    }

    #[test]
    fn adapter_handles_empty_result_gracefully() {
        let body: ResultBody = serde_json::from_value(serde_json::json!({})).unwrap();
        let out = simmit_result_to_simc_output(&body);
        assert_eq!(out.json["sim"]["players"][0]["collected_data"]["dps"]["mean"], 0.0);
    }

    #[test]
    fn adapter_passes_profileset_results_through() {
        let body: ResultBody = serde_json::from_value(serde_json::json!({
            "result": { "summary": { "mainActor": {
                "name": "A", "mean": 1.0, "mean_error": 0.0, "mean_stddev": 0.0,
                "profilesets": { "count": 2, "results": [
                    {"name": "Combo 1", "mean": 100.0},
                    {"name": "Combo 2", "mean": 200.0}
                ]}
            }}}
        })).unwrap();
        let out = simmit_result_to_simc_output(&body);
        assert_eq!(out.json["sim"]["profilesets"]["results"].as_array().unwrap().len(), 2);
    }

    fn status_with(status: &str) -> StatusResponse {
        StatusResponse {
            status: status.to_string(),
            error_code: None,
            status_reason: None,
            queue: None,
            progress: None,
            log_entries: None,
        }
    }

    #[test]
    fn cancelled_terminal_status_maps_to_cancelled() {
        let s = status_with("cancelled");
        assert!(matches!(terminal_status_to_result(&s), Err(RunError::Cancelled)));
        let s2 = status_with("failed");
        assert!(matches!(terminal_status_to_result(&s2), Err(RunError::Other(_))));
    }
}
