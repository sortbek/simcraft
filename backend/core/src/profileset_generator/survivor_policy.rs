use serde_json::Value;
use std::collections::HashSet;

const LEGACY_FALLBACK_MULTIPLIER: f64 = 2.0;

#[derive(Debug, Clone)]
pub struct SurvivorPolicy {
    pub confidence_z: f64,
    pub min_keep: usize,
    pub global_target: usize,
    pub hard_max: usize,
    pub always_keep_baseline: bool,
    pub local_prefilter: bool,
    pub global_prune_after_stage: bool,
}

#[derive(Debug, Clone)]
pub struct CandidateResult {
    pub combo_id: i64,
    pub combo_name: String,
    pub combo_key: String,
    pub mean: f64,
    pub mean_error: f64,
    pub is_baseline: bool,
    pub result_json: Option<Value>,
}

#[derive(Debug, Clone, Default)]
pub struct PruneStats {
    pub input_count: usize,
    pub window_survivor_count: usize,
    pub baseline_forced_keep_count: usize,
    pub min_keep_added_count: usize,
    pub global_target_truncated_count: usize,
    pub hard_max_truncated_count: usize,
    pub output_count: usize,
}

#[derive(Debug, Clone)]
pub struct PruneOutcome {
    pub survivors: Vec<CandidateResult>,
    pub stats: PruneStats,
}

impl Default for SurvivorPolicy {
    fn default() -> Self {
        Self {
            confidence_z: 1.96,
            min_keep: 5,
            global_target: usize::MAX,
            hard_max: usize::MAX,
            always_keep_baseline: true,
            local_prefilter: true,
            global_prune_after_stage: true,
        }
    }
}

pub fn mean_error_from_result(row: &Value) -> Option<f64> {
    row.get("mean_error").and_then(|v| v.as_f64()).or_else(|| {
        let mean = row.get("mean").and_then(|v| v.as_f64())?;
        let precision_pct = row.get("precision_pct").and_then(|v| v.as_f64())?;
        Some(mean * precision_pct / 100.0)
    })
}

pub fn confidence_window_keeps(best: &CandidateResult, candidate: &CandidateResult, z: f64) -> bool {
    if candidate.mean >= best.mean {
        return true;
    }
    let gap = best.mean - candidate.mean;
    let combined_95 = (best.mean_error.powi(2) + candidate.mean_error.powi(2)).sqrt();
    if combined_95 > 0.0 {
        return gap <= combined_95 * z / 1.96;
    }

    let threshold = best.mean * (1.0 - LEGACY_FALLBACK_MULTIPLIER / 100.0);
    candidate.mean >= threshold
}

pub fn prune_global(candidates: &[CandidateResult], policy: &SurvivorPolicy) -> PruneOutcome {
    let mut stats = PruneStats {
        input_count: candidates.len(),
        ..PruneStats::default()
    };
    if candidates.is_empty() {
        return PruneOutcome {
            survivors: Vec::new(),
            stats,
        };
    }

    let mut sorted = candidates.to_vec();
    sorted.sort_by(|a, b| {
        b.mean
            .partial_cmp(&a.mean)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.combo_id.cmp(&b.combo_id))
    });

    let best = sorted[0].clone();
    let mut kept: Vec<CandidateResult> = sorted
        .iter()
        .filter(|candidate| confidence_window_keeps(&best, candidate, policy.confidence_z))
        .cloned()
        .collect();
    stats.window_survivor_count = kept.len();

    let mut kept_ids: HashSet<i64> = kept.iter().map(|r| r.combo_id).collect();
    if policy.always_keep_baseline {
        for candidate in &sorted {
            if candidate.is_baseline && kept_ids.insert(candidate.combo_id) {
                kept.push(candidate.clone());
                stats.baseline_forced_keep_count += 1;
            }
        }
    }

    if kept.len() < policy.min_keep {
        for candidate in &sorted {
            if kept.len() >= policy.min_keep {
                break;
            }
            if kept_ids.insert(candidate.combo_id) {
                kept.push(candidate.clone());
                stats.min_keep_added_count += 1;
            }
        }
    }

    kept.sort_by(|a, b| {
        b.mean
            .partial_cmp(&a.mean)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.combo_id.cmp(&b.combo_id))
    });

    let protected: HashSet<i64> = if policy.always_keep_baseline {
        kept.iter()
            .filter(|r| r.is_baseline)
            .map(|r| r.combo_id)
            .collect()
    } else {
        HashSet::new()
    };

    if kept.len() > policy.global_target {
        let before = kept.len();
        kept = truncate_with_protected(kept, policy.global_target, &protected);
        stats.global_target_truncated_count = before.saturating_sub(kept.len());
    }
    if kept.len() > policy.hard_max {
        let before = kept.len();
        kept = truncate_with_protected(kept, policy.hard_max, &protected);
        stats.hard_max_truncated_count = before.saturating_sub(kept.len());
    }

    kept.sort_by_key(|r| r.combo_id);
    stats.output_count = kept.len();
    PruneOutcome {
        survivors: kept,
        stats,
    }
}

