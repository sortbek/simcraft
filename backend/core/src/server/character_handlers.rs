use actix_web::{web, HttpResponse};
use serde_json::json;
use std::sync::Arc;

use crate::character_store::{CharacterStore, UpsertCharacterRequest};

pub(super) async fn list_characters(store: web::Data<Arc<CharacterStore>>) -> HttpResponse {
    HttpResponse::Ok().json(store.list())
}

pub(super) async fn upsert_character(
    req: web::Json<UpsertCharacterRequest>,
    store: web::Data<Arc<CharacterStore>>,
) -> HttpResponse {
    if req.simc_input.trim().is_empty() {
        return HttpResponse::BadRequest().json(json!({"detail": "simc_input is required"}));
    }
    match store.upsert(req.simc_input.trim()) {
        Some(character) => HttpResponse::Ok().json(character),
        None => HttpResponse::BadRequest()
            .json(json!({"detail": "Could not parse character from SimC input"})),
    }
}

pub(super) async fn delete_character(
    path: web::Path<String>,
    store: web::Data<Arc<CharacterStore>>,
) -> HttpResponse {
    let id = path.into_inner();
    if store.delete(&id) {
        HttpResponse::Ok().json(json!({"status": "ok"}))
    } else {
        HttpResponse::NotFound().json(json!({"detail": "Character not found"}))
    }
}

pub(super) async fn get_talent_builds(
    path: web::Path<String>,
    store: web::Data<Arc<CharacterStore>>,
) -> HttpResponse {
    let character_id = path.into_inner();
    HttpResponse::Ok().json(store.get_talent_builds(&character_id))
}

pub(super) async fn delete_talent_build(
    path: web::Path<String>,
    store: web::Data<Arc<CharacterStore>>,
) -> HttpResponse {
    let id = path.into_inner();
    if store.delete_talent_build(&id) {
        HttpResponse::Ok().json(json!({"status": "ok"}))
    } else {
        HttpResponse::NotFound().json(json!({"detail": "Talent build not found"}))
    }
}
