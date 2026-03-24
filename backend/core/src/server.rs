use actix_cors::Cors;
use actix_files::NamedFile;
use actix_web::{web, App, HttpServer, HttpResponse, HttpRequest};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::game_data;
use crate::models::{Job, JobStatus};
use crate::storage::JobStorage;
use crate::profileset_generator;
use crate::result_parser;
use crate::simc_runner;
use crate::addon_parser;

/// Newtype wrapper to avoid colliding with the simc `web::Data<PathBuf>`.
#[derive(Clone)]
struct FrontendDir(PathBuf);

#[cfg(feature = "desktop")]
/// Shared system info state, refreshed in background for live CPU readings.
struct SystemStats {
    sys: sysinfo::System,
}

#[cfg(feature = "desktop")]
impl SystemStats {
    fn new() -> Self {
        let mut sys = sysinfo::System::new();
        sys.refresh_cpu_all();
        Self { sys }
    }

    fn refresh(&mut self) {
        self.sys.refresh_cpu_all();
    }

    fn cpu_usage(&self) -> f32 {
        let cpus = self.sys.cpus();
        if cpus.is_empty() {
            return 0.0;
        }
        cpus.iter().map(|c| c.cpu_usage()).sum::<f32>() / cpus.len() as f32
    }
}

// ---------- Request / Response types ----------

/// Shared simulation options common to all sim request types.
#[derive(Debug, Deserialize)]
pub struct SimOptions {
    #[serde(default = "default_iterations")]
    pub iterations: u32,
    #[serde(default = "default_fight_style")]
    pub fight_style: String,
    #[serde(default = "default_target_error")]
    pub target_error: f64,
    #[serde(default = "default_desired_targets")]
    pub desired_targets: u32,
    #[serde(default = "default_max_time")]
    pub max_time: u32,
    #[serde(default)]
    pub threads: u32,
    #[serde(default)]
    pub talents: String,
    /// Custom APL and SimC expansion options (e.g., actions=..., midnight.*, use_blizzard_action_list).
    #[serde(default)]
    pub custom_apl: String,
    // Expert Mode injection points
    #[serde(default)]
    pub simc_header: String,
    #[serde(default)]
    pub simc_base_player: String,
    #[serde(default)]
    pub simc_raid_actors: String,
    #[serde(default)]
    pub simc_post_combos: String,
    #[serde(default)]
    pub simc_footer: String,
}

impl SimOptions {
    fn has_raid_actors(&self) -> bool {
        !sanitize_custom_simc(&self.simc_raid_actors).trim().is_empty()
    }

    fn to_json(&self) -> Value {
        json!({
            "fight_style": self.fight_style,
            "target_error": self.target_error,
            "iterations": self.iterations,
            "desired_targets": self.desired_targets,
            "max_time": self.max_time,
            "threads": self.threads,
            "single_actor_batch": !self.has_raid_actors(),
        })
    }

    fn to_json_with_sim_type(&self, sim_type: &str) -> Value {
        let mut v = self.to_json();
        v["sim_type"] = json!(sim_type);
        v
    }
}

#[derive(Debug, Deserialize)]
pub struct SimRequest {
    pub simc_input: String,
    #[serde(default = "default_sim_type")]
    pub sim_type: String,
    #[serde(default)]
    pub max_upgrade: bool,
    #[serde(flatten)]
    pub options: SimOptions,
}

#[derive(Debug, Deserialize)]
pub struct TopGearRequest {
    pub simc_input: String,
    pub selected_items: HashMap<String, Vec<usize>>,
    pub items_by_slot: Option<HashMap<String, Vec<Value>>>,
    #[serde(default)]
    pub max_upgrade: bool,
    #[serde(default)]
    pub copy_enchants: bool,
    #[serde(flatten)]
    pub options: SimOptions,
}

#[derive(Debug, Deserialize)]
pub struct DroptimizerRequest {
    pub simc_input: String,
    pub drop_items: Vec<Value>,
    #[serde(flatten)]
    pub options: SimOptions,
}

