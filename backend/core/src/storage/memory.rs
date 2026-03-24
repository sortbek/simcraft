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
        self.jobs.lock().unwrap().insert(job.id.clone(), job);
    }

    fn get(&self, id: &str) -> Option<Job> {
        self.jobs.lock().unwrap().get(id).cloned()
    }

    fn list_recent(&self, limit: usize) -> Vec<JobSummary> {
        let jobs = self.jobs.lock().unwrap();
        let mut entries: Vec<&Job> = jobs.values().collect();
        entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        entries.truncate(limit);
        entries.iter().map(|j| {
            let (player_name, player_class, dps) = extract_result_summary(&j.result_json);
            JobSummary {
                id: j.id.clone(),
                status: j.status.clone(),
                sim_type: j.sim_type.clone(),
                created_at: j.created_at.clone(),
                fight_style: j.fight_style.clone(),
                iterations: j.iterations,
                error_message: j.error_message.clone(),
                player_name,
                player_class,
                dps,
            }
        }).collect()
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
