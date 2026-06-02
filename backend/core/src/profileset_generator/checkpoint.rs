//! Checkpoint serde for pause/resume. The Checkpoint is stored as JSON in
//! `jobs.checkpoint`. Written at every Triage batch boundary and every
//! staged-pipeline stage boundary. See spec §5.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::triage::TriageConstants;

/// Tagged union: the current sim phase determines which payload variant is active.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "lowercase")]
pub enum CheckpointPhase {
    Triage(TriageCheckpoint),
    Staged(StagedCheckpoint),
    LocalStage(LocalStageCheckpoint),
    /// Cloud-streaming (Simmit) phase: the high-level chunk cursor. The
    /// per-chunk source of truth lives in the `cloud_chunks` table; this blob
    /// only carries what's needed to deterministically regenerate the
    /// not-yet-submitted chunks.
    CloudStreaming(CloudStreamingCheckpoint),
}

/// Full checkpoint blob persisted to `jobs.checkpoint`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    /// Which phase the sim is in at this checkpoint and the data needed to resume.
    pub phase: CheckpointPhase,
    /// Snapshot of TriageConstants used by this run. Resume reuses the same
    /// values even if defaults change between versions.
    pub constants: TriageConstants,
}

/// Triage-phase resume data: where the iterator was when the last batch committed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriageCheckpoint {
    /// Cursor position to seek to before pulling the next batch.
    pub next_cursor: Vec<usize>,
    /// 0-based index of the next batch to pull (matches triage_batches.batch_idx).
    pub next_batch_idx: i64,
    /// Next combo_id to assign on acceptance (combo_metadata.combo_id is monotonic).
    pub next_combo_id: i64,
    /// Estimated total batches; used by the progress reporter.
    pub estimated_total_batches: usize,
    /// Running tally of survivors retained so far.
    pub survivors_so_far: usize,
    /// EWMA of bytes-per-profileset for adaptive batch sizing.
    pub avg_bytes_per_profileset: usize,
}

/// Staged-phase resume data: which stage to run next and which combos to feed it.
///
/// Intermediate stages run in profileset batches. A mid-stage pause records the
/// next batch index and the accumulated profileset results from completed
/// batches, so resume can continue without re-running them. `next_batch_idx ==
/// 0` and `batch_results` empty means the stage starts fresh — which is the
/// only state writable for a stage boundary checkpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StagedCheckpoint {
    /// 0-based index of the next pipeline stage (Probe=0, Coarse=1, ..., Final=last).
    pub next_stage_idx: usize,
    /// Human-readable name of the next stage, for progress display.
    pub next_stage_name: String,
    /// combo_ids of the survivors that should feed into next_stage_idx. Resume
    /// loads their profileset_simc fragments from combo_metadata.
    pub survivor_combo_ids: Vec<i64>,
    /// 0-based index of the next batch to run within the current stage. `0`
    /// means "start the stage from batch 0" (i.e. a clean stage boundary).
    /// Older checkpoints without this field default to 0.
    #[serde(default)]
    pub next_batch_idx: usize,
    /// Profileset results accumulated from batches already completed in the
    /// current stage. Combined with results from the remaining batches to
    /// drive end-of-stage pruning.
    #[serde(default)]
    pub batch_results: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalStageCheckpoint {
    pub stage_idx: usize,
    pub stage_name: String,
    pub next_batch_idx: usize,
    pub source: CheckpointSource,
    pub survivor_combo_ids: Vec<i64>,
    pub generated_cursor: Option<Vec<usize>>,
    pub next_combo_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum CheckpointSource {
    GeneratedCombinations,
    PreviousStageSurvivors,
}

/// Cloud-streaming-phase resume data. Written at each chunk boundary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudStreamingCheckpoint {
    /// 0-based index of the next chunk to generate/submit (matches
    /// cloud_chunks.chunk_idx).
    pub next_chunk_idx: usize,
    /// The `ProfilesetIterator` cursor to seek to before pulling the next
    /// chunk's candidates. Regenerates un-submitted chunks deterministically.
    pub iterator_cursor: Vec<usize>,
    /// Profilesets-per-chunk ceiling this run used (so resume rebuilds the same
    /// chunk boundaries even if the default constant changes between versions).
    pub chunk_size: usize,
    /// Estimated total chunk count; drives the progress reporter.
    pub total_chunks_estimate: usize,
    /// The `ProfilesetIterator::next_name_idx` at the chunk boundary. Persisting
    /// this fixes a resume name-collision bug: constructing a new iterator + seek
    /// always resets next_name_idx to 1, causing resumed chunks to re-emit
    /// "Combo 1", "Combo 2", … and collide with names from earlier chunks.
    /// Older checkpoints without this field default to 1 (safe: only a fresh
    /// cloud run would ever resume without it, and it won't have prior chunks).
    #[serde(default = "default_next_name_idx")]
    pub next_name_idx: usize,
}

