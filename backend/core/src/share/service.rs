use serde_json::Value;
use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};

use crate::db::job_repo::JobRepo;
use crate::share::client::{ShareClient, ShareError};
use crate::share::payload::{build_share_body, BuildError, ShareInput};

#[derive(Debug)]
pub enum ShareFailure {
    JobNotFound,
    NotShareable(String),
    TooLarge,
    Remote(ShareError),
    Db(String),
}

/// Jobs with an upload in flight: a second request (double click, retry) would
/// upload again and overwrite the first share's delete token, orphaning it.
static SHARING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

struct SharingGuard(String);

impl SharingGuard {
    fn claim(job_id: &str) -> Option<Self> {
        SHARING
            .lock()
            .unwrap()
            .insert(job_id.to_string())
            .then(|| Self(job_id.to_string()))
    }
}

impl Drop for SharingGuard {
    fn drop(&mut self) {
        SHARING.lock().unwrap().remove(&self.0);
    }
}

pub async fn share_job(
    client: &dyn ShareClient,
    repo: &JobRepo,
    job_id: &str,
    input: &ShareInput,
) -> Result<String, ShareFailure> {
    let _guard = SharingGuard::claim(job_id)
        .ok_or_else(|| ShareFailure::NotShareable("This sim is already being shared".into()))?;
    let job = repo
        .get(job_id)
        .await
        .map_err(|e| ShareFailure::Db(e.to_string()))?
        .ok_or(ShareFailure::JobNotFound)?;
    if let Some(existing) = job.share_id.clone() {
        return Ok(existing);
    }
    let body: Value = build_share_body(&job, input).map_err(|e| match e {
        BuildError::NotShareable(m) => ShareFailure::NotShareable(m),
        BuildError::TooLarge => ShareFailure::TooLarge,
    })?;
    let created = client.create(&body).await.map_err(ShareFailure::Remote)?;
    // The id goes into URLs and the delete path; never store one we didn't expect.
    if !crate::share::is_share_id(&created.id) {
        // Not deleted remotely either: the bad id would go into the delete URL.
        return Err(ShareFailure::Remote(ShareError::Rejected(
            "invalid share id".into(),
        )));
    }
    repo.set_share(job_id, Some(&created.id), Some(&created.delete_token))
        .await
        .map_err(|e| ShareFailure::Db(e.to_string()))?;
    Ok(created.id)
}

