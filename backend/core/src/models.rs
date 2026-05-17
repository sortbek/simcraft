use regex::Regex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Pending,
    Running,
    Paused,
    Done,
    Failed,
    Cancelled,
}

impl std::fmt::Display for JobStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        };
        f.write_str(s)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SimcInputMode {
    #[default]
    Inline,
    Streamed,
}

impl SimcInputMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Inline => "inline",
            Self::Streamed => "streamed",
        }
    }
    pub fn from_str(s: &str) -> Self {
        match s {
            "streamed" => Self::Streamed,
            _ => Self::Inline,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub status: JobStatus,
    pub sim_type: String,
    pub simc_input: String,
    pub result_json: Option<String>,
    pub raw_json: Option<String>,
    pub error_message: Option<String>,
    pub progress_pct: u8,
    pub progress_stage: Option<String>,
    pub progress_detail: Option<String>,
    pub stages_completed: Vec<String>,
    pub iterations: u32,
    pub fight_style: String,
    pub target_error: f64,
    pub created_at: String,
    pub html_report: Option<String>,
    pub text_output: Option<String>,
    pub batch_id: Option<String>,
    pub request_json: Option<String>,
    pub simc_input_mode: SimcInputMode,
    pub checkpoint: Option<String>,
    pub pause_requested: bool,
}

/// Slim view of a Job row used by the status polling endpoint.
/// Excludes large columns (raw_json, html_report, text_output, request_json,
/// simc_input) that are unnecessary for a 2-second poll.
#[derive(Debug, Clone)]
pub struct JobStatusSummary {
    pub id: String,
    pub status: JobStatus,
    pub progress_pct: u8,
    pub progress_stage: Option<String>,
    pub progress_detail: Option<String>,
    pub stages_completed: Vec<String>,
    pub result_json: Option<String>,
    pub error_message: Option<String>,
    pub simc_input_mode: SimcInputMode,
    pub pause_requested: bool,
}

/// Slim row for the sims-overview endpoint. Excludes large columns
/// (simc_input, request_json, result_json, raw_json, html_report, text_output)
/// so the list endpoint stays cheap even when 50+ jobs are returned.
#[derive(Debug, Clone, Serialize)]
pub struct JobActiveSummary {
    pub id: String,
    pub status: JobStatus,
    pub sim_type: String,
    pub created_at: String,
    pub progress_pct: u8,
    pub progress_stage: Option<String>,
    pub progress_detail: Option<String>,
    pub player_name: Option<String>,
    pub player_class: Option<String>,
    pub fight_style: String,
    pub simc_input_mode: SimcInputMode,
    pub pause_requested: bool,
    pub error_message: Option<String>,
    // Fields needed by the unified /sims overview (stats + batch grouping).
    // Optional so the active-list code path can omit them cheaply.
    pub iterations: u32,
    pub realm: Option<String>,
    pub region: Option<String>,
    pub dps: Option<f64>,
    pub batch_id: Option<String>,
}

pub struct ResultSummary {
    pub player_name: Option<String>,
    pub player_class: Option<String>,
    pub dps: Option<f64>,
    pub realm: Option<String>,
    pub region: Option<String>,
}

pub fn extract_result_summary(result_json: &Option<String>, simc_input: &str) -> ResultSummary {
    let mut summary = ResultSummary {
        player_name: None,
        player_class: None,
        dps: None,
        realm: None,
        region: None,
    };

    // Extract DPS, player name, class from parsed result
    if let Some(json_str) = result_json {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
            summary.player_name = v
                .get("player_name")
                .and_then(|n| n.as_str())
                .map(String::from);
            summary.player_class = v
                .get("player_class")
                .and_then(|c| c.as_str())
                .map(String::from);
            summary.dps = v.get("dps").and_then(|d| d.as_f64());
        }
    }

    // Extract realm and region from simc input
    for line in simc_input.lines() {
        let trimmed = line.trim();
        if summary.realm.is_none() {
            if let Some(val) = trimmed.strip_prefix("server=") {
                summary.realm = Some(val.to_string());
            }
        }
        if summary.region.is_none() {
            if let Some(val) = trimmed.strip_prefix("region=") {
                summary.region = Some(val.to_string());
            }
        }
        if summary.realm.is_some() && summary.region.is_some() {
            break;
        }
    }

    // If player_name not in result yet, extract from simc input (e.g. deathknight="Simpydk")
    if summary.player_name.is_none() {
        let re = Regex::new(
            r#"^(?:warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|druid|demon_hunter|demonhunter|evoker)\s*=\s*"(.+)""#
        ).unwrap();
        for line in simc_input.lines() {
            if let Some(caps) = re.captures(line.trim()) {
                summary.player_name = Some(caps[1].to_string());
                break;
            }
        }
    }

    summary
}

impl Job {
    pub fn new(
        simc_input: String,
        sim_type: String,
        iterations: u32,
        fight_style: String,
        target_error: f64,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            status: JobStatus::Pending,
            sim_type,
            simc_input,
            result_json: None,
            raw_json: None,
            error_message: None,
            progress_pct: 0,
            progress_stage: None,
            progress_detail: None,
            stages_completed: Vec::new(),
            iterations,
            fight_style,
            target_error,
            created_at: chrono::Utc::now().to_rfc3339(),
            html_report: None,
            text_output: None,
            batch_id: None,
            request_json: None,
            simc_input_mode: SimcInputMode::Inline,
            checkpoint: None,
            pause_requested: false,
        }
    }
}
