use base64::Engine;
use flate2::{write::GzEncoder, Compression};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::Write;

use crate::models::{Job, JobStatus};

pub const MAX_PAYLOAD_GZ_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareInput {
    pub summary: Value,
    pub app_version: String,
    pub simc_build: Option<String>,
    #[serde(default)]
    pub lookups: Option<Value>,
}

#[derive(Debug)]
pub enum BuildError {
    NotShareable(String),
    TooLarge,
}

pub fn build_share_body(job: &Job, input: &ShareInput) -> Result<Value, BuildError> {
    if !matches!(job.status, JobStatus::Done) {
        return Err(BuildError::NotShareable(
            "Only finished sims can be shared".into(),
        ));
    }
    let mut result: Value = job
        .result_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .ok_or_else(|| BuildError::NotShareable("This sim has no result".into()))?;
    crate::result_parser::backfill_setup(&mut result, job.raw_json.as_deref());
    let request: Value = job
        .client_request
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(Value::Null);
    let mut payload = json!({
        "v": 1,
        "requestVersion": 1,
        "mode": job.sim_type,
        "result": result,
        "request": request,
        "simcInput": job.simc_input,
    });
    if let Some(lookups) = &input.lookups {
        payload["lookups"] = lookups.clone();
    }
    let mut enc = GzEncoder::new(Vec::new(), Compression::default());
    enc.write_all(payload.to_string().as_bytes())
        .expect("gzip to Vec cannot fail");
    let gz = enc.finish().expect("gzip to Vec cannot fail");
    if gz.len() > MAX_PAYLOAD_GZ_BYTES {
        return Err(BuildError::TooLarge);
    }
    Ok(json!({
        "summary": input.summary,
        "meta": {
            "appVersion": input.app_version,
            "simcBuild": input.simc_build,
            "mode": job.sim_type,
            "simmedAt": job.created_at,
        },
        "payload": base64::engine::general_purpose::STANDARD.encode(gz),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Job, JobStatus};
    use base64::Engine;
    use flate2::read::GzDecoder;
    use serde_json::json;
    use std::io::Read;

    fn done_job() -> Job {
        let mut job = Job::new_with_provider(
            "mage=\"T\"".into(),
            "top_gear".into(),
            1000,
            "Patchwerk".into(),
            0.1,
            "local".into(),
        );
        job.status = JobStatus::Done;
        job.result_json =
            Some(r#"{"result_kind":"gear_comparison","base_dps":1.0,"results":[]}"#.into());
        job.client_request = Some(r#"{"simc_input":"mage=\"T\""}"#.into());
        job
    }

    fn input() -> ShareInput {
        ShareInput {
            summary: json!({"v": 1}),
            app_version: "4.4.3".into(),
            simc_build: Some("abc".into()),
            lookups: None,
        }
    }

    fn decode(body: &Value) -> Value {
        let gz = base64::engine::general_purpose::STANDARD
            .decode(body["payload"].as_str().unwrap())
            .unwrap();
        let mut s = String::new();
        GzDecoder::new(&gz[..]).read_to_string(&mut s).unwrap();
        serde_json::from_str(&s).unwrap()
    }

    #[test]
    fn builds_body_with_meta_and_gzipped_payload() {
        let job = done_job();
        let body = build_share_body(&job, &input()).unwrap();
        assert_eq!(
            body["meta"],
            json!({"appVersion": "4.4.3", "simcBuild": "abc", "mode": "top_gear", "simmedAt": job.created_at})
        );
        assert_eq!(body["summary"], json!({"v": 1}));
        let p = decode(&body);
        assert_eq!(p["v"], 1);
        assert_eq!(p["requestVersion"], 1);
        assert_eq!(p["mode"], "top_gear");
        assert_eq!(p["result"]["base_dps"], 1.0);
        assert_eq!(p["request"]["simc_input"], "mage=\"T\"");
        assert_eq!(p["simcInput"], "mage=\"T\"");
    }

    #[test]
    fn lookups_are_embedded_only_when_sent() {
        let job = done_job();
        assert!(decode(&build_share_body(&job, &input()).unwrap())
            .get("lookups")
            .is_none());
        let with = ShareInput {
            lookups: Some(json!({"items": {"1": {"name": "X"}}})),
            ..input()
        };
        let p = decode(&build_share_body(&job, &with).unwrap());
        assert_eq!(p["lookups"]["items"]["1"]["name"], "X");
        assert_eq!(p["v"], 1);
    }

    #[test]
    fn share_input_without_lookups_deserializes() {
        let i: ShareInput =
            serde_json::from_value(json!({"summary": {}, "appVersion": "1"})).unwrap();
        assert!(i.lookups.is_none());
    }

    #[test]
    fn job_without_client_request_has_null_request() {
        let mut job = done_job();
        job.client_request = None;
        assert!(decode(&build_share_body(&job, &input()).unwrap())["request"].is_null());
    }

    #[test]
    fn unfinished_job_is_not_shareable() {
        let mut job = done_job();
        job.status = JobStatus::Running;
        assert!(matches!(
            build_share_body(&job, &input()),
            Err(BuildError::NotShareable(_))
        ));
    }

    // SplitMix64 PRNG for the oversized-payload test: a linear hash of the loop
    // index compresses ~10x under real DEFLATE and never exceeds the cap, so we
    // need genuinely non-linear, incompressible bytes here instead.
    fn splitmix64_next(z: u64) -> (u64, u64) {
        let z = z.wrapping_add(0x9E3779B97F4A7C15);
        let mut v = z;
        v = (v ^ (v >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        v = (v ^ (v >> 27)).wrapping_mul(0x94D049BB133111EB);
        v ^= v >> 31;
        (z, v)
    }

    #[test]
    fn oversized_payload_is_rejected_before_upload() {
        let mut job = done_job();
        // incompressible ~3 MB string
        let mut state = 12345u64;
        let noise: String = (0..3_000_000u32)
            .map(|_| {
                let (next_state, v) = splitmix64_next(state);
                state = next_state;
                char::from(b'!' + (v % 90) as u8)
            })
            .collect();
        job.simc_input = noise;
        assert!(matches!(
            build_share_body(&job, &input()),
            Err(BuildError::TooLarge)
        ));
    }
}