pub async fn unshare_job(
    client: &dyn ShareClient,
    repo: &JobRepo,
    job_id: &str,
) -> Result<(), ShareFailure> {
    let job = repo
        .get(job_id)
        .await
        .map_err(|e| ShareFailure::Db(e.to_string()))?
        .ok_or(ShareFailure::JobNotFound)?;
    if let (Some(id), Some(token)) = (job.share_id.as_deref(), job.share_delete_token.as_deref()) {
        match client.delete(id, token).await {
            // NotFound: already gone remotely. Forbidden: the stored token is
            // wrong/stale (expired or rotated) and can never succeed again —
            // clear it locally rather than leaving an unshareable job stuck
            // forever; the remote share itself expires on its own in 90 days.
            Ok(()) | Err(ShareError::NotFound) | Err(ShareError::Forbidden) => {}
            Err(e) => return Err(ShareFailure::Remote(e)),
        }
    }
    repo.set_share(job_id, None, None)
        .await
        .map_err(|e| ShareFailure::Db(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::job_repo::JobRepo;
    use crate::models::{Job, JobStatus};
    use crate::share::client::{CreatedShare, ShareError};
    use serde_json::json;
    use std::sync::Mutex;

    struct Mock {
        create: Mutex<Vec<Value>>,
        deletes: Mutex<Vec<(String, String)>>,
        create_result: Result<CreatedShare, ShareError>,
        delete_result: Result<(), ShareError>,
    }

    fn ok_mock() -> Mock {
        Mock {
            create: Mutex::new(vec![]),
            deletes: Mutex::new(vec![]),
            create_result: Ok(CreatedShare {
                id: "K3Fq9xTz2a".into(),
                url: "https://simhammer.com/sim/K3Fq9xTz2a".into(),
                delete_token: "tok".into(),
            }),
            delete_result: Ok(()),
        }
    }

    #[async_trait::async_trait]
    impl ShareClient for Mock {
        async fn create(&self, body: &Value) -> Result<CreatedShare, ShareError> {
            self.create.lock().unwrap().push(body.clone());
            self.create_result.clone()
        }
        async fn delete(&self, id: &str, token: &str) -> Result<(), ShareError> {
            self.deletes.lock().unwrap().push((id.into(), token.into()));
            self.delete_result.clone()
        }
    }

    async fn repo_with_done_job() -> (JobRepo, String) {
        let repo = JobRepo::new_memory();
        let mut job = Job::new_with_provider(
            "in".into(),
            "quick".into(),
            1000,
            "Patchwerk".into(),
            0.1,
            "local".into(),
        );
        job.status = JobStatus::Done;
        job.result_json = Some(r#"{"dps":1.0}"#.into());
        repo.insert(&job).await.unwrap();
        (repo, job.id)
    }

    fn input() -> ShareInput {
        ShareInput {
            summary: json!({"v": 1}),
            app_version: "4.4.3".into(),
            simc_build: None,
            lookups: None,
        }
    }

    #[tokio::test]
    async fn shares_once_and_is_idempotent() {
        let (repo, id) = repo_with_done_job().await;
        let mock = ok_mock();
        assert_eq!(
            share_job(&mock, &repo, &id, &input()).await.unwrap(),
            "K3Fq9xTz2a"
        );
        assert_eq!(
            share_job(&mock, &repo, &id, &input()).await.unwrap(),
            "K3Fq9xTz2a"
        );
        assert_eq!(mock.create.lock().unwrap().len(), 1);
        let job = repo.get(&id).await.unwrap().unwrap();
        assert_eq!(job.share_delete_token.as_deref(), Some("tok"));
    }

    #[tokio::test]
    async fn a_second_share_while_one_is_uploading_is_refused() {
        let (repo, id) = repo_with_done_job().await;
        let held = SharingGuard::claim(&id).unwrap();
        let mock = ok_mock();
        assert!(matches!(
            share_job(&mock, &repo, &id, &input()).await,
            Err(ShareFailure::NotShareable(_))
        ));
        assert!(mock.create.lock().unwrap().is_empty());
        drop(held);
        assert!(share_job(&mock, &repo, &id, &input()).await.is_ok());
    }

    #[tokio::test]
    async fn an_unexpected_share_id_is_not_stored() {
        let (repo, id) = repo_with_done_job().await;
        let bad = CreatedShare {
            id: "../x".into(),
            url: String::new(),
            delete_token: "tok".into(),
        };
        let mock = Mock {
            create_result: Ok(bad),
            ..ok_mock()
        };
        assert!(share_job(&mock, &repo, &id, &input()).await.is_err());
        assert!(repo.get(&id).await.unwrap().unwrap().share_id.is_none());
    }

    #[tokio::test]
    async fn remote_error_stores_nothing() {
        let (repo, id) = repo_with_done_job().await;
        let mock = Mock {
            create_result: Err(ShareError::RateLimited),
            ..ok_mock()
        };
        assert!(matches!(
            share_job(&mock, &repo, &id, &input()).await,
            Err(ShareFailure::Remote(ShareError::RateLimited))
        ));
        assert!(repo.get(&id).await.unwrap().unwrap().share_id.is_none());
    }

    #[tokio::test]
    async fn unknown_job_is_not_found() {
        let repo = JobRepo::new_memory();
        assert!(matches!(
            share_job(&ok_mock(), &repo, "nope", &input()).await,
            Err(ShareFailure::JobNotFound)
        ));
    }

    #[tokio::test]
    async fn unshare_clears_columns_and_treats_remote_404_as_success() {
        let (repo, id) = repo_with_done_job().await;
        let mock = Mock {
            delete_result: Err(ShareError::NotFound),
            ..ok_mock()
        };
        share_job(&mock, &repo, &id, &input()).await.unwrap();
        unshare_job(&mock, &repo, &id).await.unwrap();
        assert_eq!(
            mock.deletes.lock().unwrap()[0],
            ("K3Fq9xTz2a".to_string(), "tok".to_string())
        );
        assert!(repo.get(&id).await.unwrap().unwrap().share_id.is_none());
    }

    #[tokio::test]
    async fn unshare_clears_columns_on_remote_forbidden() {
        let (repo, id) = repo_with_done_job().await;
        let mock = Mock {
            delete_result: Err(ShareError::Forbidden),
            ..ok_mock()
        };
        share_job(&mock, &repo, &id, &input()).await.unwrap();
        unshare_job(&mock, &repo, &id).await.unwrap();
        assert!(repo.get(&id).await.unwrap().unwrap().share_id.is_none());
    }

    #[tokio::test]
    async fn reshare_after_unshare_uploads_again() {
        let (repo, id) = repo_with_done_job().await;
        let mock = ok_mock();
        share_job(&mock, &repo, &id, &input()).await.unwrap();
        unshare_job(&mock, &repo, &id).await.unwrap();
        share_job(&mock, &repo, &id, &input()).await.unwrap();
        assert_eq!(mock.create.lock().unwrap().len(), 2);
    }
}
