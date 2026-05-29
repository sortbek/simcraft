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
    async fn run_quick(
        &self,
        ctx: RunCtx<'_>,
        input: &str,
        _opts: &Value,
    ) -> Result<SimcOutput, RunError> {
        let bearer = Self::bearer(&ctx)?;
        let stripped = strip_simmit_blocked_directives(input);
        let remote_id = self.submit(&bearer, ctx.job_id, &stripped, false).await?;
        let _final_status = self.poll_to_terminal(&bearer, &remote_id, &ctx).await?;
        self.fetch_result(&bearer, &remote_id).await
    }

    async fn run_with_profilesets(
        &self,
        ctx: RunCtx<'_>,
        input: &str,
        _opts: &Value,
        _combo_count: usize,
    ) -> Result<SimcOutput, RunError> {
        let bearer = Self::bearer(&ctx)?;
        let stripped = strip_simmit_blocked_directives(input);
        let remote_id = self.submit(&bearer, ctx.job_id, &stripped, true).await?;
        let _final_status = self.poll_to_terminal(&bearer, &remote_id, &ctx).await?;
        self.fetch_result(&bearer, &remote_id).await
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
            artifacts: SubmitArtifacts { json: SubmitArtifactsJson { version: "2" } },
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
    use serde::de::Error;
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
        serde_json::Value::String(s) => s.parse::<u64>().map_err(D::Error::custom),
        serde_json::Value::Null => Ok(0),
        _ => Err(D::Error::custom("ts is not a number")),
    }
}

#[derive(Deserialize, Debug)]
struct CancelResponse {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    status: Option<String>,
}

fn is_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled" | "timed_out")
}

impl SimmitProvider {
    async fn poll_to_terminal(
        &self,
        bearer: &str,
        remote_job_id: &str,
        ctx: &RunCtx<'_>,
    ) -> Result<StatusResponse, RunError> {
        let mut last_log_ts: u64 = 0;
        loop {
            // Cancel between polls.
            if let Some(tok) = ctx.cancel.as_ref() {
                if tok.is_cancelled().await {
                    self.cancel_remote(bearer, remote_job_id).await;
                    return Err(RunError::Cancelled);
                }
            }
            let url = format!("{}/v1/simc/jobs/{}/status?include=logEntries", SIMMIT_BASE_URL, remote_job_id);
            let resp = self.http.get(&url).bearer_auth(bearer).send().await
                .map_err(|e| RunError::Other(format!("Simmit poll: {}", e)))?;
            if !resp.status().is_success() {
                let status_code = resp.status();
                let err: ErrorBody = resp.json().await.unwrap_or(ErrorBody { error: None, code: None });
                return Err(map_simmit_error(status_code, err));
            }
            let body_text = resp.text().await
                .map_err(|e| RunError::Other(format!("Simmit poll body read: {}", e)))?;
            let s: StatusResponse = serde_json::from_str(&body_text)
                .map_err(|e| {
                    let preview: String = body_text.chars().take(400).collect();
                    eprintln!("[simmit] status decode failed: {} | body: {}", e, preview);
                    RunError::Other(format!("Simmit poll decode: {}", e))
                })?;

            // Stream new log lines, dedup by ts.
            let logs_slice = s.log_entries.as_deref().unwrap_or(&[]);
            let new_logs: Vec<&StatusLog> = logs_slice.iter().filter(|l| l.ts > last_log_ts).collect();
            for log in new_logs {
                let src = log.source.as_deref().unwrap_or("?");
                let msg = log.message.as_deref().unwrap_or("");
                (ctx.on_log)(&format!("[{}] {}", src, msg));
                last_log_ts = log.ts;
            }

            // Map progress.
            if let Some(p) = &s.progress {
                let pct = p.percent.unwrap_or(0.0).clamp(0.0, 100.0) as u8;
                let (label, sub) = match (&p.stage, &s.queue, s.status.as_str()) {
                    (Some(st), _, _) => (
                        st.label.clone().unwrap_or_else(|| "Simulating".into()),
                        format!("{}/{} · cloud",
                            st.current.unwrap_or(0),
                            st.total.unwrap_or(0),
                        ),
                    ),
                    (None, Some(q), "queued" | "pending") => (
                        "Queued".to_string(),
                        match q.estimated_start_seconds {
                            Some(n) => format!("starts in ~{}s", n),
                            None => "in queue".to_string(),
                        },
                    ),
                    _ => ("Simulating".to_string(), "cloud".to_string()),
                };
                (ctx.on_progress)(pct, &label, &sub);
            } else if s.status == "queued" || s.status == "pending" {
                // Provide some progress feedback even without server-side percent.
                let sub = s.queue.as_ref()
                    .and_then(|q| q.estimated_start_seconds)
                    .map(|n| format!("starts in ~{}s", n))
                    .unwrap_or_else(|| "in queue".to_string());
                (ctx.on_progress)(5, "Queued", &sub);
            }

            if is_terminal(&s.status) {
                return Ok(s);
            }
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
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
        let body: ResultBody = resp.json().await
            .map_err(|e| RunError::Other(format!("Simmit result decode: {}", e)))?;
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
    #[serde(default)]
    count: Option<u32>,
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

/// Adapter: build a SimC-shaped JSON from Simmit's response body so the
/// existing `result_parser::parse_simc_result` can ingest it unchanged.
pub fn simmit_result_to_simc_output(body: &ResultBody) -> SimcOutput {
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
}