#[derive(Debug, Serialize)]
pub struct SimResponse {
    pub id: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct ItemInfoBatchRequest {
    #[serde(default)]
    pub items: Vec<Value>,
    #[serde(default)]
    pub item_ids: Vec<u64>,
}

#[derive(Debug, Deserialize)]
pub struct BonusIdsQuery {
    #[serde(default)]
    pub bonus_ids: String,
}

fn default_iterations() -> u32 { 1000 }
fn default_fight_style() -> String { "Patchwerk".to_string() }
fn default_target_error() -> f64 { 0.05 }
fn default_sim_type() -> String { "quick".to_string() }
fn default_desired_targets() -> u32 { 1 }
fn default_max_time() -> u32 { 300 }

/// Sanitize user-provided custom SimC input by stripping dangerous directives.
fn sanitize_custom_simc(input: &str) -> String {
    let blocked = regex::Regex::new(r"(?mi)^\s*(output|html|json2?|xml)\s*=").unwrap();
    input
        .lines()
        .filter(|line| !blocked.is_match(line))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Inject expert mode fields at the correct positions in the SimC profile.
///
/// For profileset sims (has `# Base Actor` and `### Combo` markers):
///   {header} → # Base Actor → {base lines} → {base_player} → ### Combo 1 →
///   {gear} → {raid_actors} → ### Combo 2..N → {post_combos} → {footer}
///
/// For quick sim (no markers):
///   {header} → {raw input} → {base_player} → {raid_actors} → {post_combos} → {footer}
fn inject_expert_fields(simc_input: &str, options: &SimOptions) -> String {
    let header = sanitize_custom_simc(&options.simc_header);
    let base_player = sanitize_custom_simc(&options.simc_base_player);
    let custom_apl = sanitize_custom_simc(&options.custom_apl);
    let raid_actors = sanitize_custom_simc(&options.simc_raid_actors);
    let post_combos = sanitize_custom_simc(&options.simc_post_combos);
    let footer = sanitize_custom_simc(&options.simc_footer);

    let all_empty = header.trim().is_empty()
        && base_player.trim().is_empty()
        && custom_apl.trim().is_empty()
        && raid_actors.trim().is_empty()
        && post_combos.trim().is_empty()
        && footer.trim().is_empty();

    if all_empty {
        return simc_input.to_string();
    }

    let lines: Vec<&str> = simc_input.lines().collect();
    let has_base_actor = lines.iter().any(|l| l.trim() == "# Base Actor");

    if !has_base_actor {
        // Quick Sim: no markers, just concatenate in order
        let mut parts: Vec<&str> = Vec::new();
        if !header.trim().is_empty() {
            parts.push("# Header");
            parts.push(&header);
            parts.push("");
        }
        parts.push(simc_input);
        if !base_player.trim().is_empty() {
            parts.push("");
            parts.push("# Base Player Customization");
            parts.push(&base_player);
        }
        if !custom_apl.trim().is_empty() {
            parts.push("");
            parts.push("# Custom APL");
            parts.push(&custom_apl);
        }
        if !raid_actors.trim().is_empty() {
            parts.push("");
            parts.push("# Raid Actors");
            parts.push(&raid_actors);
        }
        if !post_combos.trim().is_empty() {
            parts.push("");
            parts.push("# Post Combination Actors");
            parts.push(&post_combos);
        }
        if !footer.trim().is_empty() {
            parts.push("");
            parts.push("# Footer");
            parts.push(&footer);
        }
        return parts.join("\n");
    }

    // Profileset sim: find markers and inject at the right positions
    let mut result: Vec<String> = Vec::new();
    let mut i = 0;
    let mut injected_base_player = false;
    let mut injected_raid_actors = false;
    let mut _last_combo_end = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim();

        // Inject header before "# Base Actor"
        if trimmed == "# Base Actor" && !header.trim().is_empty() {
            result.push("# Header".to_string());
            result.push(header.clone());
            result.push(String::new());
        }

        // Inject base_player and custom_apl before "### Combo 1"
        if trimmed == "### Combo 1" && !injected_base_player {
            if !base_player.trim().is_empty() {
                result.push("# Base Player Customization".to_string());
                result.push(base_player.clone());
                result.push(String::new());
            }
            if !custom_apl.trim().is_empty() {
                result.push("# Custom APL".to_string());
                result.push(custom_apl.clone());
                result.push(String::new());
            }
            injected_base_player = true;
        }

        // Inject raid_actors before "### Combo 2"
        if trimmed == "### Combo 2" && !raid_actors.trim().is_empty() && !injected_raid_actors {
            result.push("# Raid Actors".to_string());
            result.push(raid_actors.clone());
            result.push(String::new());
            injected_raid_actors = true;
        }

        result.push(lines[i].to_string());

        // Track end of combo blocks
        if trimmed.starts_with("### Combo") {
            _last_combo_end = result.len();
            // Scan ahead to find end of this combo block
            i += 1;
            while i < lines.len() {
                let next = lines[i].trim();
                if next.starts_with("### Combo") {
                    break; // start of next combo, don't consume
                }
                result.push(lines[i].to_string());
                _last_combo_end = result.len();
                i += 1;
            }
            continue;
        }

        i += 1;
    }

    // If raid_actors wasn't injected (only 1 combo / no Combo 2), inject after Combo 1 block
    if !injected_raid_actors && !raid_actors.trim().is_empty() {
        result.push(String::new());
        result.push("# Raid Actors".to_string());
        result.push(raid_actors);
    }

    // Post combos after all profilesets
    if !post_combos.trim().is_empty() {
        result.push(String::new());
        result.push("# Post Combination Actors".to_string());
        result.push(post_combos);
    }

    // Footer at the very end
    if !footer.trim().is_empty() {
        result.push(String::new());
        result.push("# Footer".to_string());
        result.push(footer);
    }

    result.join("\n")
}

/// Replace the talents= line in a simc input string with a new talent string.
fn apply_talent_override(simc_input: &str, talents: &str) -> String {
    if talents.is_empty() {
        return simc_input.to_string();
    }
    let re = regex::Regex::new(r"(?m)^talents=.+$").unwrap();
    if re.is_match(simc_input) {
        re.replace(simc_input, format!("talents={}", talents)).to_string()
    } else {
        format!("{}\ntalents={}", simc_input, talents)
    }
}

/// Extract server= (realm) from a simc input string and inject it into a parsed result.
fn inject_realm(parsed: &mut Value, simc_input: &str) {
    for line in simc_input.lines() {
        if let Some(val) = line.trim().strip_prefix("server=") {
            parsed["realm"] = json!(val);
            break;
        }
    }
}

/// Spawn a staged (top-gear / droptimizer) simulation in a background task.
fn spawn_staged_sim(
    store: Arc<dyn JobStorage>,
    simc: PathBuf,
    options: Value,
    job_id: String,
    simc_input: String,
    combo_count: usize,
) {
    tokio::spawn(async move {
        store.update_status(&job_id, JobStatus::Running);
        let store_progress = store.clone();
        let store_stages = store.clone();
        let jid_progress = job_id.clone();
        let jid_stages = job_id.clone();
        match simc_runner::run_simc_staged(
            &simc,
            &job_id,
            &simc_input,
            &options,
            combo_count,
            move |pct, stage, detail| {
                store_progress.update_progress(&jid_progress, pct, stage, detail);
            },
            move |summary| {
                store_stages.complete_stage(&jid_stages, summary);
            },
        )
        .await
        {
            Ok(output) => {
                let job_snap = store.get(&job_id);
                let meta: Option<HashMap<String, Vec<Value>>> = job_snap
                    .as_ref()
                    .and_then(|j| j.combo_metadata_json.as_ref())
                    .and_then(|s| serde_json::from_str::<Value>(s).ok())
                    .and_then(|v| v.get("_combo_metadata").cloned())
                    .and_then(|v| serde_json::from_value(v).ok());

                let mut parsed = result_parser::parse_top_gear_result(&output.json, meta.as_ref());
                inject_realm(&mut parsed, &simc_input);
                let result_str = serde_json::to_string(&parsed).unwrap_or_default();
                let raw_str = serde_json::to_string(&output.json).ok();
                store.set_result(&job_id, result_str, raw_str);
                store.set_report_files(&job_id, output.html_report, output.text_output);
            }
            Err(e) => {
                store.set_error(&job_id, e);
            }
        }
    });
}

// ---------- Handlers ----------

async fn create_sim(
    req: web::Json<SimRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
) -> HttpResponse {
    let mut simc_input = if req.max_upgrade {
        game_data::upgrade_simc_input(&req.simc_input)
    } else {
        req.simc_input.clone()
    };
    simc_input = apply_talent_override(&simc_input, &req.options.talents);
    simc_input = inject_expert_fields(&simc_input, &req.options);

    let job = Job::new(
        simc_input.clone(),
        req.sim_type.clone(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();
    store.insert(job);

    // Spawn background task
    let store_clone = store.get_ref().clone();
    let simc = simc_path.get_ref().clone();
    let options = req.options.to_json_with_sim_type(&req.sim_type);
    let job_id_clone = job_id.clone();

    tokio::spawn(async move {
        store_clone.update_status(&job_id_clone, JobStatus::Running);
        store_clone.update_progress(&job_id_clone, 20, "Simulating", "");
        match simc_runner::run_simc(&simc, &job_id_clone, &simc_input, &options).await {
            Ok(output) => {
                let mut parsed = result_parser::parse_simc_result(&output.json);
                inject_realm(&mut parsed, &simc_input);
                let result_str = serde_json::to_string(&parsed).unwrap_or_default();
                let raw_str = serde_json::to_string(&output.json).ok();
                store_clone.set_result(&job_id_clone, result_str, raw_str);
                store_clone.set_report_files(&job_id_clone, output.html_report, output.text_output);
            }
            Err(e) => {
                store_clone.set_error(&job_id_clone, e);
            }
        }
    });

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}

async fn create_top_gear_sim(
    req: web::Json<TopGearRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
) -> HttpResponse {
    let mut simc_input = if req.max_upgrade {
        game_data::upgrade_simc_input(&req.simc_input)
    } else {
        req.simc_input.clone()
    };
    simc_input = apply_talent_override(&simc_input, &req.options.talents);

    let parsed = addon_parser::parse_addon_string(&simc_input);
    let base_profile = parsed
        .get("base_profile")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let mut items_by_slot: HashMap<String, Vec<Value>> = if let Some(ref ibs) = req.items_by_slot {
        ibs.clone()
    } else {
        // Extract from parsed addon string
        let ibs_val = parsed.get("items_by_slot").cloned().unwrap_or(json!({}));
        serde_json::from_value(ibs_val).unwrap_or_default()
    };

    if req.max_upgrade {
        items_by_slot = game_data::upgrade_items_by_slot(&items_by_slot);
    }

    if req.copy_enchants {
        items_by_slot = game_data::apply_copy_enchants(&items_by_slot);
    }

    let (generated_input, combo_count, combo_metadata) =
        match profileset_generator::generate_top_gear_input(
            &base_profile,
            &items_by_slot,
            &req.selected_items,
        ) {
            Ok(r) => r,
            Err(e) => {
                return HttpResponse::BadRequest().json(json!({"detail": e}));
            }
        };

    if combo_count == 0 {
        return HttpResponse::BadRequest().json(json!({
            "detail": "No alternative items selected. Select at least one non-equipped item."
        }));
    }

    let generated_input = inject_expert_fields(&generated_input, &req.options);

    let job = Job::new(
        generated_input.clone(),
        "top_gear".to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    // Store combo metadata on the job
    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
    }))
    .unwrap_or_default();

    let mut job = job;
    job.combo_metadata_json = Some(meta_json);
    store.insert(job);

    spawn_staged_sim(
        store.get_ref().clone(),
        simc_path.get_ref().clone(),
        req.options.to_json(),
        job_id.clone(),
        generated_input,
        combo_count,
    );

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}

async fn create_droptimizer_sim(
    req: web::Json<DroptimizerRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
) -> HttpResponse {
    let simc_input = apply_talent_override(&req.simc_input, &req.options.talents);
    let parsed = addon_parser::parse_addon_string(&simc_input);
    let base_profile = parsed
        .get("base_profile")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let (generated_input, combo_count, combo_metadata) =
        profileset_generator::generate_droptimizer_input(&base_profile, &req.drop_items);

    if combo_count == 0 {
        return HttpResponse::BadRequest().json(json!({
            "detail": "No items selected. Select at least one drop item."
        }));
    }

    let generated_input = inject_expert_fields(&generated_input, &req.options);

    let job = Job::new(
        generated_input.clone(),
        "droptimizer".to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
    }))
    .unwrap_or_default();

    let mut job = job;
    job.combo_metadata_json = Some(meta_json);
    store.insert(job);

    spawn_staged_sim(
        store.get_ref().clone(),
        simc_path.get_ref().clone(),
        req.options.to_json(),
        job_id.clone(),
        generated_input,
        combo_count,
    );

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}

