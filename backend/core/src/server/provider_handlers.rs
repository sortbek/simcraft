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
) -> HttpResponse {
    let id = path.into_inner();
    if id != "simmit" {
        return HttpResponse::BadRequest().json(serde_json::json!({"detail": "unknown provider"}));
    }
    if body.api_key.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({"detail": "missing api_key"}));
    }
    let client = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(e) => return HttpResponse::InternalServerError().json(serde_json::json!({"detail": e.to_string()})),
    };
    let resp = client
        .get("https://api.simmit.com/v1/simc/usage")
        .bearer_auth(&body.api_key)
        .send()
        .await;
    match resp {
        Ok(r) if r.status().is_success() => {
            let body: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            // Try a few common JSON paths for credit balance; surface None if not found.
            let credits = body
                .pointer("/balance/availableCredits")
                .and_then(|v| v.as_u64())
                .or_else(|| body.pointer("/credits/available").and_then(|v| v.as_u64()))
                .or_else(|| body.pointer("/credits").and_then(|v| v.as_u64()));
            HttpResponse::Ok().json(serde_json::json!({
                "ok": true,
                "credits_available": credits,
            }))
        }
        Ok(r) => HttpResponse::Ok().json(serde_json::json!({
            "ok": false,
            "detail": format!("Simmit returned {}", r.status()),
        })),
        Err(e) => HttpResponse::Ok().json(serde_json::json!({
            "ok": false,
            "detail": e.to_string(),
        })),
    }
}