fn default_next_name_idx() -> usize {
    1
}

impl Checkpoint {
    pub fn to_json_string(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    pub fn from_json_str(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_triage_phase() {
        let cp = Checkpoint {
            phase: CheckpointPhase::Triage(TriageCheckpoint {
                next_cursor: vec![3, 7, 0, 12],
                next_batch_idx: 38,
                next_combo_id: 1843,
                estimated_total_batches: 52,
                survivors_so_far: 127432,
                avg_bytes_per_profileset: 612,
            }),
            constants: TriageConstants::default(),
        };
        let json = cp.to_json_string().unwrap();
        let parsed = Checkpoint::from_json_str(&json).unwrap();
        match parsed.phase {
            CheckpointPhase::Triage(tc) => {
                assert_eq!(tc.next_cursor, vec![3, 7, 0, 12]);
                assert_eq!(tc.next_batch_idx, 38);
                assert_eq!(tc.next_combo_id, 1843);
                assert_eq!(tc.estimated_total_batches, 52);
                assert_eq!(tc.survivors_so_far, 127432);
                assert_eq!(tc.avg_bytes_per_profileset, 612);
            }
            _ => panic!("expected Triage phase"),
        }
    }

    #[test]
    fn round_trip_staged_phase() {
        let cp = Checkpoint {
            phase: CheckpointPhase::Staged(StagedCheckpoint {
                next_stage_idx: 2,
                next_stage_name: "Refine".to_string(),
                survivor_combo_ids: vec![1842, 1843, 2914],
                next_batch_idx: 0,
                batch_results: Vec::new(),
            }),
            constants: TriageConstants::default(),
        };
        let json = cp.to_json_string().unwrap();
        let parsed = Checkpoint::from_json_str(&json).unwrap();
        match parsed.phase {
            CheckpointPhase::Staged(sc) => {
                assert_eq!(sc.next_stage_idx, 2);
                assert_eq!(sc.next_stage_name, "Refine");
                assert_eq!(sc.survivor_combo_ids, vec![1842, 1843, 2914]);
                assert_eq!(sc.next_batch_idx, 0);
                assert!(sc.batch_results.is_empty());
            }
            _ => panic!("expected Staged phase"),
        }
    }

    #[test]
    fn round_trip_staged_mid_batch() {
        let cp = Checkpoint {
            phase: CheckpointPhase::Staged(StagedCheckpoint {
                next_stage_idx: 1,
                next_stage_name: "Coarse".to_string(),
                survivor_combo_ids: vec![1, 2, 3],
                next_batch_idx: 5,
                batch_results: vec![
                    serde_json::json!({ "name": "Combo 1", "mean": 1000.0 }),
                    serde_json::json!({ "name": "Combo 2", "mean": 950.0 }),
                ],
            }),
            constants: TriageConstants::default(),
        };
        let json = cp.to_json_string().unwrap();
        let parsed = Checkpoint::from_json_str(&json).unwrap();
        match parsed.phase {
            CheckpointPhase::Staged(sc) => {
                assert_eq!(sc.next_batch_idx, 5);
                assert_eq!(sc.batch_results.len(), 2);
            }
            _ => panic!("expected Staged phase"),
        }
    }

    #[test]
    fn round_trip_local_stage_checkpoint() {
        let cp = Checkpoint {
            phase: CheckpointPhase::LocalStage(LocalStageCheckpoint {
                stage_idx: 1,
                stage_name: "Refine".to_string(),
                next_batch_idx: 4,
                source: CheckpointSource::PreviousStageSurvivors,
                survivor_combo_ids: vec![9, 3, 7],
                generated_cursor: Some(vec![2, 5, 0]),
                next_combo_id: 42,
            }),
            constants: TriageConstants::default(),
        };
        let json = cp.to_json_string().unwrap();
        let parsed = Checkpoint::from_json_str(&json).unwrap();
        match parsed.phase {
            CheckpointPhase::LocalStage(local) => {
                assert_eq!(local.stage_idx, 1);
                assert_eq!(local.stage_name, "Refine");
                assert_eq!(local.next_batch_idx, 4);
                assert!(matches!(
                    local.source,
                    CheckpointSource::PreviousStageSurvivors
                ));
                assert_eq!(local.survivor_combo_ids, vec![9, 3, 7]);
                assert_eq!(local.generated_cursor, Some(vec![2, 5, 0]));
                assert_eq!(local.next_combo_id, 42);
            }
            _ => panic!("expected LocalStage phase"),
        }
    }

    /// Old checkpoints written before mid-stage batching shouldn't fail to
    /// deserialize. The on-disk shape is `{"phase": {"phase":"staged", ...},
    /// "constants": ...}` because CheckpointPhase uses internal tagging.
    #[test]
    fn legacy_staged_checkpoint_deserializes_with_defaults() {
        let constants_json = serde_json::to_string(&TriageConstants::default()).unwrap();
        let legacy = format!(
            r#"{{"phase":{{"phase":"staged","next_stage_idx":0,"next_stage_name":"Probe","survivor_combo_ids":[1,2,3]}},"constants":{}}}"#,
            constants_json
        );
        let parsed = Checkpoint::from_json_str(&legacy).unwrap();
        match parsed.phase {
            CheckpointPhase::Staged(sc) => {
                assert_eq!(sc.next_stage_idx, 0);
                assert_eq!(sc.next_stage_name, "Probe");
                assert_eq!(sc.survivor_combo_ids, vec![1, 2, 3]);
                assert_eq!(sc.next_batch_idx, 0);
                assert!(sc.batch_results.is_empty());
            }
            _ => panic!("expected Staged phase"),
        }
    }

    #[test]
    fn tagged_union_uses_phase_discriminator() {
        let cp = Checkpoint {
            phase: CheckpointPhase::Triage(TriageCheckpoint {
                next_cursor: vec![],
                next_batch_idx: 0,
                next_combo_id: 1,
                estimated_total_batches: 1,
                survivors_so_far: 0,
                avg_bytes_per_profileset: 0,
            }),
            constants: TriageConstants::default(),
        };
        let json = cp.to_json_string().unwrap();
        // The JSON should contain "phase":"triage" because of #[serde(tag = "phase", rename_all = "lowercase")].
        assert!(
            json.contains("\"phase\":\"triage\""),
            "expected phase tag in JSON: {}",
            json
        );
    }

    #[test]
    fn round_trip_cloud_streaming_phase() {
        let cp = Checkpoint {
            phase: CheckpointPhase::CloudStreaming(CloudStreamingCheckpoint {
                next_chunk_idx: 3,
                iterator_cursor: vec![2, 0, 5, 0],
                chunk_size: 5000,
                total_chunks_estimate: 12,
                next_name_idx: 15001,
            }),
            constants: TriageConstants::default(),
        };
        let json = cp.to_json_string().unwrap();
        assert!(
            json.contains("\"phase\":\"cloudstreaming\""),
            "expected cloudstreaming tag in JSON: {json}"
        );
        let parsed = Checkpoint::from_json_str(&json).unwrap();
        match parsed.phase {
            CheckpointPhase::CloudStreaming(cc) => {
                assert_eq!(cc.next_chunk_idx, 3);
                assert_eq!(cc.iterator_cursor, vec![2, 0, 5, 0]);
                assert_eq!(cc.chunk_size, 5000);
                assert_eq!(cc.total_chunks_estimate, 12);
                assert_eq!(cc.next_name_idx, 15001);
            }
            _ => panic!("expected CloudStreaming phase"),
        }
    }

    /// Old cloud-streaming checkpoints written before `next_name_idx` was added
    /// should deserialize without error, defaulting to 1 (which is safe: only a
    /// fresh cloud run could lack the field, and it won't have prior chunks whose
    /// names could collide).
    #[test]
    fn legacy_cloud_streaming_checkpoint_deserializes_with_default_next_name_idx() {
        let constants_json = serde_json::to_string(&TriageConstants::default()).unwrap();
        let legacy = format!(
            r#"{{"phase":{{"phase":"cloudstreaming","next_chunk_idx":2,"iterator_cursor":[1,0],"chunk_size":5000,"total_chunks_estimate":10}},"constants":{}}}"#,
            constants_json
        );
        let parsed = Checkpoint::from_json_str(&legacy).unwrap();
        match parsed.phase {
            CheckpointPhase::CloudStreaming(cc) => {
                assert_eq!(cc.next_chunk_idx, 2);
                assert_eq!(cc.iterator_cursor, vec![1, 0]);
                assert_eq!(cc.chunk_size, 5000);
                assert_eq!(cc.total_chunks_estimate, 10);
                assert_eq!(cc.next_name_idx, 1, "missing next_name_idx should default to 1");
            }
            _ => panic!("expected CloudStreaming phase"),
        }
    }
}
