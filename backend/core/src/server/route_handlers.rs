use actix_web::{web, HttpResponse};
use serde_json::json;
use std::sync::Arc;

use crate::route_store::{CreateRouteRequest, RouteStore};

pub(super) async fn list_routes(store: web::Data<Arc<RouteStore>>) -> HttpResponse {
    HttpResponse::Ok().json(store.list())
}

pub(super) async fn create_route(
    req: web::Json<CreateRouteRequest>,
    store: web::Data<Arc<RouteStore>>,
) -> HttpResponse {
    if req.name.trim().is_empty() || req.mdt_string.trim().is_empty() {
        return HttpResponse::BadRequest().json(json!({"detail": "name and mdt_string are required"}));
    }
    let route = store.insert(req.name.trim(), req.mdt_string.trim());
    HttpResponse::Ok().json(route)
}

pub(super) async fn delete_route(
    path: web::Path<String>,
    store: web::Data<Arc<RouteStore>>,
) -> HttpResponse {
    let id = path.into_inner();
    if store.delete(&id) {
        HttpResponse::Ok().json(json!({"status": "ok"}))
    } else {
        HttpResponse::NotFound().json(json!({"detail": "Route not found"}))
    }
}
