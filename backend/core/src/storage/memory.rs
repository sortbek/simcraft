use std::collections::HashMap;
use std::sync::Mutex;

use crate::models::{Job, JobStatus, JobSummary, extract_result_summary};
use super::JobStorage;

pub struct MemoryStorage {
    jobs: Mutex<HashMap<String, Job>>,
}

impl MemoryStorage {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
        }
    }
}

impl JobStorage for MemoryStorage {
    fn insert(&self, job: Job) {
        let mut jobs = self.jobs.lock().unwrap();
        jobs.insert(job.id.clone(), job);
        if jobs.len() > *super::MAX_JOBS {
            let mut entries: Vec<(String, String)> = jobs.iter()
                .map(|(id, j)| (id.clone(), j.created_at.clone()))
                .collect();
            entries.sort_by(|a, b| a.1.cmp(&b.1));
            let to_remove = jobs.len() - *super::MAX_JOBS;
            for (id, _) in entries.into_iter().take(to_remove) {
                jobs.remove(&id);
            }
        }
    }

    fn get(&self, id: &str) -> Option<Job> {
        self.jobs.lock().unwrap().get(id).cloned()
    }

    fn list_recent(&self, limit: usize, player: Option<&str>, realm: Option<&str>) -> Vec<JobSummary> {
        let jobs = self.jobs.lock().unwrap();
        let mut entries: Vec<&Job> = jobs.values().collect();
        entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        let mut results: Vec<JobSummary> = Vec::new();
        for j in entries {
            if results.len() >= limit { break; }
            let s = extract_result_summary(&j.result_json, &j.simc_input);
            if let Some(p) = player {
                if s.player_name.as_deref() != Some(p) { continue; }
            }
            if let Some(r) = realm {
                if s.realm.as_deref() != Some(r) { continue; }
            }
            results.push(JobSummary {
                id: j.id.clone(),
                status: j.status.clone(),
                sim_type: j.sim_type.clone(),
                created_at: j.created_at.clone(),
                fight_style: j.fight_style.clone(),
                iterations: j.iterations,
                error_message: j.error_message.clone(),
                player_name: s.player_name,
                player_class: s.player_class,
                realm: s.realm,
                dps: s.dps,
            });
        }
        results
    }

    fn update_status(&self, id: &str, status: JobStatus) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.status = status;
        }
    }

    fn update_progress(&self, id: &str, pct: u8, stage: &str, detail: &str) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.progress_pct = pct;
            job.progress_stage = Some(stage.to_string());
            job.progress_detail = Some(detail.to_string());
        }
    }

    fn complete_stage(&self, id: &str, summary: &str) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.stages_completed.push(summary.to_string());
        }
    }

    fn set_result(&self, id: &str, result: String, raw_json: Option<String>) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.result_json = Some(result);
            job.raw_json = raw_json;
            job.status = JobStatus::Done;
        }
    }

    fn set_error(&self, id: &str, error: String) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.error_message = Some(error);
            job.status = JobStatus::Failed;
        }
    }

    fn set_report_files(&self, id: &str, html: Option<String>, text: Option<String>) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.html_report = html;
            job.text_output = text;
        }
    }
}
