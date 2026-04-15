use actix_web::{web, HttpResponse};
use serde_json::json;

use crate::db::{character_repo::UpsertCharacterRequest, CharacterRepo};

pub(super) async fn list_characters(repo: web::Data<CharacterRepo>) -> HttpResponse {
    match repo.list().await {
        Ok(chars) => HttpResponse::Ok().json(chars),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

pub(super) async fn upsert_character(
    req: web::Json<UpsertCharacterRequest>,
    repo: web::Data<CharacterRepo>,
) -> HttpResponse {
    if req.simc_input.trim().is_empty() {
        return HttpResponse::BadRequest().json(json!({"detail": "simc_input is required"}));
    }
    match repo.upsert(req.simc_input.trim()).await {
        Ok(Some(character)) => HttpResponse::Ok().json(character),
        Ok(None) => HttpResponse::BadRequest()
            .json(json!({"detail": "Could not parse character from SimC input"})),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

pub(super) async fn delete_character(
    path: web::Path<String>,
    repo: web::Data<CharacterRepo>,
) -> HttpResponse {
    let id = path.into_inner();
    match repo.delete(&id).await {
        Ok(true) => HttpResponse::Ok().json(json!({"status": "ok"})),
        Ok(false) => HttpResponse::NotFound().json(json!({"detail": "Character not found"})),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

pub(super) async fn get_talent_builds(
    path: web::Path<String>,
    repo: web::Data<CharacterRepo>,
) -> HttpResponse {
    let character_id = path.into_inner();
    match repo.get_talent_builds(&character_id).await {
        Ok(builds) => HttpResponse::Ok().json(builds),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

pub(super) async fn delete_talent_build(
    path: web::Path<String>,
    repo: web::Data<CharacterRepo>,
) -> HttpResponse {
    let id = path.into_inner();
    match repo.delete_talent_build(&id).await {
        Ok(true) => HttpResponse::Ok().json(json!({"status": "ok"})),
        Ok(false) => HttpResponse::NotFound().json(json!({"detail": "Talent build not found"})),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}
