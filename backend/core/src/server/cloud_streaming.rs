//! Cloud-streaming orchestrator for streaming-sized Top Gear on Simmit.
//!
//! Streams the existing `ProfilesetIterator` into bounded chunks, submits each
//! to Simmit (server-side multistage), accumulates per-chunk SimC-JSON results,
//! checkpoints chunk state for crash/pause recovery, and finalizes through the
//! existing gear-comparison parser. Parallel to `server/streaming_top_gear.rs`
//! (which owns the LOCAL triage path). See the B2 design spec.

use serde_json::{json, Value};

use crate::db::cloud_chunks_repo::ChunkResultEnvelope;

/// Per-job profileset ceiling for one Simmit chunk. The effective limit is "the
/// job completes within `limits.maxRuntimeSeconds`", which is EMPIRICAL — there
/// is no documented Simmit max-profileset/payload cap. Start conservative and
/// tune against real runs (see spec Risk #1). Treat as tunable, not load-bearing
/// correctness.
pub const REMOTE_MAX_PROFILESETS_PER_JOB: usize = 2_000;

/// Max concurrent in-flight Simmit chunk submissions. The effective bound is
/// `min(CONFIG_MAX_INFLIGHT, usage.limits.maxActiveJobs)`. Conservative default.
pub const CONFIG_MAX_INFLIGHT: usize = 4;

/// Folds per-chunk Simmit results into one SimC-shaped JSON document compatible
/// with `result_parser::parse_gear_comparison_result`. Small: one base actor +
/// N profileset result rows + a summed credits block — never N full JSON docs.
#[derive(Debug, Default)]
pub struct ChunkAccumulator {
    base_player: Option<Value>,
    profilesets: Vec<Value>,
    credits_consumed: u64,
}

