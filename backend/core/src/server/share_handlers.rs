use actix_web::{web, HttpResponse};
use serde_json::{json, Value};

use super::client_request::sanitize_shared_request;
use crate::db::job_repo::JobRepo;
use crate::share::client::{HttpShareClient, ShareError};
use crate::share::payload::ShareInput;
use crate::share::service::{share_job, unshare_job, ShareFailure};

fn failure_response(f: ShareFailure) -> HttpResponse {
    match f {
        ShareFailure::JobNotFound => {
            HttpResponse::NotFound().json(json!({"detail": "Job not found"}))
        }
        ShareFailure::NotShareable(m) => HttpResponse::Conflict().json(json!({"detail": m})),
        ShareFailure::TooLarge | ShareFailure::Remote(ShareError::TooLarge) => {
            HttpResponse::PayloadTooLarge()
                .json(json!({"detail": "This result is too large to share"}))
        }
        ShareFailure::Remote(ShareError::Unavailable) => HttpResponse::ServiceUnavailable()
            .json(json!({"detail": "Sharing is temporarily unavailable, try again later"})),
        ShareFailure::Remote(ShareError::RateLimited) => HttpResponse::TooManyRequests()
            .json(json!({"detail": "Too many shares, try again in a few minutes"})),
        ShareFailure::Remote(ShareError::Rejected(m)) => {
            eprintln!("simhammer.com rejected the share: {m}");
            HttpResponse::BadRequest().json(json!({"detail": "simhammer.com rejected the share"}))
        }
        ShareFailure::Remote(e) => {
            eprintln!("simhammer.com share request failed: {e:?}");
            HttpResponse::BadGateway().json(json!({"detail": "simhammer.com unreachable"}))
        }
        ShareFailure::Db(m) => HttpResponse::InternalServerError().json(json!({"detail": m})),
    }
}

pub(super) async fn create_share(
    path: web::Path<String>,
    body: web::Json<ShareInput>,
    repo: web::Data<JobRepo>,
) -> HttpResponse {
    match share_job(
        &HttpShareClient::new(),
        repo.get_ref(),
        &path.into_inner(),
        &body,
    )
    .await
    {
        Ok(share_id) => HttpResponse::Ok().json(json!({ "share_id": share_id })),
        Err(f) => failure_response(f),
    }
}

pub(super) async fn delete_share(
    path: web::Path<String>,
    repo: web::Data<JobRepo>,
) -> HttpResponse {
    match unshare_job(&HttpShareClient::new(), repo.get_ref(), &path.into_inner()).await {
        Ok(()) => HttpResponse::NoContent().finish(),
        Err(f) => failure_response(f),
    }
}

/// Cleans a shared request before the editor loads it; see `sanitize_shared_request`.
pub(super) async fn sanitize_shared(body: web::Json<Value>) -> HttpResponse {
    HttpResponse::Ok().json(sanitize_shared_request(body.into_inner()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::body::to_bytes;

    async fn body_of(r: HttpResponse) -> String {
        String::from_utf8(to_bytes(r.into_body()).await.unwrap().to_vec()).unwrap()
    }

    #[actix_web::test]
    async fn unreachable_hides_the_raw_error() {
        let r = failure_response(ShareFailure::Remote(ShareError::Unreachable(
            "dns error".into(),
        )));
        assert_eq!(r.status(), actix_web::http::StatusCode::BAD_GATEWAY);
        assert_eq!(
            body_of(r).await,
            r#"{"detail":"simhammer.com unreachable"}"#
        );
    }

    #[actix_web::test]
    async fn rejected_hides_the_remote_body() {
        let r = failure_response(ShareFailure::Remote(ShareError::Rejected("<html>".into())));
        assert_eq!(r.status(), actix_web::http::StatusCode::BAD_REQUEST);
        assert_eq!(
            body_of(r).await,
            r#"{"detail":"simhammer.com rejected the share"}"#
        );
    }
}
