use actix_web::{web, HttpResponse};
use serde_json::json;

use crate::db::{route_repo::CreateRouteRequest, RouteRepo};

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
    // A route is identified by an MDT string (imported), a dungeon + pull
    // assignment (built on the map), or a pasted SimC block (keystone.guru).
    let has_route = !req.mdt_string.trim().is_empty()
        || (req.dungeon_idx.is_some()
            && req.pulls.as_deref().is_some_and(|p| !p.trim().is_empty()))
        || req.simc.as_deref().is_some_and(|s| !s.trim().is_empty());
    if req.name.trim().is_empty() || !has_route {
        return HttpResponse::BadRequest()
            .json(json!({"detail": "name and either mdt_string or dungeon_idx+pulls are required"}));
    }
    let simc = req.simc.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let pulls = req.pulls.as_deref().map(str::trim).filter(|s| !s.is_empty());
    // A map-built route's pulls must be a JSON array with at least one populated
    // pull — otherwise the saved route would later sim only the placeholder.
    if let Some(p) = pulls {
        let ok = serde_json::from_str::<Vec<Vec<serde_json::Value>>>(p)
            .map(|parsed| parsed.iter().any(|pull| !pull.is_empty()))
            .unwrap_or(false);
        if !ok {
            return HttpResponse::BadRequest()
                .json(json!({"detail": "pulls must be a JSON array with at least one non-empty pull"}));
        }
    }
    match repo
        .insert(
            req.name.trim(),
            req.mdt_string.trim(),
            simc,
            req.dungeon_idx,
            pulls,
        )
        .await
    {
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