fn truncate_with_protected(
    mut rows: Vec<CandidateResult>,
    max: usize,
    protected: &HashSet<i64>,
) -> Vec<CandidateResult> {
    if rows.len() <= max {
        return rows;
    }
    let protected_rows: Vec<CandidateResult> = rows
        .iter()
        .filter(|r| protected.contains(&r.combo_id))
        .cloned()
        .collect();
    rows.retain(|r| !protected.contains(&r.combo_id));
    rows.truncate(max.saturating_sub(protected_rows.len()));
    rows.extend(protected_rows);
    rows
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row(id: i64, mean: f64, err: f64) -> CandidateResult {
        CandidateResult {
            combo_id: id,
            combo_name: format!("Combo {id}"),
            combo_key: format!("key-{id}"),
            mean,
            mean_error: err,
            is_baseline: false,
            result_json: None,
        }
    }

    #[test]
    fn mean_error_uses_mean_error_not_mean_stddev() {
        let result = json!({
            "mean": 1000.0,
            "mean_error": 19.6,
            "mean_stddev": 10.0
        });
        assert_eq!(mean_error_from_result(&result), Some(19.6));
    }

    #[test]
    fn confidence_keeps_candidate_inside_combined_95_error() {
        let best = row(1, 1000.0, 10.0);
        let candidate = row(2, 990.0, 10.0);
        assert!(confidence_window_keeps(&best, &candidate, 1.96));
    }

    #[test]
    fn confidence_drops_candidate_outside_combined_95_error() {
        let best = row(1, 1000.0, 5.0);
        let candidate = row(2, 980.0, 5.0);
        assert!(!confidence_window_keeps(&best, &candidate, 1.96));
    }

    #[test]
    fn wider_confidence_keeps_more() {
        let best = row(1, 1000.0, 5.0);
        let candidate = row(2, 991.0, 5.0);
        assert!(!confidence_window_keeps(&best, &candidate, 1.96));
        assert!(confidence_window_keeps(&best, &candidate, 2.58));
    }

    #[test]
    fn global_prune_uses_global_best_not_mean_only_truncation() {
        let policy = SurvivorPolicy {
            min_keep: 1,
            hard_max: 10,
            global_target: 10,
            ..SurvivorPolicy::default()
        };
        let candidates = vec![row(1, 1000.0, 2.0), row(2, 998.0, 2.0), row(3, 900.0, 200.0)];
        let out = prune_global(&candidates, &policy);
        assert!(out.survivors.iter().any(|r| r.combo_id == 3));
        assert_eq!(out.stats.window_survivor_count, 3);
    }

    #[test]
    fn baseline_survives_hard_max() {
        let policy = SurvivorPolicy {
            min_keep: 1,
            hard_max: 1,
            global_target: 1,
            ..SurvivorPolicy::default()
        };
        let mut baseline = row(2, 1.0, 0.0);
        baseline.is_baseline = true;
        let out = prune_global(&[row(1, 1000.0, 1.0), baseline], &policy);
        assert!(out.survivors.iter().any(|r| r.combo_id == 2));
    }
}
