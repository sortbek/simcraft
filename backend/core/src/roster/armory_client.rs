use serde_json::Value;

/// Raw armory JSON for one character (already proxied through simhammer.com).
pub struct ArmoryData {
    pub equipment: Value,
    pub specializations: Value,
}

#[derive(Debug)]
pub enum ArmoryError {
    NotFound,
    Http(String),
}

#[async_trait::async_trait]
pub trait ArmoryClient: Send + Sync {
    async fn fetch(&self, region: &str, realm: &str, name: &str) -> Result<ArmoryData, ArmoryError>;
}

/// Blizzard realm slug: lowercase, spaces/apostrophes -> hyphens.
pub fn realm_slug(realm: &str) -> String {
    realm.trim().to_lowercase().replace([' ', '\''], "-")
}

pub struct HttpArmoryClient {
    http: reqwest::Client,
    base: String,
}

impl HttpArmoryClient {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        // Mirror the app's shared client timeouts so a slow/hung proxy can't
        // stall the (sequential) import loop indefinitely.
        let http = reqwest::Client::builder()
            .user_agent(concat!("simhammer/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_default();
        Self {
            http,
            base: "https://simhammer.com".to_string(),
        }
    }

    async fn get_json(&self, url: &str) -> Result<serde_json::Value, ArmoryError> {
        let resp = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|e| ArmoryError::Http(e.to_string()))?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(ArmoryError::NotFound);
        }
        if !resp.status().is_success() {
            return Err(ArmoryError::Http(format!("status {}", resp.status())));
        }
        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| ArmoryError::Http(e.to_string()))
    }
}

#[async_trait::async_trait]
impl ArmoryClient for HttpArmoryClient {
    async fn fetch(&self, region: &str, realm: &str, name: &str) -> Result<ArmoryData, ArmoryError> {
        let slug = realm_slug(realm);
        let name_l = name.trim().to_lowercase();
        let url = |kind: &str| {
            format!(
                "{}/api/blizzard/character/{}/{}/{}/{}",
                self.base, region, slug, name_l, kind
            )
        };
        let equipment = self.get_json(&url("equipment")).await?;
        let specializations = self.get_json(&url("specializations")).await?;
        Ok(ArmoryData {
            equipment,
            specializations,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugifies_realm() {
        assert_eq!(realm_slug("Tarren Mill"), "tarren-mill");
        assert_eq!(realm_slug("Lightbringer"), "lightbringer");
        assert_eq!(realm_slug("Quel'Thalas"), "quel-thalas");
    }
}
