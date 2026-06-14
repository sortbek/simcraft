use actix_web::{web, HttpResponse};
use serde::Deserialize;
use serde_json::json;

use crate::db::{route_repo::CreateRouteRequest, RouteRepo};
use crate::mdt;

#[derive(Deserialize)]
struct CloneRefJson {
    enemy_idx: i64,
    clone_idx: i64,
}

/// Compute the thumbnail shape (normalized pull centroids, JSON) for a route, or
/// `None` when geometry isn't derivable (no MDT db, a keystone.guru SimC paste, a
/// legacy footer, or a decode error). Best-effort: never fails a save/list.
/// Prefers the built pull assignment (matches how the route classifies + sims)
/// and falls back to decoding the MDT string.
fn route_shape(mdt_string: &str, dungeon_idx: Option<i64>, pulls: Option<&str>) -> Option<String> {
    let db = mdt::enemy_db::global()?;
    let opts = mdt::ConvertOptions::default();
    let conv = match (dungeon_idx, pulls) {
        (Some(idx), Some(pulls_json)) => {
            let parsed: Vec<Vec<CloneRefJson>> = serde_json::from_str(pulls_json).ok()?;
            let pulls_vec = parsed
                .into_iter()
                .map(|p| p.into_iter().map(|c| (c.enemy_idx, c.clone_idx)).collect())
                .collect();
            mdt::serialize(idx, pulls_vec, db, &opts).ok()?
        }
        _ if mdt_string.trim_start().starts_with('!') => mdt::convert(mdt_string, db, &opts).ok()?,
        _ => return None,
    };
    let shape = mdt::pull_shape(&conv.map);
    if shape.is_empty() {
        return None;
    }
    serde_json::to_string(&shape).ok()
}

pub(super) async fn list_routes(repo: web::Data<RouteRepo>) -> HttpResponse {
    let mut routes = match repo.list().await {
        Ok(routes) => routes,
        Err(e) => return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    };
    // Backfill thumbnails for routes saved before shapes existed. Each is computed
    // once and persisted, so this is a one-time cost per row; non-derivable rows
    // (SimC/footer) short-circuit without decoding.
    for r in routes.iter_mut() {
        if r.shape.is_none() {
            if let Some(shape) = route_shape(&r.mdt_string, r.dungeon_idx, r.pulls.as_deref()) {
                let _ = repo.update_shape(&r.id, &shape).await;
                r.shape = Some(shape);
            }
        }
    }
    HttpResponse::Ok().json(routes)
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
            .json(json!({"detail": "name and one of mdt_string, dungeon_idx+pulls, or simc are required"}));
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
    let shape = route_shape(req.mdt_string.trim(), req.dungeon_idx, pulls);
    match repo
        .insert(
            req.name.trim(),
            req.mdt_string.trim(),
            simc,
            req.dungeon_idx,
            pulls,
            shape.as_deref(),
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
