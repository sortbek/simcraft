use actix_web::{web, HttpResponse};
use serde_json::json;

use super::mdt_handlers::{flatten_pulls, CloneRef};
use crate::db::{route_repo::CreateRouteRequest, RouteRepo};
use crate::mdt;

/// Compute the thumbnail shape (normalized pull centroids, JSON) for a route, or
/// `None` when no geometry is derivable (a keystone.guru SimC paste, a legacy
/// footer, or a decode that resolves no clones). Best-effort: never fails a
/// save/list. Prefers the built pull assignment (matches how the route classifies
/// + sims) and falls back to decoding the MDT string.
fn route_shape(
    db: &mdt::DungeonDb,
    mdt_string: &str,
    dungeon_idx: Option<i64>,
    pulls: Option<&str>,
) -> Option<String> {
    let opts = mdt::ConvertOptions::default();
    let conv = if let (Some(idx), Some(pulls_json)) = (dungeon_idx, pulls) {
        let parsed: Vec<Vec<CloneRef>> = serde_json::from_str(pulls_json).ok()?;
        mdt::serialize(idx, flatten_pulls(&parsed), db, &opts).ok()?
    } else if mdt_string.trim_start().starts_with('!') {
        mdt::convert(mdt_string, db, &opts).ok()?
    } else {
        return None;
    };
    let shape = mdt::pull_shape(&conv.map);
    if shape.is_empty() {
        return None;
    }
    serde_json::to_string(&shape).ok()
}

/// The `shape` value to persist: the computed thumbnail, or an empty-array
/// sentinel (`"[]"`) when no geometry is derivable — so a row without a shape
/// isn't re-decoded on every later list. The frontend treats `[]` the same as a
/// missing shape (falls back to a seeded thumbnail).
fn shape_to_store(
    db: &mdt::DungeonDb,
    mdt_string: &str,
    dungeon_idx: Option<i64>,
    pulls: Option<&str>,
) -> String {
    route_shape(db, mdt_string, dungeon_idx, pulls).unwrap_or_else(|| "[]".to_string())
}

pub(super) async fn list_routes(repo: web::Data<RouteRepo>) -> HttpResponse {
    let mut routes = match repo.list().await {
        Ok(routes) => routes,
        Err(e) => return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    };
    // Backfill thumbnails for rows saved before shapes existed. Computed once and
    // persisted per row — including an empty-array sentinel for rows with no
    // derivable geometry, so they aren't re-decoded on later lists. Skipped until
    // the MDT db is loaded, so a transient miss isn't persisted as "no shape".
    if let Some(db) = mdt::enemy_db::global() {
        for r in routes.iter_mut() {
            if r.shape.is_none() {
                let shape = shape_to_store(db, &r.mdt_string, r.dungeon_idx, r.pulls.as_deref());
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
    // Persist the shape once at create (sentinel when no geometry is derivable);
    // a list-time backfill covers the case where the MDT db isn't loaded yet.
    let shape = mdt::enemy_db::global()
        .map(|db| shape_to_store(db, req.mdt_string.trim(), req.dungeon_idx, pulls));
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
