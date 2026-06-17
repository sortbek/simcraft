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

/// Fetch + convert + upsert each (name, realm) pair. Per-member failures are
/// recorded as armory_status (never abort the batch). Returns the roster's
/// members after the operation. Shared by import (pairs from pasted text) and
/// refresh (pairs from existing members).
pub(super) async fn import_pairs(
    client: &dyn ArmoryClient,
    repo: &RosterRepo,
    roster_id: &str,
    region: &str,
    pairs: &[(String, String)],
) -> Result<Vec<RosterMember>, sqlx::Error> {
    for (name, realm) in pairs {
        match client.fetch(region, realm, name).await {
            Ok(armory) => {
                let simc = armory_to_simc(&armory);
                let item_level = armory
                    .get("gear")
                    .and_then(|g| g.get("averageItemLevel"))
                    .and_then(|v| v.as_u64().or_else(|| v.as_f64().map(|f| f as u64)))
                    .unwrap_or(0) as i64;
                let parsed = crate::addon_parser::parse_simc_input(&simc);
                let class = parsed.character.class_name.unwrap_or_default();
                let spec = parsed.character.spec.unwrap_or_default();
                let status = if class.is_empty() { "armory_failed" } else { "ok" };
                repo.upsert_member(roster_id, name, realm, &class, &spec, &simc, status, item_level)
                    .await?;
            }
            Err(ArmoryError::NotFound) => {
                repo.upsert_member(roster_id, name, realm, "", "", "", "not_found", 0)
                    .await?;
            }
            Err(ArmoryError::Http(_)) => {
                repo.upsert_member(roster_id, name, realm, "", "", "", "armory_failed", 0)
                    .await?;
            }
        }
    }
    repo.list_members(roster_id).await
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
    let pairs = parse_member_list(text);
    import_pairs(client, repo, roster_id, region, &pairs).await
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

/// Re-fetch armory data for ALL existing members of a roster (no pasted text).
/// Reuses each member's stored (name, realm); idempotent via `import_pairs`.
pub(super) async fn refresh_roster(
    path: web::Path<String>,
    repo: web::Data<RosterRepo>,
) -> HttpResponse {
    let roster_id = path.into_inner();
    let roster = match repo.get(&roster_id).await {
        Ok(Some(r)) => r,
        Ok(None) => return HttpResponse::NotFound().json(json!({"detail": "Roster not found"})),
        Err(e) => return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    };
    let members = match repo.list_members(&roster_id).await {
        Ok(m) => m,
        Err(e) => return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    };
    let pairs: Vec<(String, String)> = members
        .iter()
        .map(|m| (m.name.clone(), m.realm.clone()))
        .collect();
    let client = HttpArmoryClient::new();
    match import_pairs(&client, repo.get_ref(), &roster_id, &roster.region, &pairs).await {
        Ok(members) => HttpResponse::Ok().json(members),
        Err(e) => HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    }
}

/// Re-fetch armory data for a SINGLE existing member of a roster. Returns the
/// full updated member list.
pub(super) async fn refresh_member(
    path: web::Path<(String, String)>,
    repo: web::Data<RosterRepo>,
) -> HttpResponse {
    let (roster_id, member_id) = path.into_inner();
    let roster = match repo.get(&roster_id).await {
        Ok(Some(r)) => r,
        Ok(None) => return HttpResponse::NotFound().json(json!({"detail": "Roster not found"})),
        Err(e) => return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    };
    let members = match repo.list_members(&roster_id).await {
        Ok(m) => m,
        Err(e) => return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()})),
    };
    let Some(member) = members.iter().find(|m| m.id == member_id) else {
        return HttpResponse::NotFound().json(json!({"detail": "Member not found"}));
    };
    let pairs = vec![(member.name.clone(), member.realm.clone())];
    let client = HttpArmoryClient::new();
    match import_pairs(&client, repo.get_ref(), &roster_id, &roster.region, &pairs).await {
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
        assert_eq!(members[0].item_level, 70);
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

    #[tokio::test]
    async fn import_pairs_refreshes_existing_member() {
        let repo = RosterRepo::new_memory();
        let roster = repo.create("T", "eu").await.unwrap();
        // seed a stale/pending member
        repo.upsert_member(&roster.id, "Thrall", "Draenor", "", "", "", "pending", 0)
            .await
            .unwrap();
        // refresh that one pair via the shared seam + MockOk (returns the armory fixture)
        let pairs = vec![("Thrall".to_string(), "Draenor".to_string())];
        let members = import_pairs(&MockOk, &repo, &roster.id, "eu", &pairs)
            .await
            .unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].class, "mage"); // fixture is a frost mage
        assert_eq!(members[0].armory_status, "ok");
        assert!(members[0].source_simc.contains("id=132863"));
    }
}
