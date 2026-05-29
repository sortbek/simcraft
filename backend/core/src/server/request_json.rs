use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The shape stored in `jobs.request_json`. Each sim type wraps its normalized
/// request in this envelope so the resumer can dispatch by `sim_type`.
#[derive(Debug, Serialize, Deserialize)]
pub struct NormalizedRequest {
    pub sim_type: String,
    pub version: u32,
    pub payload: Value,
}

impl NormalizedRequest {
    pub fn new(sim_type: impl Into<String>, payload: Value) -> Self {
        Self {
            sim_type: sim_type.into(),
            version: 1,
            payload,
        }
    }

    pub fn to_json_string(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}