#[derive(Debug, Deserialize)]
struct ListSimsQuery {
    #[serde(default)]
    player: String,
    #[serde(default)]
    realm: String,
}

#[cfg(feature = "desktop")]
async fn list_sims(
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let summaries = store.list_recent(20, None, None);
    HttpResponse::Ok().json(summaries)
}

#[cfg(not(feature = "desktop"))]
async fn list_sims_filtered(
    query: web::Query<ListSimsQuery>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    if query.player.is_empty() || query.realm.is_empty() {
        return HttpResponse::BadRequest().json(json!({"detail": "player and realm are required"}));
    }
    let summaries = store.list_recent(20, Some(&query.player), Some(&query.realm));
    HttpResponse::Ok().json(summaries)
}

async fn get_sim_status(
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match store.get(&job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    let status_str = match job.status {
        JobStatus::Pending => "pending",
        JobStatus::Running => "running",
        JobStatus::Done => "done",
        JobStatus::Failed => "failed",
    };

    let progress = match job.status {
        JobStatus::Done => 100,
        _ => job.progress_pct as i32,
    };

    let parsed_result: Option<Value> = if job.status == JobStatus::Done {
        job.result_json
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok())
    } else {
        None
    };

    HttpResponse::Ok().json(json!({
        "id": job.id,
        "status": status_str,
        "progress": progress,
        "progress_stage": job.progress_stage,
        "progress_detail": job.progress_detail,
        "stages_completed": job.stages_completed,
        "result": parsed_result,
        "error": job.error_message,
    }))
}

