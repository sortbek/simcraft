use actix_web::{web, HttpResponse};
use serde::Deserialize;
use serde_json::json;

use crate::mdt;

#[derive(Deserialize)]
pub(super) struct DecodeMdtRequest {
    /// The MDT export string (e.g. `!DAvYoo...`).
    pub import: String,
}

/// Decode an MDT export string and return the SimC `DungeonRoute` conversion.
pub(super) async fn decode_mdt(body: web::Json<DecodeMdtRequest>) -> HttpResponse {
    let Some(db) = mdt::enemy_db::global() else {
        return HttpResponse::ServiceUnavailable()
            .json(json!({ "error": "MDT dungeon database not loaded" }));
    };
    match mdt::convert(&body.import, db) {
        Ok(out) => HttpResponse::Ok().json(out),
        Err(e) => HttpResponse::BadRequest().json(json!({ "error": e })),
    }
}
