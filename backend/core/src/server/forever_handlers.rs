use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;

use actix_web::{web, HttpResponse};
use serde::Deserialize;
use serde_json::json;

use super::types::SimResponse;
use crate::cancel::CancelToken;
use crate::compute::local::{await_local_queue_permit, LocalSimQueue};
use crate::db::JobRepo;
use crate::forever::import::{
    parse_export_with, summarize_with, ExportItem, ForeverCharacter, ImportSummary,
};
use crate::forever::request::{bulk_request, raid_request, SimSettings};
use crate::forever::result::{
    add_armory_character, compare_result, engine_error, gear_result, quick_result, ResultMeta,
};
use crate::forever::{detect_game, runner, spec, ForeverData, ForeverEngine, Game};
use crate::log_buffer::LogBuffer;
use crate::models::{Job, JobStatus};

type Engine = web::Data<Option<Arc<ForeverEngine>>>;

#[derive(Deserialize)]
pub(super) struct ImportRequest {
    simc_input: String,
    /// Talents edited in the calculator, in place of the export's.
    talents_string: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct BagItem {
    item_id: u32,
    #[serde(default)]
    enchant_id: u32,
    #[serde(default)]
    random_suffix: u32,
}

#[derive(Deserialize)]
pub(super) struct ForeverSimRequest {
    simc_input: String,
    spec_key: Option<String>,
    iterations: Option<u32>,
    max_time: Option<f64>,
    #[serde(default)]
    bag_items: Vec<BagItem>,
    /// Ids of the buffs and debuffs to run with; without it the build's own set runs.
    buffs: Option<Vec<String>>,
    consumables: Option<bool>,
    /// Talents edited in the calculator, in place of the export's.
    talents_string: Option<String>,
    /// Talent compare: the builds to sim side by side, the first one the baseline.
    #[serde(default)]
    builds: Vec<TalentBuild>,
}

#[derive(Deserialize)]
pub(super) struct TalentBuild {
    name: String,
    talents_string: String,
}

const MAX_TALENT_BUILDS: usize = 12;

#[derive(Debug)]
pub(super) struct Prepared {
    pub character: ForeverCharacter,
    pub summary: ImportSummary,
    pub spec_key: String,
}

pub(super) fn prepare(
    simc_input: &str,
    spec_key: Option<&str>,
    edited_talents: Option<&str>,
    data: &ForeverData,
) -> Result<Prepared, String> {
    if detect_game(simc_input) != Game::Forever {
        return Err("This is not a WoW Forever export".into());
    }
    let character = parse_export_with(simc_input, data)?;
    let summary = summarize_with(&character, data, edited_talents);
    let spec_key = match spec_key {
        Some(key) if spec::spec_choices(&character.class).contains(&key) => Some(key.to_string()),
        Some(key) => return Err(format!("{key} is not a {} spec", character.class)),
        None => summary.spec_key.clone(),
    };
    if let Some(reason) = spec::blocked_reason(
        character.level,
        character.sheet.is_some(),
        spec_key.as_deref(),
    ) {
        return Err(reason);
    }
    let spec_key = spec_key.expect("blocked_reason refuses a missing spec");
    Ok(Prepared {
        character,
        summary,
        spec_key,
    })
}

fn engine_or_503(engine: &Engine) -> Result<Arc<ForeverEngine>, HttpResponse> {
    engine.get_ref().clone().ok_or_else(|| {
        HttpResponse::ServiceUnavailable().json(json!({ "detail": "Forever engine not installed" }))
    })
}

pub(super) async fn import(body: web::Json<ImportRequest>, engine: Engine) -> HttpResponse {
    let engine = match engine_or_503(&engine) {
        Ok(e) => e,
        Err(resp) => return resp,
    };
    if detect_game(&body.simc_input) != Game::Forever {
        return HttpResponse::BadRequest()
            .json(json!({ "detail": "This is not a WoW Forever export" }));
    }
    match parse_export_with(&body.simc_input, &engine.data) {
        Ok(ch) => {
            let summary = summarize_with(&ch, &engine.data, body.talents_string.as_deref());
            let options = sim_options(&engine, &summary).await;
            let mut body = serde_json::to_value(&summary).unwrap_or_default();
            body["sim_options"] = options;
            HttpResponse::Ok().json(body)
        }
        Err(e) => HttpResponse::BadRequest().json(json!({ "detail": e })),
    }
}

/// Per spec the character can sim as: the buffs and debuffs with the build's starting state.
/// Empty with an engine that has no `options` command; the settings block shows Auto then.
async fn sim_options(engine: &ForeverEngine, summary: &ImportSummary) -> serde_json::Value {
    let request = json!({
        "specKeys": summary.spec_choices,
        "talentsString": summary.talents_string,
        "level": summary.level,
    });
    let (_keep, never) = tokio::sync::watch::channel(false);
    runner::run_cli(
        &engine.binary,
        "options",
        &request,
        &[],
        never,
        |_| {},
        |_| {},
    )
    .await
    .unwrap_or_else(|_| json!({}))
}

/// The raw result as kept with the job: without the fight log and the per-fight values, which
/// are megabytes and already read into the result.
fn slim_raw(mut raw: serde_json::Value) -> serde_json::Value {
    if let Some(top) = raw.as_object_mut() {
        top.remove("logs");
    }
    let unit = &mut raw["raidMetrics"]["parties"][0]["players"][0];
    for metric in ["dps", "hps", "dtps", "tmi", "threat", "tto"] {
        if let Some(values) = unit.get_mut(metric).and_then(|m| m.as_object_mut()) {
            values.remove("allValues");
        }
    }
    raw
}

/// Once a second: writes the latest progress when it moved (one ordered writer, at most one
/// write a second) and flips the watch to true once the job is cancelled.
fn watch_job(
    repo: Arc<JobRepo>,
    id: String,
    progress: Arc<AtomicU8>,
) -> (
    tokio::sync::watch::Receiver<bool>,
    tokio::task::JoinHandle<()>,
) {
    let (tx, rx) = tokio::sync::watch::channel(false);
    let handle = tokio::spawn(async move {
        let mut written = 0u8;
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if let Ok(Some(summary)) = repo.get_status_summary(&id).await {
                if summary.status == JobStatus::Cancelled {
                    let _ = tx.send(true);
                    return;
                }
            }
            let pct = progress.load(Ordering::Relaxed);
            if pct > written {
                written = pct;
                let _ = repo
                    .update_progress(&id, pct.max(5), "Simulating", "")
                    .await;
            }
        }
    });
    (rx, handle)
}

