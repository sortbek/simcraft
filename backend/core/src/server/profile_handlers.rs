use actix_web::{web, HttpResponse};
use serde_json::json;

use crate::db::{sim_profile_repo::UpsertSimProfileRequest, SimProfileRepo};

pub(super) async fn list_profiles(repo: web::Data<SimProfileRepo>) -> HttpResponse {
    match repo.list().await {
        Ok(profiles) => HttpResponse::Ok().json(profiles),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

pub(super) async fn upsert_profile(
    req: web::Json<UpsertSimProfileRequest>,
    repo: web::Data<SimProfileRepo>,
) -> HttpResponse {
    if req.name.trim().is_empty() {
        return HttpResponse::BadRequest().json(json!({"detail": "name is required"}));
    }
    // The blob is opaque but must at least parse, so one corrupt write can't
    // break the list for every later load.
    if serde_json::from_str::<serde_json::Value>(&req.data).is_err() {
        return HttpResponse::BadRequest().json(json!({"detail": "data must be valid JSON"}));
    }
    match repo
        .upsert(req.id.as_deref(), req.name.trim(), &req.data)
        .await
    {
        Ok(Some(profile)) => HttpResponse::Ok().json(profile),
        Ok(None) => HttpResponse::NotFound().json(json!({"detail": "Profile not found"})),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

pub(super) async fn delete_profile(
    path: web::Path<String>,
    repo: web::Data<SimProfileRepo>,
) -> HttpResponse {
    let id = path.into_inner();
    match repo.delete(&id).await {
        Ok(true) => HttpResponse::Ok().json(json!({"status": "ok"})),
        Ok(false) => HttpResponse::NotFound().json(json!({"detail": "Profile not found"})),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}
