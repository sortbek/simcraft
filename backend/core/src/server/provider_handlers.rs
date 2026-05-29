use actix_web::{web, HttpResponse};
use serde::Serialize;
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
