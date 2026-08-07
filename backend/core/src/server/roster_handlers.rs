use actix_web::{web, HttpResponse};
use serde::Deserialize;
use serde_json::json;

use crate::db::{RosterMember, RosterRepo};
use crate::roster::armory_client::{ArmoryClient, ArmoryError, HttpArmoryClient};
use crate::roster::armory_to_simc::armory_to_simc;
use crate::roster::member_list::parse_member_list;
use crate::roster::simc_import::{split_simc_profiles, SimcProfile};
use crate::types::{ItemOrigin, ParseResult};

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

/// Identity used to match a pasted character against an existing member:
/// case-insensitive and blind to spaces, dashes, apostrophes and underscores, so
/// `server=tarren_mill` finds a `Tarren Mill` row. Folded in Rust, never SQL —
/// SQLite's `lower()` is ASCII-only and would not fold `Ø`. Diacritics are left
/// alone: `Sortbek` and `Sørtbek` may be two different characters.
fn member_key(name: &str, realm: &str) -> String {
    fn fold(s: &str) -> String {
        s.to_lowercase()
            .chars()
            .filter(|c| !matches!(c, ' ' | '-' | '\'' | '_'))
            .collect()
    }
    format!("{}\u{1}{}", fold(name), fold(realm))
}

/// The member this (name, realm) refers to, if the roster already holds them.
fn match_member<'a>(
    members: &'a [RosterMember],
    name: &str,
    realm: &str,
) -> Option<&'a RosterMember> {
    let key = member_key(name, realm);
    members
        .iter()
        .find(|m| member_key(&m.name, &m.realm) == key)
}

/// Average item level of the equipped gear, resolved from bonus IDs — the addon
/// export carries no `ilevel=` token. Items the item DB cannot resolve yield 0 and
/// are skipped entirely; counting them would drag the average down by ~18 each.
fn average_item_level(parsed: &ParseResult) -> i64 {
    let levels: Vec<u64> = parsed
        .items
        .iter()
        .filter(|item| item.origin == ItemOrigin::Equipped)
        .filter_map(|item| crate::item_db::get_item_info(item.item_id, Some(&item.bonus_ids)))
        .map(|info| info.ilevel)
        .filter(|&ilvl| ilvl > 0)
        .collect();
    if levels.is_empty() {
        return 0;
    }
    (levels.iter().sum::<u64>() / levels.len() as u64) as i64
}

/// Store each pasted SimC profile as a member. The armory is never consulted:
/// class, spec and item level all come from the profile text. A profile naming a
/// member the roster already holds is written to that member's exact key, so their
/// row id and display realm survive.
async fn import_profiles(
    repo: &RosterRepo,
    roster_id: &str,
    profiles: &[SimcProfile],
) -> Result<Vec<RosterMember>, sqlx::Error> {
    let existing = repo.list_members(roster_id).await?;
    for profile in profiles {
        let parsed = crate::addon_parser::parse_simc_input(&profile.simc);
        let class = parsed.character.class_name.clone().unwrap_or_default();
        let spec = parsed.character.spec.clone().unwrap_or_default();
        let (name, realm) = match match_member(&existing, &profile.name, &profile.realm) {
            Some(m) => (m.name.as_str(), m.realm.as_str()),
            None => (profile.name.as_str(), profile.realm.as_str()),
        };
        repo.upsert_member(
            roster_id,
            name,
            realm,
            &class,
            &spec,
            &profile.simc,
            "ok",
            average_item_level(&parsed),
        )
        .await?;
    }
    repo.list_members(roster_id).await
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
    let existing = repo.list_members(roster_id).await?;
    for (name, realm) in pairs {
        // A member who already has gear must never be downgraded by an armory round
        // trip that fails or yields an unusable profile: a cross-region raider or a
        // transient outage would otherwise wipe a freshly pasted raid. Recording the
        // failure while keeping the gear is no better — run eligibility requires
        // "ok", so they would drop out of runs anyway. Leave the row exactly as it is.
        let has_gear =
            match_member(&existing, name, realm).is_some_and(|m| !m.source_simc.trim().is_empty());

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
                if class.is_empty() && has_gear {
                    continue;
                }
                let status = if class.is_empty() {
                    "armory_failed"
                } else {
                    "ok"
                };
                repo.upsert_member(
                    roster_id, name, realm, &class, &spec, &simc, status, item_level,
                )
                .await?;
            }
            Err(err) => {
                if has_gear {
                    continue;
                }
                let status = match err {
                    ArmoryError::NotFound => "not_found",
                    ArmoryError::Http(_) => "armory_failed",
                };
                repo.upsert_member(roster_id, name, realm, "", "", "", status, 0)
                    .await?;
            }
        }
    }
    repo.list_members(roster_id).await
}

