use actix_web::{web, HttpResponse};
use serde::Deserialize;
use serde_json::json;

use crate::roster::armory_client::{ArmoryClient, ArmoryError, HttpArmoryClient};
use crate::roster::armory_to_simc::armory_to_simc;

#[derive(Deserialize)]
pub struct ArmoryImportRequest {
    pub region: String,
    pub realm: String,
    pub name: String,
}

/// Fetch one character from the armory and convert it to a SimC profile string.
/// Shared seam so the conversion can be exercised with a mock `ArmoryClient`.
/// A fetch that succeeds but yields no class line is treated as a failure
/// (mirrors the roster import's `armory_failed` status).
pub(super) async fn fetch_armory_simc(
    client: &dyn ArmoryClient,
    region: &str,
    realm: &str,
    name: &str,
) -> Result<String, ArmoryError> {
    let armory = client.fetch(region, realm, name).await?;
    let simc = armory_to_simc(&armory);
    let parsed = crate::addon_parser::parse_simc_input(&simc);
    if parsed.character.class_name.unwrap_or_default().is_empty() {
        return Err(ArmoryError::Http("armory data could not be parsed".into()));
    }
    Ok(simc)
}

/// POST /api/armory/import — fetch a single character from the armory and return
/// the generated SimC profile string. The frontend drops it into the SimC import
/// box for review; persistence happens via the normal `POST /api/characters` path.
pub(super) async fn import_armory_character(req: web::Json<ArmoryImportRequest>) -> HttpResponse {
    let region = req.region.trim();
    let realm = req.realm.trim();
    let name = req.name.trim();
    if region.is_empty() || realm.is_empty() || name.is_empty() {
        return HttpResponse::BadRequest()
            .json(json!({"detail": "region, realm, and name are required"}));
    }
    let client = HttpArmoryClient::new();
    match fetch_armory_simc(&client, region, realm, name).await {
        Ok(simc_input) => HttpResponse::Ok().json(json!({ "simc_input": simc_input })),
        Err(ArmoryError::NotFound) => {
            HttpResponse::NotFound().json(json!({"detail": "Character not found on armory"}))
        }
        Err(ArmoryError::Http(e)) => HttpResponse::BadGateway().json(json!({"detail": e})),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn fixture(name: &str) -> Value {
        let p = format!("{}/tests/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name);
        serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
    }

    struct MockOk;
    #[async_trait::async_trait]
    impl ArmoryClient for MockOk {
        async fn fetch(&self, _r: &str, _realm: &str, _n: &str) -> Result<Value, ArmoryError> {
            Ok(fixture("armory_sample.json"))
        }
    }

    struct MockNotFound;
    #[async_trait::async_trait]
    impl ArmoryClient for MockNotFound {
        async fn fetch(&self, _r: &str, _realm: &str, _n: &str) -> Result<Value, ArmoryError> {
            Err(ArmoryError::NotFound)
        }
    }

    struct MockHttpError;
    #[async_trait::async_trait]
    impl ArmoryClient for MockHttpError {
        async fn fetch(&self, _r: &str, _realm: &str, _n: &str) -> Result<Value, ArmoryError> {
            Err(ArmoryError::Http("boom".into()))
        }
    }

    #[tokio::test]
    async fn fetch_ok_returns_simc_profile() {
        let simc = fetch_armory_simc(&MockOk, "eu", "Draenor", "Thrall")
            .await
            .unwrap();
        assert!(simc.contains("id=132863"));
    }

    #[tokio::test]
    async fn fetch_not_found_propagates() {
        let err = fetch_armory_simc(&MockNotFound, "eu", "Draenor", "Ghost")
            .await
            .unwrap_err();
        assert!(matches!(err, ArmoryError::NotFound));
    }

    #[tokio::test]
    async fn fetch_http_error_propagates() {
        let err = fetch_armory_simc(&MockHttpError, "eu", "Draenor", "Thrall")
            .await
            .unwrap_err();
        assert!(matches!(err, ArmoryError::Http(_)));
    }
}
