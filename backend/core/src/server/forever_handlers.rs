use std::sync::atomic::Ordering;
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
    parse_export, summarize, ExportItem, ForeverCharacter, ImportSummary,
};
use crate::forever::request::{bulk_request, raid_request, SimSettings};
use crate::forever::result::{engine_error, gear_result, quick_result, ResultMeta};
use crate::forever::{detect_game, runner, spec, ForeverData, ForeverEngine, Game};
use crate::log_buffer::LogBuffer;
use crate::models::{Job, JobStatus};

type Engine = web::Data<Option<Arc<ForeverEngine>>>;

#[derive(Deserialize)]
pub(super) struct ImportRequest {
    simc_input: String,
}

#[derive(Deserialize)]
pub(super) struct BagItem {
    item_id: u32,
    #[serde(default)]
    enchant_id: u32,
}

#[derive(Deserialize)]
pub(super) struct ForeverSimRequest {
    simc_input: String,
    spec_key: Option<String>,
    iterations: Option<u32>,
    max_time: Option<f64>,
    #[serde(default)]
    bag_items: Vec<BagItem>,
}

#[derive(Debug)]
pub(super) struct Prepared {
    pub character: ForeverCharacter,
    pub summary: ImportSummary,
    pub spec_key: String,
}

pub(super) fn prepare(
    simc_input: &str,
    spec_key: Option<&str>,
    data: &ForeverData,
) -> Result<Prepared, String> {
    if detect_game(simc_input) != Game::Forever {
        return Err("This is not a WoW Forever export".into());
    }
    let character = parse_export(simc_input)?;
    let summary = summarize(&character, data);
    let spec_key = match spec_key {
        Some(key) if spec::spec_choices(&character.class).contains(&key) => Some(key.to_string()),
        Some(key) => return Err(format!("{key} is not a {} spec", character.class)),
        None => summary.spec_key.clone(),
    };
    if let Some(reason) = spec::blocked_reason(character.level, spec_key.as_deref()) {
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
    match parse_export(&body.simc_input) {
        Ok(ch) => HttpResponse::Ok().json(summarize(&ch, &engine.data)),
        Err(e) => HttpResponse::BadRequest().json(json!({ "detail": e })),
    }
}

/// Flips the watch to true once the job is cancelled; ends when the run ends.
fn watch_cancel(
    repo: JobRepo,
    id: String,
) -> (
    tokio::sync::watch::Receiver<bool>,
    tokio::task::JoinHandle<()>,
) {
    let (tx, rx) = tokio::sync::watch::channel(false);
    let token = CancelToken::new(repo, id);
    let handle = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if token.is_cancelled().await {
                let _ = tx.send(true);
                return;
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
    let prepared = match prepare(&req.simc_input, req.spec_key.as_deref(), &engine.data) {
        Ok(p) => p,
        Err(e) => return HttpResponse::BadRequest().json(json!({ "detail": e })),
    };
    let settings = SimSettings {
        iterations: req.iterations.unwrap_or(12_500).clamp(1_000, 50_000),
        duration_seconds: req.max_time.unwrap_or(120.0).clamp(30.0, 900.0),
    };
    let base = raid_request(
        &prepared.character,
        &engine.data,
        &prepared.spec_key,
        &prepared.summary.talents_string,
        &settings,
    );
    let (command, request, extra) = if sim_type == "top_gear" {
        let bags: Vec<ExportItem> = req
            .bag_items
            .iter()
            .map(|b| ExportItem {
                slot: String::new(),
                item_id: b.item_id,
                enchant_id: b.enchant_id,
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
    } else {
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
    };
    let (repo, logs, queue, id) = (
        repo.into_inner(),
        logs.into_inner(),
        queue.into_inner(),
        job.id,
    );
    tokio::spawn(async move {
        let token = CancelToken::new((*repo).clone(), id.clone());
        let Ok(_permit) = await_local_queue_permit(&queue, Some(&token)).await else {
            return; // cancelled while queued
        };
        let _ = repo.update_status(&id, JobStatus::Running).await;
        let _ = repo.update_progress(&id, 5, "Simulating", "").await;
        let (cancel_rx, cancel_watch) = watch_cancel((*repo).clone(), id.clone());
        let (log_id, log_buf) = (id.clone(), logs.clone());
        let (progress_id, progress_repo) = (id.clone(), repo.clone());
        let outcome = runner::run_cli(
            &engine.binary,
            command,
            &request,
            &extra,
            cancel_rx,
            move |line| log_buf.push_line(&log_id, line.to_string()),
            move |pct| {
                let (r, i) = (progress_repo.clone(), progress_id.clone());
                tokio::spawn(async move {
                    let _ = r.update_progress(&i, pct.max(5), "Simulating", "").await;
                });
            },
        )
        .await;
        cancel_watch.abort();
        match outcome {
            Ok(raw) => match engine_error(&raw) {
                Some(e) => {
                    let _ = repo.set_error(&id, &e).await;
                }
                None => {
                    let result = if command == "bulk" {
                        gear_result(&raw, &engine.data, &meta)
                    } else {
                        quick_result(&raw, &engine.data, &meta)
                    };
                    let raw_text = raw.to_string();
                    let _ = repo
                        .set_result(&id, &result.to_string(), Some(&raw_text))
                        .await;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn input(level: u32) -> String {
        include_str!("../forever/testdata/sylfrey.simc")
            .replace("level=27", &format!("level={level}"))
    }

    #[test]
    fn below_60_is_refused() {
        let err = prepare(&input(27), None, crate::forever::test_data()).unwrap_err();
        assert_eq!(err, "Forever sims work from level 60");
    }

    #[test]
    fn spec_from_another_class_is_refused() {
        let err = prepare(&input(60), Some("mage"), crate::forever::test_data()).unwrap_err();
        assert_eq!(err, "mage is not a paladin spec");
    }

    #[test]
    fn explicit_supported_spec_overrides_the_derived_one() {
        let p = prepare(
            &input(60),
            Some("retributionPaladin"),
            crate::forever::test_data(),
        )
        .unwrap();
        assert_eq!(p.spec_key, "retributionPaladin");
    }

    #[test]
    fn healer_spec_is_refused() {
        let err =
            prepare(&input(60), Some("holyPaladin"), crate::forever::test_data()).unwrap_err();
        assert_eq!(err, "holyPaladin is not a paladin spec");
    }

    #[test]
    fn retail_input_is_refused() {
        let err = prepare(
            "# WoW 12.0.5.66102, TOC 120005\npaladin=\"X\"\n",
            None,
            crate::forever::test_data(),
        )
        .unwrap_err();
        assert_eq!(err, "This is not a WoW Forever export");
    }
}
