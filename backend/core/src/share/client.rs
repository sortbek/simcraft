use serde::Deserialize;
use serde_json::Value;
use std::sync::LazyLock;

const DEFAULT_SHARE_URL: &str = "https://simhammer.com";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedShare {
    pub id: String,
    #[serde(default)]
    pub url: String,
    pub delete_token: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ShareError {
    RateLimited,
    TooLarge,
    Rejected(String),
    NotFound,
    Forbidden,
    /// simhammer.com is up but not taking shares right now (e.g. storage full).
    Unavailable,
    Unreachable(String),
}

#[async_trait::async_trait]
pub trait ShareClient: Send + Sync {
    async fn create(&self, body: &Value) -> Result<CreatedShare, ShareError>;
    async fn delete(&self, share_id: &str, token: &str) -> Result<(), ShareError>;
}

pub struct HttpShareClient {
    http: reqwest::Client,
    base: String,
}

// One pooled client for every share call instead of a TLS setup per request.
static HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(concat!("simhammer/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(60))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default()
});

/// `SIMHAMMER_SHARE_URL` for local testing. Delete tokens travel to it, so it must
/// be https unless it points at this machine.
fn share_base(configured: Option<&str>) -> String {
    let Some(raw) = configured
        .map(|s| s.trim().trim_end_matches('/'))
        .filter(|s| !s.is_empty())
    else {
        return DEFAULT_SHARE_URL.into();
    };
    let local = ["http://localhost", "http://127.0.0.1", "http://[::1]"]
        .iter()
        .any(|p| {
            raw.strip_prefix(p)
                .is_some_and(|rest| rest.is_empty() || rest.starts_with(':'))
        });
    if raw.starts_with("https://") || local {
        raw.to_string()
    } else {
        eprintln!("Ignoring SIMHAMMER_SHARE_URL={raw}: only https or a local address is allowed");
        DEFAULT_SHARE_URL.into()
    }
}

impl HttpShareClient {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        let base = share_base(std::env::var("SIMHAMMER_SHARE_URL").ok().as_deref());
        Self {
            http: HTTP.clone(),
            base,
        }
    }
}

#[async_trait::async_trait]
impl ShareClient for HttpShareClient {
    async fn create(&self, body: &Value) -> Result<CreatedShare, ShareError> {
        let res = self
            .http
            .post(format!("{}/api/share", self.base))
            .json(body)
            .send()
            .await
            .map_err(|e| ShareError::Unreachable(e.to_string()))?;
        match res.status().as_u16() {
            201 | 200 => res
                .json()
                .await
                .map_err(|e| ShareError::Unreachable(e.to_string())),
            429 => Err(ShareError::RateLimited),
            413 => Err(ShareError::TooLarge),
            503 => Err(ShareError::Unavailable),
            400 => Err(ShareError::Rejected(res.text().await.unwrap_or_default())),
            s => Err(ShareError::Unreachable(format!("HTTP {s}"))),
        }
    }

    async fn delete(&self, share_id: &str, token: &str) -> Result<(), ShareError> {
        let res = self
            .http
            .delete(format!("{}/api/share/{}", self.base, share_id))
            .header("X-Delete-Token", token)
            .send()
            .await
            .map_err(|e| ShareError::Unreachable(e.to_string()))?;
        match res.status().as_u16() {
            204 | 200 => Ok(()),
            403 => Err(ShareError::Forbidden),
            404 => Err(ShareError::NotFound),
            s => Err(ShareError::Unreachable(format!("HTTP {s}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::share_base;

    #[test]
    fn share_base_accepts_https_and_this_machine_only() {
        assert_eq!(share_base(None), "https://simhammer.com");
        assert_eq!(
            share_base(Some("https://staging.example.com/")),
            "https://staging.example.com"
        );
        assert_eq!(
            share_base(Some("http://localhost:3001")),
            "http://localhost:3001"
        );
        assert_eq!(
            share_base(Some("http://localhost.evil.com")),
            "https://simhammer.com"
        );
        assert_eq!(
            share_base(Some("http://example.com")),
            "https://simhammer.com"
        );
    }
}
