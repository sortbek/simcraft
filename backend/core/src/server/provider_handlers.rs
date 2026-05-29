use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use crate::compute::{ProviderRegistry, ProviderSettings};
use crate::db::SettingsRepo;

#[derive(Serialize)]
struct ProviderMeta {
    id: &'static str,
    display_name: &'static str,
    capabilities: crate::compute::ProviderCaps,
    server_configured: bool,
}

pub async fn list_providers(
    registry: web::Data<Arc<ProviderRegistry>>,
    settings_repo: web::Data<SettingsRepo>,
) -> HttpResponse {
    let remote_ids = registry.remote_ids();
    let settings = match ProviderSettings::load(settings_repo.get_ref(), &remote_ids).await {
        Ok(s) => s,
        Err(e) => return HttpResponse::InternalServerError().json(serde_json::json!({"detail": e.to_string()})),
    };
    let mut out: Vec<ProviderMeta> = Vec::new();
    for id in registry.ids() {
        let Some(p) = registry.get(id) else { continue; };
        let server_configured = id == "local" || settings.get_api_key(id).is_some();
        out.push(ProviderMeta {
            id: p.id(),
            display_name: p.display_name(),
            capabilities: p.capabilities(),
            server_configured,
        });
    }
    HttpResponse::Ok().json(out)
}

#[derive(Deserialize)]
pub struct TestKeyBody {
    pub api_key: String,
}

pub async fn test_provider(
    path: web::Path<String>,
    body: web::Json<TestKeyBody>,
    registry: web::Data<std::sync::Arc<crate::compute::ProviderRegistry>>,
) -> HttpResponse {
    let id = path.into_inner();
    let provider = match registry.get(&id) {
        Some(p) => p,
        None => return HttpResponse::BadRequest().json(serde_json::json!({"detail": "unknown provider"})),
    };
    if body.api_key.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({"detail": "missing api_key"}));
    }
    match provider.test_credential(&body.api_key).await {
        Ok(test) => HttpResponse::Ok().json(serde_json::json!({
            "ok": true,
            "credits_available": test.credits_available,
        })),
        Err(detail) => HttpResponse::Ok().json(serde_json::json!({
            "ok": false,
            "detail": detail,
        })),
    }
}

/// Desktop-only: probe the credential that's already stored in SettingsRepo.
/// Lets the "Test" button verify a saved key without re-typing it. Web
/// frontend keeps its key in localStorage and calls `test_provider` directly.
#[cfg(feature = "desktop")]
pub async fn test_stored_provider_key(
    path: web::Path<String>,
    settings_repo: web::Data<SettingsRepo>,
    registry: web::Data<std::sync::Arc<crate::compute::ProviderRegistry>>,
) -> HttpResponse {
    let id = path.into_inner();
    let provider = match registry.get(&id) {
        Some(p) => p,
        None => return HttpResponse::BadRequest().json(serde_json::json!({"detail": "unknown provider"})),
    };
    let remote_ids = registry.remote_ids();
    let settings = match crate::compute::ProviderSettings::load(settings_repo.get_ref(), &remote_ids).await {
        Ok(s) => s,
        Err(e) => return HttpResponse::InternalServerError().json(serde_json::json!({"detail": e.to_string()})),
    };
    let key = match settings.get_api_key(&id) {
        Some(k) if !k.is_empty() => k.to_string(),
        _ => return HttpResponse::Ok().json(serde_json::json!({
            "ok": false,
            "detail": "no stored key for this provider",
        })),
    };
    match provider.test_credential(&key).await {
        Ok(test) => HttpResponse::Ok().json(serde_json::json!({
            "ok": true,
            "credits_available": test.credits_available,
        })),
        Err(detail) => HttpResponse::Ok().json(serde_json::json!({
            "ok": false,
            "detail": detail,
        })),
    }
}

/// Desktop-only: persists a provider API key into the local SettingsRepo.
/// Web doesn't expose this route (see api_routes.rs); on web the key lives in
/// browser localStorage and travels per-request via X-Provider-<id>-Key.
#[cfg(feature = "desktop")]
pub async fn save_provider_key(
    path: web::Path<String>,
    body: web::Json<TestKeyBody>,
    settings_repo: web::Data<SettingsRepo>,
    registry: web::Data<std::sync::Arc<crate::compute::ProviderRegistry>>,
) -> HttpResponse {
    let id = path.into_inner();
    if !registry.remote_ids().contains(&id.as_str()) {
        return HttpResponse::BadRequest().json(serde_json::json!({"detail": "unknown provider"}));
    }
    if let Err(e) = settings_repo.set(&format!("provider.{}.api_key", id), &body.api_key).await {
        return HttpResponse::InternalServerError().json(serde_json::json!({"detail": e.to_string()}));
    }
    let _ = settings_repo.set(&format!("provider.{}.enabled", id), "true").await;
    HttpResponse::Ok().json(serde_json::json!({"ok": true}))
}

#[cfg(feature = "desktop")]
pub async fn delete_provider_key(
    path: web::Path<String>,
    settings_repo: web::Data<SettingsRepo>,
    registry: web::Data<std::sync::Arc<crate::compute::ProviderRegistry>>,
) -> HttpResponse {
    let id = path.into_inner();
    if !registry.remote_ids().contains(&id.as_str()) {
        return HttpResponse::BadRequest().finish();
    }
    let _ = settings_repo.set(&format!("provider.{}.api_key", id), "").await;
    HttpResponse::Ok().finish()
}