async fn get_sim_input(
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match store.get(&job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    HttpResponse::Ok()
        .content_type("text/plain; charset=utf-8")
        .body(job.simc_input)
}

async fn get_sim_raw(
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match store.get(&job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    match &job.raw_json {
        Some(raw) => match serde_json::from_str::<Value>(raw) {
            Ok(val) => HttpResponse::Ok().json(val),
            Err(_) => HttpResponse::InternalServerError()
                .json(json!({"detail": "Failed to parse stored raw JSON"})),
        },
        None => {
            // Fallback to parsed result if raw not available
            match &job.result_json {
                Some(result) => match serde_json::from_str::<Value>(result) {
                    Ok(val) => HttpResponse::Ok().json(val),
                    Err(_) => HttpResponse::InternalServerError()
                        .json(json!({"detail": "Failed to parse stored result"})),
                },
                None => HttpResponse::NotFound().json(json!({"detail": "No results available yet"})),
            }
        }
    }
}

async fn get_sim_html(
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match store.get(&job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    match &job.html_report {
        Some(html) => HttpResponse::Ok()
            .content_type("text/html; charset=utf-8")
            .body(html.clone()),
        None => HttpResponse::NotFound()
            .json(json!({"detail": "HTML report not available for this sim"})),
    }
}

async fn get_sim_text_output(
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match store.get(&job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    match &job.text_output {
        Some(text) => HttpResponse::Ok()
            .content_type("text/plain; charset=utf-8")
            .body(text.clone()),
        None => HttpResponse::NotFound()
            .json(json!({"detail": "Text output not available for this sim"})),
    }
}

async fn get_sim_csv(
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let job_id = path.into_inner();
    let job = match store.get(&job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    let result = match &job.result_json {
        Some(r) => match serde_json::from_str::<Value>(r) {
            Ok(v) => v,
            Err(_) => return HttpResponse::InternalServerError()
                .json(json!({"detail": "Failed to parse result"})),
        },
        None => return HttpResponse::NotFound()
            .json(json!({"detail": "No results available yet"})),
    };

    let mut csv = String::from("actor,dps,dps_error\n");

    if result.get("type").and_then(|t| t.as_str()) == Some("top_gear") {
        // Top Gear / Droptimizer: base + profileset results
        if let Some(base_dps) = result.get("base_dps").and_then(|v| v.as_f64()) {
            let name = result.get("player_name").and_then(|n| n.as_str()).unwrap_or("Base");
            csv.push_str(&format!("{},{:.1},\n", name, base_dps));
        }
        if let Some(results) = result.get("results").and_then(|r| r.as_array()) {
            for r in results {
                let name = r.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let dps = r.get("dps").and_then(|v| v.as_f64()).unwrap_or(0.0);
                csv.push_str(&format!("{},{:.1},\n", name, dps));
            }
        }
    } else {
        // Quick Sim
        let name = result.get("player_name").and_then(|n| n.as_str()).unwrap_or("Player");
        let dps = result.get("dps").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let error = result.get("dps_error").and_then(|v| v.as_f64()).unwrap_or(0.0);
        csv.push_str(&format!("{},{:.1},{:.1}\n", name, dps, error));
    }

    HttpResponse::Ok()
        .content_type("text/csv; charset=utf-8")
        .insert_header(("Content-Disposition", format!("attachment; filename=\"sim-{}.csv\"", job_id)))
        .body(csv)
}

async fn get_item_info(
    path: web::Path<u64>,
    query: web::Query<BonusIdsQuery>,
) -> HttpResponse {
    let item_id = path.into_inner();
    let bonus_list: Vec<u64> = if query.bonus_ids.is_empty() {
        Vec::new()
    } else {
        query
            .bonus_ids
            .split(',')
            .filter_map(|s| s.trim().parse().ok())
            .collect()
    };

    let bonus_ref = if bonus_list.is_empty() {
        None
    } else {
        Some(bonus_list.as_slice())
    };

    let result = game_data::get_item_info(item_id, bonus_ref).unwrap_or_else(|| {
        json!({
            "item_id": item_id,
            "name": format!("Item {}", item_id),
            "quality": 1,
            "quality_name": "common",
            "icon": "inv_misc_questionmark",
            "ilevel": 0,
        })
    });

    HttpResponse::Ok().json(result)
}

async fn get_item_info_batch(
    req: web::Json<ItemInfoBatchRequest>,
) -> HttpResponse {
    let mut items_list = req.items.clone();
    if items_list.is_empty() && !req.item_ids.is_empty() {
        items_list = req
            .item_ids
            .iter()
            .map(|iid| json!({"item_id": iid}))
            .collect();
    }

    if items_list.is_empty() || items_list.len() > 100 {
        return HttpResponse::BadRequest().json(json!({"detail": "Provide 1-100 items"}));
    }

    let mut seen = std::collections::HashSet::new();
    let mut unique_items: Vec<(u64, Vec<u64>)> = Vec::new();

    for item in &items_list {
        let iid = item
            .get("item_id")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let bonus: Vec<u64> = item
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|b| b.as_u64()).collect())
            .unwrap_or_default();
        let mut sorted_bonus = bonus.clone();
        sorted_bonus.sort();
        let key = format!(
            "{}:{}",
            iid,
            sorted_bonus
                .iter()
                .map(|b| b.to_string())
                .collect::<Vec<_>>()
                .join(":")
        );
        if seen.insert(key) {
            unique_items.push((iid, bonus));
        }
    }

    let mut results: HashMap<String, Value> = HashMap::new();
    for (iid, bonus) in &unique_items {
        let bonus_ref = if bonus.is_empty() {
            None
        } else {
            Some(bonus.as_slice())
        };
        let info = game_data::get_item_info(*iid, bonus_ref).unwrap_or_else(|| {
            json!({
                "item_id": iid,
                "name": format!("Item {}", iid),
                "quality": 1,
                "quality_name": "common",
                "icon": "inv_misc_questionmark",
                "ilevel": 0,
            })
        });
        results.insert(iid.to_string(), info);
    }

    HttpResponse::Ok().json(results)
}

async fn get_enchant_info(path: web::Path<u64>) -> HttpResponse {
    let enchant_id = path.into_inner();
    let result = game_data::get_enchant_info(enchant_id)
        .unwrap_or_else(|| json!({"enchant_id": enchant_id, "name": ""}));
    HttpResponse::Ok().json(result)
}

async fn get_gem_info(path: web::Path<u64>) -> HttpResponse {
    let gem_id = path.into_inner();
    let result = game_data::get_gem_info(gem_id)
        .unwrap_or_else(|| json!({"gem_id": gem_id, "name": "", "icon": "", "quality": 3}));
    HttpResponse::Ok().json(result)
}

async fn get_max_upgrade_ilevels(body: web::Json<Vec<Value>>) -> HttpResponse {
    let mut results: HashMap<String, u64> = HashMap::new();
    for item in body.iter().take(200) {
        let item_id = item.get("item_id").and_then(|v| v.as_u64()).unwrap_or(0);
        let bonus_ids: Vec<u64> = item
            .get("bonus_ids")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_u64()).collect())
            .unwrap_or_default();
        let upgraded = game_data::upgrade_bonus_ids_to_max(&bonus_ids);
        if let Some(info) = game_data::get_item_info(item_id, Some(&upgraded)) {
            let ilevel = info.get("ilevel").and_then(|v| v.as_u64()).unwrap_or(0);
            let mut sorted_ids = bonus_ids.clone();
            sorted_ids.sort();
            let key = format!(
                "{}:{}",
                item_id,
                sorted_ids.iter().map(|b| b.to_string()).collect::<Vec<_>>().join(",")
            );
            results.insert(key, ilevel);
        }
    }
    HttpResponse::Ok().json(results)
}

async fn list_upgrade_tracks() -> HttpResponse {
    HttpResponse::Ok().json(game_data::get_upgrade_tracks())
}

async fn get_upgrade_options(query: web::Query<BonusIdsQuery>) -> HttpResponse {
    let ids: Vec<u64> = query
        .bonus_ids
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();
    let options = game_data::get_upgrade_options(&ids);
    match options {
        Some(opts) => HttpResponse::Ok().json(json!({"options": opts})),
        None => HttpResponse::Ok().json(json!({"options": []})),
    }
}

async fn health_check() -> HttpResponse {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    HttpResponse::Ok().json(json!({
        "status": "ok",
        "threads": threads,
        "mode": "desktop",
    }))
}

#[cfg(feature = "desktop")]
async fn system_stats(stats: web::Data<Arc<Mutex<SystemStats>>>) -> HttpResponse {
    let mut s = stats.lock().unwrap();
    s.refresh();
    let cpu = s.cpu_usage();
    HttpResponse::Ok().json(json!({
        "cpu_usage": (cpu * 10.0).round() / 10.0,
    }))
}

async fn list_instances() -> HttpResponse {
    HttpResponse::Ok().json(game_data::get_instances())
}

#[derive(Debug, Deserialize)]
struct DropsQuery {
    #[serde(default)]
    class_name: String,
    #[serde(default)]
    spec: String,
}

async fn get_drops_by_type(path: web::Path<String>, query: web::Query<DropsQuery>) -> HttpResponse {
    let instance_type = path.into_inner();
    let class_name = if query.class_name.is_empty() { None } else { Some(query.class_name.as_str()) };
    let spec = if query.spec.is_empty() { None } else { Some(query.spec.as_str()) };
    match game_data::get_drops_by_type(&instance_type, class_name, spec) {
        Some(drops) => HttpResponse::Ok().json(drops),
        None => HttpResponse::NotFound().json(json!({"detail": "No drops found for this instance type"})),
    }
}

async fn get_instance_drops(path: web::Path<i64>, query: web::Query<DropsQuery>) -> HttpResponse {
    let instance_id = path.into_inner();
    let class_name = if query.class_name.is_empty() { None } else { Some(query.class_name.as_str()) };
    let spec = if query.spec.is_empty() { None } else { Some(query.spec.as_str()) };
    match game_data::get_instance_drops(instance_id, class_name, spec) {
        Some(drops) => HttpResponse::Ok().json(drops),
        None => HttpResponse::NotFound().json(json!({"detail": "Instance not found or has no drops"})),
    }
}

/// SPA fallback: serve the appropriate HTML file for client-side routes
async fn spa_fallback(req: HttpRequest, frontend_dir: web::Data<FrontendDir>) -> actix_web::Result<NamedFile> {
    let path = req.path();

    // Try exact file match first (e.g., /quick-sim -> quick-sim.html)
    let trimmed = path.trim_start_matches('/');
    let html_path = frontend_dir.0.join(format!("{}.html", trimmed));
    if html_path.exists() {
        return Ok(NamedFile::open(html_path)?);
    }

    // /sim/{id} -> sim/_.html (the placeholder page)
    if path.starts_with("/sim/") {
        let sim_html = frontend_dir.0.join("sim").join("_.html");
        if sim_html.exists() {
            return Ok(NamedFile::open(sim_html)?);
        }
    }

    // Fallback to index.html
    Ok(NamedFile::open(frontend_dir.0.join("index.html"))?)
}

/// Start the HTTP server with in-memory storage (desktop default).
pub async fn start(resource_dir: &Path, frontend_dir: Option<PathBuf>) -> u16 {
    let simc_path = if cfg!(windows) {
        resource_dir.join("simc").join("simc.exe")
    } else {
        resource_dir.join("simc").join("simc")
    };
    let storage: Arc<dyn JobStorage> = Arc::new(
        crate::storage::memory::MemoryStorage::new()
    );
    start_with_storage(storage, simc_path, 17384, frontend_dir).await
}

/// Start the actix-web HTTP server with a given storage backend.
/// Returns the port number.
pub async fn start_with_storage(
    storage: Arc<dyn JobStorage>,
    simc_path: PathBuf,
    port: u16,
    frontend_dir: Option<PathBuf>,
) -> u16 {
    start_with_storage_bind(storage, simc_path, "127.0.0.1", port, frontend_dir).await
}

/// Start the actix-web HTTP server with a given storage backend and bind address.
/// Returns the port number.
pub async fn start_with_storage_bind(
    storage: Arc<dyn JobStorage>,
    simc_path: PathBuf,
    bind_host: &str,
    port: u16,
    frontend_dir: Option<PathBuf>,
) -> u16 {
    let store_data = web::Data::new(storage);
    let simc_data = web::Data::new(simc_path);
    #[cfg(feature = "desktop")]
    let stats_data = web::Data::new(Arc::new(Mutex::new(SystemStats::new())));
    let frontend = frontend_dir.clone();

    let bind_addr = format!("{}:{}", bind_host, port);

    let server = HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        let mut app = App::new()
            .wrap(cors)
            .app_data(store_data.clone())
            .app_data(simc_data.clone());
        #[cfg(feature = "desktop")]
        { app = app.app_data(stats_data.clone()); }
        let mut app = app
            .route("/api/sim", web::post().to(create_sim))
            .route("/api/top-gear/sim", web::post().to(create_top_gear_sim))
            .route("/api/sim/{id}", web::get().to(get_sim_status))
            .route("/api/sim/{id}/raw", web::get().to(get_sim_raw))
            .route("/api/sim/{id}/input", web::get().to(get_sim_input))
            .route("/api/sim/{id}/html", web::get().to(get_sim_html))
            .route("/api/sim/{id}/output.txt", web::get().to(get_sim_text_output))
            .route("/api/sim/{id}/data.csv", web::get().to(get_sim_csv))
            .route("/api/item-info/{id}", web::get().to(get_item_info))
            .route("/api/item-info/batch", web::post().to(get_item_info_batch))
            .route("/api/enchant-info/{id}", web::get().to(get_enchant_info))
            .route("/api/gem-info/{id}", web::get().to(get_gem_info))
            .route("/api/max-upgrade-ilevels", web::post().to(get_max_upgrade_ilevels))
            .route("/api/upgrade-options", web::get().to(get_upgrade_options))
            .route("/api/upgrade-tracks", web::get().to(list_upgrade_tracks))
            .route("/api/droptimizer/sim", web::post().to(create_droptimizer_sim))
            .route("/api/instances", web::get().to(list_instances))
            .route("/api/instances/type/{type}/drops", web::get().to(get_drops_by_type))
            .route("/api/instances/{id}/drops", web::get().to(get_instance_drops))
            .route("/health", web::get().to(health_check));
        #[cfg(feature = "desktop")]
        {
            app = app
                .route("/api/sims", web::get().to(list_sims))
                .route("/api/system-stats", web::get().to(system_stats));
        }
        #[cfg(not(feature = "desktop"))]
        {
            app = app.route("/api/sims", web::get().to(list_sims_filtered));
        }

        // Serve static frontend files in production (not in dev mode)
        if let Some(ref dir) = frontend {
            app = app
                .app_data(web::Data::new(FrontendDir(dir.clone())))
                .service(
                    actix_files::Files::new("/_next", dir.join("_next"))
                        .prefer_utf8(true)
                )
                .default_service(web::get().to(spa_fallback));
        }

        app
    })
    .bind(&bind_addr)
    .expect(&format!("Failed to bind to {}", bind_addr))
    .run();

    tokio::spawn(server);

    println!("HTTP server started on port {}", port);
    port
}