async fn start_job(
    req: ForeverSimRequest,
    sim_type: &'static str,
    engine: Engine,
    repo: web::Data<JobRepo>,
    logs: web::Data<Arc<LogBuffer>>,
    queue: web::Data<LocalSimQueue>,
) -> HttpResponse {
    let engine = match engine_or_503(&engine) {
        Ok(e) => e,
        Err(resp) => return resp,
    };
    let prepared = match prepare(
        &req.simc_input,
        req.spec_key.as_deref(),
        req.talents_string.as_deref(),
        &engine.data,
    ) {
        Ok(p) => p,
        Err(e) => return HttpResponse::BadRequest().json(json!({ "detail": e })),
    };
    let settings = SimSettings {
        iterations: req.iterations.unwrap_or(12_500).clamp(1_000, 50_000),
        duration_seconds: req.max_time.unwrap_or(120.0).clamp(30.0, 900.0),
    };
    let mut base = raid_request(
        &prepared.character,
        &engine.data,
        &prepared.spec_key,
        &prepared.summary.talents_string,
        &settings,
    );
    // The engine runner turns these into the sets its engine reads.
    if let Some(buffs) = &req.buffs {
        base["simhammer"]["buffs"] = json!(buffs);
    }
    if let Some(consumables) = req.consumables {
        base["simhammer"]["consumables"] = json!(consumables);
    }
    let worn_gear = base["raid"]["parties"][0]["players"][0]["equipment"]["items"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let (command, request, extra) = if sim_type == "top_gear" {
        let bags: Vec<ExportItem> = req
            .bag_items
            .iter()
            .map(|b| ExportItem {
                slot: String::new(),
                item_id: b.item_id,
                enchant_id: b.enchant_id,
                random_suffix: b.random_suffix,
            })
            .collect();
        if bags.is_empty() {
            return HttpResponse::BadRequest()
                .json(json!({ "detail": "Select at least one item to compare" }));
        }
        let max = crate::db::MAX_COMBINATIONS.load(Ordering::Relaxed);
        (
            "bulk",
            bulk_request(base, &bags, &engine.data),
            vec!["--max-combinations".to_string(), max.to_string()],
        )
    } else if sim_type == "talent_compare" {
        if req.builds.len() < 2 || req.builds.len() > MAX_TALENT_BUILDS {
            return HttpResponse::BadRequest().json(json!({
                "detail": format!("Compare 2 to {MAX_TALENT_BUILDS} talent builds")
            }));
        }
        let variants: Vec<serde_json::Value> = req
            .builds
            .iter()
            .map(|b| json!({ "name": b.name, "talentsString": b.talents_string }))
            .collect();
        (
            "compare",
            json!({ "baseRequest": base, "variants": variants }),
            Vec::new(),
        )
    } else {
        // One logged fight for the timeline and every fight's value for the median.
        base["simOptions"]["debugFirstIteration"] = json!(true);
        base["simOptions"]["saveAllValues"] = json!(true);
        ("sim", base, Vec::new())
    };

    let mut job = Job::new(
        req.simc_input.clone(),
        sim_type.to_string(),
        settings.iterations,
        "Patchwerk".into(),
        0.0,
    );
    job.game = "forever".into();
    if let Err(e) = repo.insert(&job).await {
        return HttpResponse::InternalServerError().json(json!({ "detail": e.to_string() }));
    }
    let response = SimResponse {
        id: job.id.clone(),
        status: "pending".into(),
        created_at: job.created_at.clone(),
    };
    let meta = ResultMeta {
        player_name: prepared.character.name.clone(),
        spec_key: prepared.spec_key.clone(),
        fight_length: settings.duration_seconds,
        iterations: settings.iterations,
        engine_commit: engine.data.version.engine_commit.clone(),
        gear: worn_gear,
        settings: json!({
            "level": prepared.character.level,
            "target_level": if prepared.character.level < 60 { prepared.character.level + 2 } else { 63 },
            "talents_string": prepared.summary.talents_string,
            "buffs": req.buffs,
            "consumables": req.consumables,
        }),
    };
    let (repo, logs, queue, id) = (
        repo.into_inner(),
        logs.into_inner(),
        queue.into_inner(),
        job.id,
    );
    let region = prepared.character.region.clone();
    tokio::spawn(async move {
        let token = CancelToken::new((*repo).clone(), id.clone());
        let Ok(_permit) = await_local_queue_permit(&queue, Some(&token)).await else {
            return; // cancelled while queued
        };
        let _ = repo.update_status(&id, JobStatus::Running).await;
        let _ = repo.update_progress(&id, 5, "Simulating", "").await;
        let progress = Arc::new(AtomicU8::new(0));
        let (cancel_rx, job_watch) = watch_job(repo.clone(), id.clone(), progress.clone());
        let (log_id, log_buf) = (id.clone(), logs.clone());
        let outcome = runner::run_cli(
            &engine.binary,
            command,
            &request,
            &extra,
            cancel_rx,
            move |line| log_buf.push_line(&log_id, line.to_string()),
            move |pct| progress.store(pct, Ordering::Relaxed),
        )
        .await;
        job_watch.abort();
        match outcome {
            Ok(raw) => match engine_error(&raw) {
                Some(e) => {
                    let _ = repo.set_error(&id, &e).await;
                }
                None => {
                    let result = match command {
                        "bulk" => Ok(gear_result(&raw, &engine.data, &meta)),
                        "compare" => compare_result(&raw, &meta),
                        _ => Ok(quick_result(&raw, &engine.data, &meta)),
                    };
                    match result {
                        Ok(mut result) => {
                            add_armory_character(&mut result, &region);
                            let raw_text = slim_raw(raw).to_string();
                            let _ = repo
                                .set_result(&id, &result.to_string(), Some(&raw_text))
                                .await;
                        }
                        Err(e) => {
                            let _ = repo.set_error(&id, &e).await;
                        }
                    }
                }
            },
            Err(e) if e == runner::CANCELLED => {}
            Err(e) => {
                let _ = repo.set_error(&id, &e).await;
            }
        }
        logs.remove(&id);
    });
    HttpResponse::Ok().json(response)
}

pub(super) async fn create_sim(
    body: web::Json<ForeverSimRequest>,
    engine: Engine,
    repo: web::Data<JobRepo>,
    logs: web::Data<Arc<LogBuffer>>,
    queue: web::Data<LocalSimQueue>,
) -> HttpResponse {
    start_job(body.into_inner(), "quick", engine, repo, logs, queue).await
}

pub(super) async fn create_top_gear(
    body: web::Json<ForeverSimRequest>,
    engine: Engine,
    repo: web::Data<JobRepo>,
    logs: web::Data<Arc<LogBuffer>>,
    queue: web::Data<LocalSimQueue>,
) -> HttpResponse {
    start_job(body.into_inner(), "top_gear", engine, repo, logs, queue).await
}

pub(super) async fn create_talent_compare(
    body: web::Json<ForeverSimRequest>,
    engine: Engine,
    repo: web::Data<JobRepo>,
    logs: web::Data<Arc<LogBuffer>>,
    queue: web::Data<LocalSimQueue>,
) -> HttpResponse {
    start_job(
        body.into_inner(),
        "talent_compare",
        engine,
        repo,
        logs,
        queue,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(level: u32) -> String {
        include_str!("../forever/testdata/sylfrey.simc")
            .replace("level=27", &format!("level={level}"))
    }

    #[tokio::test]
    async fn watch_job_writes_progress_once_a_second_and_sees_cancel() {
        let repo = Arc::new(JobRepo::new_memory());
        let job = Job::new("x".into(), "quick".into(), 100, "Patchwerk".into(), 0.0);
        repo.insert(&job).await.unwrap();
        let progress = Arc::new(AtomicU8::new(0));
        let (mut cancelled, handle) = watch_job(repo.clone(), job.id.clone(), progress.clone());
        progress.store(42, Ordering::Relaxed);
        tokio::time::sleep(Duration::from_millis(1300)).await;
        assert_eq!(repo.get(&job.id).await.unwrap().unwrap().progress_pct, 42);
        repo.update_status(&job.id, JobStatus::Cancelled)
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(3), cancelled.wait_for(|c| *c))
            .await
            .expect("cancel seen within 3 s")
            .unwrap();
        handle.abort();
    }

    #[test]
    fn below_60_without_a_sheet_is_refused() {
        let err = prepare(&input(27), None, None, crate::forever::test_data()).unwrap_err();
        assert!(
            err.starts_with("Below level 60 the sim needs your character stats"),
            "{err}"
        );
    }

    #[test]
    fn spec_from_another_class_is_refused() {
        let err = prepare(&input(60), Some("mage"), None, crate::forever::test_data()).unwrap_err();
        assert_eq!(err, "mage is not a paladin spec");
    }

    #[test]
    fn explicit_supported_spec_overrides_the_derived_one() {
        let p = prepare(
            &input(60),
            Some("retributionPaladin"),
            None,
            crate::forever::test_data(),
        )
        .unwrap();
        assert_eq!(p.spec_key, "retributionPaladin");
    }

    #[test]
    fn a_healer_spec_can_be_picked() {
        let prepared = prepare(
            &input(60),
            Some("holyPaladin"),
            None,
            crate::forever::test_data(),
        )
        .unwrap();
        assert_eq!(prepared.spec_key, "holyPaladin");
    }

    #[test]
    fn retail_input_is_refused() {
        let err = prepare(
            "# WoW 12.0.5.66102, TOC 120005\npaladin=\"X\"\n",
            None,
            None,
            crate::forever::test_data(),
        )
        .unwrap_err();
        assert_eq!(err, "This is not a WoW Forever export");
    }
}
