use actix_web::{web, HttpResponse};
use serde::Deserialize;
use serde_json::json;

use crate::mdt;

/// The loaded MDT database, or a 503 response when it isn't ready yet.
fn require_db() -> Result<&'static mdt::enemy_db::DungeonDb, HttpResponse> {
    mdt::enemy_db::global().ok_or_else(|| {
        HttpResponse::ServiceUnavailable().json(json!({ "detail": "MDT dungeon database not loaded" }))
    })
}

#[derive(Deserialize)]
pub(super) struct DecodeMdtRequest {
    /// The MDT export string (e.g. `!DAvYoo...`).
    pub import: String,
    /// Keystone level to scale health to; falls back to the string's difficulty.
    #[serde(default)]
    pub keystone_level: Option<i64>,
    /// Percentage of full enemy HP to sim (1–100). Defaults to 27 when absent.
    #[serde(default)]
    pub hp_percent: Option<i64>,
}

/// Decode an MDT export string and return the SimC `DungeonRoute` conversion.
pub(super) async fn decode_mdt(body: web::Json<DecodeMdtRequest>) -> HttpResponse {
    let db = match require_db() {
        Ok(db) => db,
        Err(resp) => return resp,
    };
    let opts = mdt::ConvertOptions {
        keystone_level: body.keystone_level,
        hp_percent: body.hp_percent.unwrap_or(27).clamp(1, 100),
    };
    match mdt::convert(&body.import, db, &opts) {
        Ok(out) => HttpResponse::Ok().json(out),
        Err(e) => HttpResponse::BadRequest().json(json!({ "detail": e })),
    }
}

/// List the current-season dungeons available to browse, as `[{idx, name}]`.
pub(super) async fn list_dungeons() -> HttpResponse {
    let db = match require_db() {
        Ok(db) => db,
        Err(resp) => return resp,
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
    let db = match require_db() {
        Ok(db) => db,
        Err(resp) => return resp,
    };
    let opts = mdt::ConvertOptions {
        keystone_level: query.keystone_level,
        hp_percent: query.hp_percent.unwrap_or(27).clamp(1, 100),
    };
    match mdt::overview(path.into_inner(), db, &opts) {
        Ok(out) => HttpResponse::Ok().json(out),
        Err(e) => HttpResponse::BadRequest().json(json!({ "detail": e })),
    }
}

#[derive(Deserialize)]
pub(super) struct CloneRef {
    pub enemy_idx: i64,
    pub clone_idx: i64,
}

#[derive(Deserialize)]
pub(super) struct SerializeRequest {
    pub dungeon_idx: i64,
    #[serde(default)]
    pub keystone_level: Option<i64>,
    #[serde(default)]
    pub hp_percent: Option<i64>,
    /// Pulls in route order; each a list of clone references.
    pub pulls: Vec<Vec<CloneRef>>,
}

/// Re-serialize an edited/built pull assignment into a SimC DungeonRoute (with
/// delays) — used to sim and save routes made on the map (no MDT string needed).
pub(super) async fn serialize_route(body: web::Json<SerializeRequest>) -> HttpResponse {
    let db = match require_db() {
        Ok(db) => db,
        Err(resp) => return resp,
    };
    let opts = mdt::ConvertOptions {
        keystone_level: body.keystone_level,
        hp_percent: body.hp_percent.unwrap_or(27).clamp(1, 100),
    };
    let pulls: Vec<Vec<(i64, i64)>> = body
        .pulls
        .iter()
        .map(|p| p.iter().map(|c| (c.enemy_idx, c.clone_idx)).collect())
        .collect();
    match mdt::serialize(body.dungeon_idx, pulls, db, &opts) {
        Ok(out) => HttpResponse::Ok().json(out),
        Err(e) => HttpResponse::BadRequest().json(json!({ "detail": e })),
    }
}
