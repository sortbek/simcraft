use actix_web::{web, HttpResponse};
use serde_json::json;

use crate::db::{RouteRepo, route_repo::CreateRouteRequest};

pub(super) async fn list_routes(repo: web::Data<RouteRepo>) -> HttpResponse {
    match repo.list().await {
        Ok(routes) => HttpResponse::Ok().json(routes),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

pub(super) async fn create_route(
    req: web::Json<CreateRouteRequest>,
    repo: web::Data<RouteRepo>,
) -> HttpResponse {
    if req.name.trim().is_empty() || req.mdt_string.trim().is_empty() {
        return HttpResponse::BadRequest()
            .json(json!({"detail": "name and mdt_string are required"}));
    }
    match repo.insert(req.name.trim(), req.mdt_string.trim()).await {
        Ok(route) => HttpResponse::Ok().json(route),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

pub(super) async fn delete_route(
    path: web::Path<String>,
    repo: web::Data<RouteRepo>,
) -> HttpResponse {
    let id = path.into_inner();
    match repo.delete(&id).await {
        Ok(true) => HttpResponse::Ok().json(json!({"status": "ok"})),
        Ok(false) => HttpResponse::NotFound().json(json!({"detail": "Route not found"})),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}
