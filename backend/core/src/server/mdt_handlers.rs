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
        hp_percent: body.hp_percent.unwrap_or(20),
    };
    match mdt::convert(&body.import, db, &opts) {
        Ok(out) => HttpResponse::Ok().json(out),
        Err(e) => HttpResponse::BadRequest().json(json!({ "error": e })),
    }
}