impl ChunkAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Fold one chunk's envelope. `base_player` is taken from the FIRST chunk
    /// that carries one (chunk 0). Profileset rows are concatenated in arrival
    /// order; the final `parse_gear_comparison_result` re-sorts by DPS, so order
    /// here is irrelevant to the ranking.
    pub fn add_envelope(&mut self, env: ChunkResultEnvelope, credits: u64) {
        if self.base_player.is_none() {
            if let Some(bp) = env.base_player {
                self.base_player = Some(bp);
            }
        }
        self.profilesets.extend(env.profilesets);
        self.credits_consumed = self.credits_consumed.saturating_add(credits);
    }

    /// Extract a chunk's envelope from a raw adapted Simmit `SimcOutput.json`
    /// (the `simmit_result_to_simc_output` / artifact shape). `include_base`
    /// should be true ONLY for chunk 0.
    pub fn envelope_from_simc_json(json: &Value, include_base: bool) -> ChunkResultEnvelope {
        let sim = json.get("sim");
        let profilesets = sim
            .and_then(|s| s.get("profilesets"))
            .and_then(|p| p.get("results"))
            .and_then(|r| r.as_array())
            .cloned()
            .unwrap_or_default();
        let base_player = if include_base {
            sim.and_then(|s| s.get("players"))
                .and_then(|p| p.as_array())
                .and_then(|arr| arr.first())
                .cloned()
        } else {
            None
        };
        ChunkResultEnvelope { profilesets, base_player }
    }

    /// Pull a chunk's credits from its adapted Simmit JSON
    /// (`simmit.credits_consumed`).
    pub fn credits_from_simc_json(json: &Value) -> u64 {
        json.get("simmit")
            .and_then(|m| m.get("credits_consumed"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0)
    }

    /// Produce the merged SimC-shaped JSON for `parse_gear_comparison_result`.
    pub fn into_merged_simc_json(self) -> Value {
        let base_player = self.base_player.unwrap_or_else(|| {
            json!({
                "name": "",
                "collected_data": { "dps": { "mean": 0.0, "mean_std_dev": 0.0, "std_dev": 0.0 } }
            })
        });
        json!({
            "sim": {
                "players": [base_player],
                "profilesets": { "results": self.profilesets },
            },
            "simmit": { "credits_consumed": self.credits_consumed }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn chunk_json(base_name: &str, base_dps: f64, rows: &[(&str, f64)]) -> Value {
        let results: Vec<Value> = rows
            .iter()
            .map(|(n, d)| json!({ "name": n, "mean": d }))
            .collect();
        json!({
            "sim": {
                "players": [{
                    "name": base_name,
                    "collected_data": { "dps": { "mean": base_dps, "mean_std_dev": 0.0 } }
                }],
                "profilesets": { "results": results }
            },
            "simmit": { "credits_consumed": 100 }
        })
    }

    #[test]
    fn merges_two_chunks_into_parseable_doc() {
        let c0 = chunk_json("Hero", 1000.0, &[("Combo 1", 1100.0), ("Combo 2", 1050.0)]);
        let c1 = chunk_json("Hero", 1000.0, &[("Combo 3", 1200.0), ("Combo 4", 900.0)]);

        let mut acc = ChunkAccumulator::new();
        acc.add_envelope(
            ChunkAccumulator::envelope_from_simc_json(&c0, true),
            ChunkAccumulator::credits_from_simc_json(&c0),
        );
        acc.add_envelope(
            ChunkAccumulator::envelope_from_simc_json(&c1, false),
            ChunkAccumulator::credits_from_simc_json(&c1),
        );
        let merged = acc.into_merged_simc_json();

        // base_player from chunk 0; 4 profilesets total; credits summed.
        assert_eq!(merged["sim"]["players"][0]["name"], "Hero");
        assert_eq!(merged["sim"]["profilesets"]["results"].as_array().unwrap().len(), 4);
        assert_eq!(merged["simmit"]["credits_consumed"], 200);

        // The merged doc parses, and the top row is the global best (Combo 3).
        let meta: HashMap<String, Vec<Value>> = HashMap::new();
        let parsed = crate::result_parser::parse_gear_comparison_result(&merged, Some(&meta), "top_gear");
        assert_eq!(parsed["base_dps"], 1000.0);
        let results = parsed["results"].as_array().unwrap();
        // results includes the baseline ("Currently Equipped") row + 4 combos,
        // sorted DESC by dps. The first non-baseline top entry is Combo 3 @1200.
        let top = results.iter().find(|r| r["name"] == "Combo 3").unwrap();
        assert_eq!(top["dps"], 1200.0);
        assert_eq!(top["delta"], 200.0);
    }

    #[test]
    fn merged_topn_equals_single_job_equivalent() {
        // A single job that simmed all 4 combos would produce this doc:
        let single = chunk_json(
            "Hero", 1000.0,
            &[("Combo 1", 1100.0), ("Combo 2", 1050.0), ("Combo 3", 1200.0), ("Combo 4", 900.0)],
        );
        let meta: HashMap<String, Vec<Value>> = HashMap::new();
        let single_parsed =
            crate::result_parser::parse_gear_comparison_result(&single, Some(&meta), "top_gear");

        // The two-chunk merge from the previous test, recomputed:
        let c0 = chunk_json("Hero", 1000.0, &[("Combo 1", 1100.0), ("Combo 2", 1050.0)]);
        let c1 = chunk_json("Hero", 1000.0, &[("Combo 3", 1200.0), ("Combo 4", 900.0)]);
        let mut acc = ChunkAccumulator::new();
        acc.add_envelope(ChunkAccumulator::envelope_from_simc_json(&c0, true), 0);
        acc.add_envelope(ChunkAccumulator::envelope_from_simc_json(&c1, false), 0);
        let merged_parsed = crate::result_parser::parse_gear_comparison_result(
            &acc.into_merged_simc_json(), Some(&meta), "top_gear",
        );

        // Top-N (name + dps order) must be identical.
        let names = |v: &Value| -> Vec<String> {
            v["results"].as_array().unwrap().iter()
                .map(|r| r["name"].as_str().unwrap().to_string()).collect()
        };
        assert_eq!(names(&single_parsed), names(&merged_parsed));
        assert_eq!(single_parsed["base_dps"], merged_parsed["base_dps"]);
    }

    #[test]
    fn base_player_taken_from_chunk_0_only() {
        // chunk 0 has base "Hero A", chunk 1 has base "Hero B"
        // The accumulated result should use "Hero A" (chunk 0's base).
        let c0 = chunk_json("Hero A", 1000.0, &[("Combo 1", 1100.0)]);
        let c1 = chunk_json("Hero B", 1000.0, &[("Combo 2", 1050.0)]);

        let mut acc = ChunkAccumulator::new();
        acc.add_envelope(ChunkAccumulator::envelope_from_simc_json(&c0, true), 0);
        acc.add_envelope(ChunkAccumulator::envelope_from_simc_json(&c1, false), 0);
        let merged = acc.into_merged_simc_json();

        assert_eq!(merged["sim"]["players"][0]["name"], "Hero A");
    }

    #[test]
    fn credits_summed_across_chunks() {
        let c0 = chunk_json("Hero", 1000.0, &[("Combo 1", 1100.0)]);
        let c1 = chunk_json("Hero", 1000.0, &[("Combo 2", 1050.0)]);
        let c2 = chunk_json("Hero", 1000.0, &[("Combo 3", 900.0)]);

        let mut acc = ChunkAccumulator::new();
        acc.add_envelope(
            ChunkAccumulator::envelope_from_simc_json(&c0, true),
            ChunkAccumulator::credits_from_simc_json(&c0),
        );
        acc.add_envelope(
            ChunkAccumulator::envelope_from_simc_json(&c1, false),
            ChunkAccumulator::credits_from_simc_json(&c1),
        );
        acc.add_envelope(
            ChunkAccumulator::envelope_from_simc_json(&c2, false),
            ChunkAccumulator::credits_from_simc_json(&c2),
        );
        let merged = acc.into_merged_simc_json();

        // Each chunk_json has credits_consumed=100, so total should be 300.
        assert_eq!(merged["simmit"]["credits_consumed"], 300);
    }
}