/// Import members into a roster from pasted text, which is either a set of SimC
/// profiles (from the export addon) or `Name-Realm` lines to look up on the armory.
/// Whether the splitter finds any profiles is the whole routing rule.
///
/// On the armory path, re-adding someone who already has gear is a no-op — refresh
/// is what re-fetches. Rows left empty by an earlier failure are retried. Per-member
/// failures are recorded as `armory_status` and never abort the batch.
pub(super) async fn run_import(
    client: &dyn ArmoryClient,
    repo: &RosterRepo,
    roster_id: &str,
    region: &str,
    text: &str,
) -> Result<Vec<RosterMember>, sqlx::Error> {
    let profiles = split_simc_profiles(text);
    if !profiles.is_empty() {
        return import_profiles(repo, roster_id, &profiles).await;
    }

    let existing = repo.list_members(roster_id).await?;
    let pairs: Vec<(String, String)> = parse_member_list(text)
        .into_iter()
        .filter_map(
            |(name, realm)| match match_member(&existing, &name, &realm) {
                Some(m) if !m.source_simc.trim().is_empty() => None,
                // Known but empty: retry against its exact key so we never duplicate it.
                Some(m) => Some((m.name.clone(), m.realm.clone())),
                None => Some((name, realm)),
            },
        )
        .collect();
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
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
    };
    let client = HttpArmoryClient::new();
    match run_import(
        &client,
        repo.get_ref(),
        &roster_id,
        &roster.region,
        &req.text,
    )
    .await
    {
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
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
    };
    let members = match repo.list_members(&roster_id).await {
        Ok(m) => m,
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
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
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
    };
    let members = match repo.list_members(&roster_id).await {
        Ok(m) => m,
        Err(e) => {
            return HttpResponse::InternalServerError().json(json!({"detail": e.to_string()}))
        }
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

    /// Asserts the armory is never consulted.
    struct MockUnreachable;
    #[async_trait::async_trait]
    impl ArmoryClient for MockUnreachable {
        async fn fetch(&self, _r: &str, _realm: &str, n: &str) -> Result<Value, ArmoryError> {
            panic!("armory must not be fetched, but was asked for {n}");
        }
    }

    fn simc_paste() -> String {
        let p = format!(
            "{}/tests/fixtures/roster_simc_paste.txt",
            env!("CARGO_MANIFEST_DIR")
        );
        std::fs::read_to_string(p).unwrap()
    }

    async fn import_sample(repo: &RosterRepo) -> Vec<RosterMember> {
        let roster = repo.create("T", "eu").await.unwrap();
        run_import(&MockUnreachable, repo, &roster.id, "eu", &simc_paste())
            .await
            .unwrap()
    }

    fn find<'a>(members: &'a [RosterMember], name: &str) -> &'a RosterMember {
        members.iter().find(|m| m.name == name).expect(name)
    }

    /// A member already in the roster with gear, seeded past both import paths.
    async fn seed(repo: &RosterRepo, roster: &str, name: &str, realm: &str, simc: &str) {
        repo.upsert_member(roster, name, realm, "mage", "frost", simc, "ok", 100)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn simc_paste_imports_every_profile_without_the_armory() {
        let repo = RosterRepo::new_memory();
        let members = import_sample(&repo).await;
        assert_eq!(members.len(), 2);
        assert_eq!(find(&members, "Duskryth").realm, "Silvermoon");
        assert_eq!(find(&members, "Sørtbek").realm, "Draenor");
    }

    #[tokio::test]
    async fn simc_imported_members_are_run_eligible() {
        // roster_run_handlers filters on exactly this pair of conditions.
        let repo = RosterRepo::new_memory();
        let members = import_sample(&repo).await;
        assert_eq!(members.len(), 2);
        assert!(members
            .iter()
            .all(|m| m.armory_status == "ok" && !m.source_simc.trim().is_empty()));
    }

    #[tokio::test]
    async fn simc_import_reads_class_and_spec_from_the_profile() {
        let repo = RosterRepo::new_memory();
        let members = import_sample(&repo).await;
        let duskryth = find(&members, "Duskryth");
        assert_eq!(duskryth.class, "evoker");
        assert_eq!(duskryth.spec, "devastation");
    }

    #[tokio::test]
    async fn simc_import_computes_item_level_from_bonus_ids() {
        crate::test_support::ensure_game_data_loaded();
        let repo = RosterRepo::new_memory();
        let members = import_sample(&repo).await;
        // The export carries no `ilevel=` token, so this can only come from bonus IDs.
        // A real average over the equipped set, not a single resolved item. Banded
        // rather than exact: the baked item DB shifts with each patch.
        for m in &members {
            assert!(
                (200..400).contains(&m.item_level),
                "{} resolved to an implausible item level: {}",
                m.name,
                m.item_level
            );
        }
    }

    #[tokio::test]
    async fn simc_profile_replaces_a_matching_member_in_place() {
        let repo = RosterRepo::new_memory();
        let roster = repo.create("T", "eu").await.unwrap();
        seed(&repo, &roster.id, "Duskryth", "Silvermoon", "stale").await;
        let seeded_id = repo.list_members(&roster.id).await.unwrap()[0].id.clone();

        let members = run_import(&MockUnreachable, &repo, &roster.id, "eu", &simc_paste())
            .await
            .unwrap();

        let duskryth = find(&members, "Duskryth");
        assert_eq!(members.len(), 2, "must not duplicate the existing member");
        assert_eq!(duskryth.id, seeded_id, "row identity must survive");
        assert_eq!(duskryth.class, "evoker");
        assert!(duskryth.source_simc.contains("id=249997"));
    }

    #[tokio::test]
    async fn simc_profile_matches_a_realm_that_differs_only_by_punctuation() {
        let repo = RosterRepo::new_memory();
        let roster = repo.create("T", "eu").await.unwrap();
        seed(&repo, &roster.id, "Jaina", "Tarren Mill", "stale").await;

        let paste =
            "mage=\"Jaina\"\nserver=tarren_mill\nspec=frost\nhead=,id=249997,bonus_id=6652\n";
        let members = run_import(&MockUnreachable, &repo, &roster.id, "eu", paste)
            .await
            .unwrap();

        assert_eq!(members.len(), 1, "must not duplicate under a slugged realm");
        assert_eq!(
            members[0].realm, "Tarren Mill",
            "display realm is preserved"
        );
        assert!(
            members[0].source_simc.contains("id=249997"),
            "the pasted profile must have replaced the stale gear"
        );
    }

    #[tokio::test]
    async fn re_adding_a_name_that_already_has_gear_is_a_no_op() {
        let repo = RosterRepo::new_memory();
        let roster = repo.create("T", "eu").await.unwrap();
        seed(&repo, &roster.id, "Thrall", "Draenor", "kept").await;

        // MockUnreachable panics if the armory is consulted.
        let members = run_import(&MockUnreachable, &repo, &roster.id, "eu", "Thrall-Draenor")
            .await
            .unwrap();

        assert_eq!(members.len(), 1);
        assert_eq!(members[0].source_simc, "kept");
    }

    #[tokio::test]
    async fn re_adding_a_name_without_gear_retries_the_fetch() {
        let repo = RosterRepo::new_memory();
        let roster = repo.create("T", "eu").await.unwrap();
        repo.upsert_member(&roster.id, "Thrall", "Draenor", "", "", "", "not_found", 0)
            .await
            .unwrap();

        let members = run_import(&MockOk, &repo, &roster.id, "eu", "Thrall-Draenor")
            .await
            .unwrap();

        assert_eq!(members.len(), 1);
        assert_eq!(members[0].armory_status, "ok");
        assert!(members[0].source_simc.contains("id=132863"));
    }

    struct MockUnusable;
    #[async_trait::async_trait]
    impl ArmoryClient for MockUnusable {
        async fn fetch(&self, _r: &str, _realm: &str, _n: &str) -> Result<Value, ArmoryError> {
            // Fetch succeeds, but the payload yields no class — an unusable profile.
            Ok(serde_json::json!({}))
        }
    }

    #[tokio::test]
    async fn unusable_armory_payload_leaves_a_member_who_has_gear_untouched() {
        let repo = RosterRepo::new_memory();
        let roster = repo.create("T", "eu").await.unwrap();
        seed(&repo, &roster.id, "Duskryth", "Silvermoon", "pasted").await;

        let pairs = vec![("Duskryth".to_string(), "Silvermoon".to_string())];
        let members = import_pairs(&MockUnusable, &repo, &roster.id, "eu", &pairs)
            .await
            .unwrap();

        assert_eq!(members[0].source_simc, "pasted", "gear must survive");
        assert_eq!(members[0].armory_status, "ok");
    }

    #[tokio::test]
    async fn failed_fetch_leaves_a_member_who_has_gear_untouched() {
        let repo = RosterRepo::new_memory();
        let roster = repo.create("T", "eu").await.unwrap();
        seed(&repo, &roster.id, "Duskryth", "Silvermoon", "pasted").await;

        // A refresh over a cross-region raider, or during an armory outage.
        let pairs = vec![("Duskryth".to_string(), "Silvermoon".to_string())];
        let members = import_pairs(&MockNotFound, &repo, &roster.id, "eu", &pairs)
            .await
            .unwrap();

        assert_eq!(members[0].source_simc, "pasted", "gear must survive");
        assert_eq!(members[0].item_level, 100);
        assert_eq!(
            members[0].armory_status, "ok",
            "must stay run-eligible: the run filter requires ok"
        );
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
