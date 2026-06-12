use actix_web::{web, HttpResponse};
use serde::Deserialize;
use serde_json::json;

use crate::mdt;

#[derive(Deserialize)]
pub(super) struct DecodeMdtRequest {
    /// The MDT export string (e.g. `!DAvYoo...`).
    pub import: String,
    /// Keystone level to scale health to; falls back to the string's difficulty.
    #[serde(default)]
    pub keystone_level: Option<i64>,
    /// Percentage of full enemy HP to sim (1–100). Defaults to 20 when absent.
    #[serde(default)]
    pub hp_percent: Option<i64>,
}

/// Decode an MDT export string and return the SimC `DungeonRoute` conversion.
pub(super) async fn decode_mdt(body: web::Json<DecodeMdtRequest>) -> HttpResponse {
    let Some(db) = mdt::enemy_db::global() else {
        return HttpResponse::ServiceUnavailable()
            .json(json!({ "error": "MDT dungeon database not loaded" }));
    };
    let opts = mdt::ConvertOptions {
        keystone_level: body.keystone_level,
        hp_percent: body.hp_percent.unwrap_or(20).clamp(1, 100),
    };
    match mdt::convert(&body.import, db, &opts) {
        Ok(out) => HttpResponse::Ok().json(out),
        Err(e) => HttpResponse::BadRequest().json(json!({ "error": e })),
    }
}

/// List the current-season dungeons available to browse, as `[{idx, name}]`.
pub(super) async fn list_dungeons() -> HttpResponse {
    let Some(db) = mdt::enemy_db::global() else {
        return HttpResponse::ServiceUnavailable()
            .json(json!({ "error": "MDT dungeon database not loaded" }));
    };
    let dungeons: Vec<_> = db
        .season_dungeons()
        .into_iter()
        .map(|(idx, name)| json!({ "idx": idx, "name": name }))
        .collect();
    HttpResponse::Ok().json(dungeons)
}

#[derive(Deserialize)]
pub(super) struct OverviewQuery {
    /// Keystone level for the displayed (full) enemy health. Optional.
    #[serde(default)]
    pub keystone_level: Option<i64>,
    #[serde(default)]
    pub hp_percent: Option<i64>,
}

/// Return a dungeon overview (the full mob layer, no pulls) by dungeon index, for
/// browsing the map without an imported route.
pub(super) async fn dungeon_overview(
    path: web::Path<i64>,
    query: web::Query<OverviewQuery>,
) -> HttpResponse {
    let Some(db) = mdt::enemy_db::global() else {
        return HttpResponse::ServiceUnavailable()
            .json(json!({ "error": "MDT dungeon database not loaded" }));
    };
    let opts = mdt::ConvertOptions {
        keystone_level: query.keystone_level,
        hp_percent: query.hp_percent.unwrap_or(20).clamp(1, 100),
    };
    match mdt::overview(path.into_inner(), db, &opts) {
        Ok(out) => HttpResponse::Ok().json(out),
        Err(e) => HttpResponse::BadRequest().json(json!({ "error": e })),
    }
}
