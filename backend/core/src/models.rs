use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Class declarations in a SimC profile look like `deathknight="MyChar"`.
/// Compiled once and reused so per-row stats over a 200-job history don't pay
/// the regex compilation cost (50-500 µs per call) on every row.
static SIMC_PLAYER_NAME_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"^(?:warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|druid|demon_hunter|demonhunter|evoker)\s*=\s*"(.+)""#,
    )
    .unwrap()
});

/// User-facing sim category. Preserves source-mode identity for history,
/// analytics, and UI labelling regardless of how the result is rendered.
///
/// Distinct from `ResultKind` below: a Crest Upgrade sim is `SimMode::UpgradeCompare`
/// even though its payload renders as `ResultKind::GearComparison`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SimMode {
    Quick,
    StatWeights,
    TopGear,
    Droptimizer,
    EnchantGem,
    UpgradeCompare,
}

impl SimMode {
    /// Wire string. Matches what handlers and stored Job rows use today, so
    /// migration is a no-op at the protocol boundary.
    pub fn as_wire(self) -> &'static str {
        match self {
            SimMode::Quick => "quick",
            SimMode::StatWeights => "stat_weights",
            SimMode::TopGear => "top_gear",
            SimMode::Droptimizer => "droptimizer",
            SimMode::EnchantGem => "enchant_gem",
            SimMode::UpgradeCompare => "upgrade_compare",
        }
    }

    pub fn from_wire(s: &str) -> Option<Self> {
        match s {
            "quick" => Some(SimMode::Quick),
            "stat_weights" => Some(SimMode::StatWeights),
            "top_gear" => Some(SimMode::TopGear),
            "droptimizer" => Some(SimMode::Droptimizer),
            "enchant_gem" => Some(SimMode::EnchantGem),
            "upgrade_compare" => Some(SimMode::UpgradeCompare),
            _ => None,
        }
    }

    /// Whether this mode emits a gear-comparison payload (top-level `base_dps`
    /// + per-combo `results`) or a single-actor payload (top-level `dps`).
    ///   Lets summary/extractor code branch on intent rather than re-detecting
    ///   from the JSON shape.
    pub fn result_kind(self) -> ResultKind {
        match self {
            SimMode::Quick | SimMode::StatWeights => ResultKind::SingleActor,
            SimMode::TopGear
            | SimMode::Droptimizer
            | SimMode::EnchantGem
            | SimMode::UpgradeCompare => ResultKind::GearComparison,
        }
    }
}

/// Shape of the response payload, independent of which `SimMode` produced it.
/// Multiple modes share a result kind — e.g. Drop Finder, Top Gear, and Crest
/// Upgrades all render via the gear-comparison view.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResultKind {
    SingleActor,
    GearComparison,
}

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
    #[allow(clippy::should_implement_trait)]
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
pub struct JobOverviewSummary {
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

    // Extract DPS, player name, class from parsed result.
    //
    // Two payload shapes are supported:
    //   - Single-actor (Quick Sim, Stat Weights): top-level `dps`.
    //   - Gear comparison (Top Gear, Drop Finder, Enchant/Gem, Crest Upgrades):
    //     top-level `base_dps` + a `results` array of `{name, dps, ...}`. The
    //     history "best DPS" should be the highest DPS the sim found —
    //     baseline or any improved combo — so we take the max.
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
            summary.dps = v.get("dps").and_then(|d| d.as_f64()).or_else(|| {
                let base = v.get("base_dps").and_then(|d| d.as_f64()).unwrap_or(0.0);
                let best_result = v
                    .get("results")
                    .and_then(|r| r.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|entry| entry.get("dps").and_then(|d| d.as_f64()))
                            .fold(0.0_f64, f64::max)
                    })
                    .unwrap_or(0.0);
                let best = base.max(best_result);
                if best > 0.0 {
                    Some(best)
                } else {
                    None
                }
            });
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
        for line in simc_input.lines() {
            if let Some(caps) = SIMC_PLAYER_NAME_RE.captures(line.trim()) {
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

#[cfg(test)]
mod sim_mode_tests {
    use super::*;

    #[test]
    fn round_trip_wire() {
        for m in [
            SimMode::Quick,
            SimMode::StatWeights,
            SimMode::TopGear,
            SimMode::Droptimizer,
            SimMode::EnchantGem,
            SimMode::UpgradeCompare,
        ] {
            assert_eq!(SimMode::from_wire(m.as_wire()), Some(m));
        }
    }

    #[test]
    fn unknown_wire_returns_none() {
        assert_eq!(SimMode::from_wire("definitely_not_a_mode"), None);
    }

    #[test]
    fn result_kind_splits_modes_correctly() {
        assert_eq!(SimMode::Quick.result_kind(), ResultKind::SingleActor);
        assert_eq!(SimMode::StatWeights.result_kind(), ResultKind::SingleActor);
        assert_eq!(SimMode::TopGear.result_kind(), ResultKind::GearComparison);
        assert_eq!(
            SimMode::Droptimizer.result_kind(),
            ResultKind::GearComparison
        );
        assert_eq!(
            SimMode::EnchantGem.result_kind(),
            ResultKind::GearComparison
        );
        // Critical: Crest Upgrades is its own mode that *renders* as
        // gear-comparison. Previously this was lying about its identity
        // by storing sim_type = "top_gear" to share the parser.
        assert_eq!(
            SimMode::UpgradeCompare.result_kind(),
            ResultKind::GearComparison
        );
    }
}

#[cfg(test)]
mod summary_tests {
    use super::*;

    #[test]
    fn single_actor_result_uses_top_level_dps() {
        let json = r#"{"player_name":"Alice","dps":12345.0}"#;
        let s = extract_result_summary(&Some(json.to_string()), "");
        assert_eq!(s.dps, Some(12345.0));
    }

    #[test]
    fn gear_comparison_uses_best_of_base_and_results() {
        // Top Gear / Drop Finder / Enchant Gem / Crest Upgrades all emit this
        // shape — no top-level `dps`, just `base_dps` + per-combo `results`.
        // History must still surface a DPS so the row doesn't read "—".
        let json = r#"{
            "type":"top_gear",
            "base_dps": 50000.0,
            "results": [
                {"name":"Combo 1","dps": 53210.0},
                {"name":"Combo 2","dps": 51000.0}
            ]
        }"#;
        let s = extract_result_summary(&Some(json.to_string()), "");
        assert_eq!(s.dps, Some(53210.0));
    }

    #[test]
    fn gear_comparison_falls_back_to_base_when_results_empty() {
        let json = r#"{"type":"top_gear","base_dps": 48000.0,"results":[]}"#;
        let s = extract_result_summary(&Some(json.to_string()), "");
        assert_eq!(s.dps, Some(48000.0));
    }

    #[test]
    fn gear_comparison_with_zero_base_and_empty_results_is_none() {
        let json = r#"{"type":"top_gear","base_dps": 0.0,"results":[]}"#;
        let s = extract_result_summary(&Some(json.to_string()), "");
        assert_eq!(s.dps, None);
    }
}
