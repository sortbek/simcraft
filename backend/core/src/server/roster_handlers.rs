use actix_web::{web, HttpResponse};
use serde::Deserialize;
use serde_json::json;

use crate::db::{RosterMember, RosterRepo};
use crate::roster::armory_client::{ArmoryClient, ArmoryError, HttpArmoryClient};
use crate::roster::armory_to_simc::armory_to_simc;
use crate::roster::member_list::parse_member_list;

#[derive(Deserialize)]
pub struct CreateRosterRequest {
    pub name: String,
    pub region: String,
}

#[derive(Deserialize)]
pub struct ImportMembersRequest {
    pub text: String,
}

pub(super) async fn list_rosters(repo: web::Data<RosterRepo>) -> HttpResponse {
    match repo.list().await {
        Ok(rosters) => HttpResponse::Ok().json(rosters),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

pub(super) async fn create_roster(
    req: web::Json<CreateRosterRequest>,
    repo: web::Data<RosterRepo>,
) -> HttpResponse {
    if req.name.trim().is_empty() {
        return HttpResponse::BadRequest().json(json!({"detail": "name is required"}));
    }
    match repo.create(req.name.trim(), req.region.trim()).await {
        Ok(roster) => HttpResponse::Ok().json(roster),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

pub(super) async fn delete_roster(
    path: web::Path<String>,
    repo: web::Data<RosterRepo>,
) -> HttpResponse {
    let id = path.into_inner();
    match repo.delete(&id).await {
        Ok(true) => HttpResponse::Ok().json(json!({"status": "ok"})),
        Ok(false) => HttpResponse::NotFound().json(json!({"detail": "Roster not found"})),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

pub(super) async fn list_members(
    path: web::Path<String>,
    repo: web::Data<RosterRepo>,
) -> HttpResponse {
    let id = path.into_inner();
    match repo.list_members(&id).await {
        Ok(members) => HttpResponse::Ok().json(members),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

pub(super) async fn delete_member(
    path: web::Path<(String, String)>,
    repo: web::Data<RosterRepo>,
) -> HttpResponse {
    let (_roster_id, member_id) = path.into_inner();
    match repo.delete_member(&member_id).await {
        Ok(true) => HttpResponse::Ok().json(json!({"status": "ok"})),
        Ok(false) => HttpResponse::NotFound().json(json!({"detail": "Member not found"})),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

/// Import members into a roster: parse the pasted text, fetch each character's
/// armory data via `client`, convert to a SimC profile, and upsert. Per-member
/// failures are recorded as the member's `armory_status` (never abort the batch).
/// Returns the roster's members after import.
pub(super) async fn run_import(
    client: &dyn ArmoryClient,
    repo: &RosterRepo,
    roster_id: &str,
    region: &str,
    text: &str,
) -> Result<Vec<RosterMember>, sqlx::Error> {
    for (name, realm) in parse_member_list(text) {
        match client.fetch(region, &realm, &name).await {
            Ok(armory) => {
                let simc = armory_to_simc(&armory);
                let parsed = crate::addon_parser::parse_simc_input(&simc);
                let class = parsed.character.class_name.unwrap_or_default();
                let spec = parsed.character.spec.unwrap_or_default();
                let status = if class.is_empty() { "armory_failed" } else { "ok" };
                repo.upsert_member(roster_id, &name, &realm, &class, &spec, &simc, status)
                    .await?;
            }
            Err(ArmoryError::NotFound) => {
                repo.upsert_member(roster_id, &name, &realm, "", "", "", "not_found")
                    .await?;
            }
            Err(ArmoryError::Http(_)) => {
                repo.upsert_member(roster_id, &name, &realm, "", "", "", "armory_failed")
                    .await?;
            }
        }
    }
    repo.list_members(roster_id).await
}

pub(super) async fn import_members(
    path: web::Path<String>,
    req: web::Json<ImportMembersRequest>,
    repo: web::Data<RosterRepo>,
) -> HttpResponse {
    let roster_id = path.into_inner();
    let roster = match repo.get(&roster_id).await {
        Ok(Some(r)) => r,
        Ok(None) => return HttpResponse::NotFound().json(json!({"detail": "Roster not found"})),
        Err(e) => return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    };
    let client = HttpArmoryClient::new();
    match run_import(&client, repo.get_ref(), &roster_id, &roster.region, &req.text).await {
        Ok(members) => HttpResponse::Ok().json(members),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
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

    #[tokio::test]
    async fn import_ok_populates_class_spec_and_simc() {
        let repo = RosterRepo::new_memory();
        let roster = repo.create("T", "eu").await.unwrap();
        let members = run_import(&MockOk, &repo, &roster.id, "eu", "Thrall-Draenor")
            .await
            .unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].class, "mage");
        assert_eq!(members[0].spec, "frost");
        assert_eq!(members[0].armory_status, "ok");
        assert!(members[0].source_simc.contains("id=132863"));
    }

    #[tokio::test]
    async fn import_not_found_marks_member() {
        let repo = RosterRepo::new_memory();
        let roster = repo.create("T", "eu").await.unwrap();
        let members = run_import(&MockNotFound, &repo, &roster.id, "eu", "Ghost-Draenor")
            .await
            .unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].armory_status, "not_found");
        assert!(members[0].source_simc.is_empty());
    }

    struct MockHttpError;
    #[async_trait::async_trait]
    impl ArmoryClient for MockHttpError {
        async fn fetch(&self, _r: &str, _realm: &str, _n: &str) -> Result<Value, ArmoryError> {
            Err(ArmoryError::Http("boom".into()))
        }
    }

    #[tokio::test]
    async fn import_http_error_marks_member_armory_failed() {
        let repo = RosterRepo::new_memory();
        let roster = repo.create("T", "eu").await.unwrap();
        let members = run_import(&MockHttpError, &repo, &roster.id, "eu", "Thrall-Draenor")
            .await
            .unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].armory_status, "armory_failed");
        assert!(members[0].source_simc.is_empty());
    }
}
