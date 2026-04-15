use crate::models::{extract_result_summary, Job, JobStatus, JobSummary};
use sqlx::{AnyPool, Row};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct JobRepo {
    backend: JobBackend,
}

#[derive(Clone)]
enum JobBackend {
    Database(AnyPool),
    Memory(Arc<Mutex<Vec<Job>>>),
}

impl JobRepo {
    pub fn new(pool: AnyPool) -> Self {
        Self {
            backend: JobBackend::Database(pool),
        }
    }

    pub fn new_memory() -> Self {
        Self {
            backend: JobBackend::Memory(Arc::new(Mutex::new(Vec::new()))),
        }
    }

    fn status_to_str(status: &JobStatus) -> &'static str {
        match status {
            JobStatus::Pending => "pending",
            JobStatus::Running => "running",
            JobStatus::Done => "done",
            JobStatus::Failed => "failed",
            JobStatus::Cancelled => "cancelled",
        }
    }

    fn str_to_status(s: &str) -> JobStatus {
        match s {
            "running" => JobStatus::Running,
            "done" => JobStatus::Done,
            "failed" => JobStatus::Failed,
            "cancelled" => JobStatus::Cancelled,
            _ => JobStatus::Pending,
        }
    }

    fn gc_memory_jobs(jobs: &mut Vec<Job>) {
        let max_jobs = super::MAX_JOBS.load(Ordering::Relaxed);
        jobs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        jobs.truncate(max_jobs);
    }

    pub async fn insert(&self, job: &Job) -> Result<(), sqlx::Error> {
        match &self.backend {
            JobBackend::Database(pool) => {
                let stages_json = serde_json::to_string(&job.stages_completed).unwrap_or_default();
                sqlx::query(
                    "INSERT INTO jobs (id, status, sim_type, simc_input, result_json, combo_metadata_json,
                     error_message, progress_pct, progress_stage, progress_detail, stages_completed,
                     iterations, fight_style, target_error, created_at, batch_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
                )
                .bind(&job.id)
                .bind(Self::status_to_str(&job.status))
                .bind(&job.sim_type)
                .bind(&job.simc_input)
                .bind(&job.result_json)
                .bind(&job.combo_metadata_json)
                .bind(&job.error_message)
                .bind(job.progress_pct as i32)
                .bind(&job.progress_stage)
                .bind(&job.progress_detail)
                .bind(&stages_json)
                .bind(job.iterations as i32)
                .bind(&job.fight_style)
                .bind(job.target_error)
                .bind(&job.created_at)
                .bind(&job.batch_id)
                .execute(pool)
                .await?;

                let max_jobs = super::MAX_JOBS.load(Ordering::Relaxed) as i32;
                sqlx::query(
                    "DELETE FROM jobs WHERE id NOT IN (SELECT id FROM jobs ORDER BY created_at DESC LIMIT $1)",
                )
                .bind(max_jobs)
                .execute(pool)
                .await
                .ok();
            }
            JobBackend::Memory(jobs) => {
                let mut jobs = jobs.lock().unwrap();
                jobs.push(job.clone());
                Self::gc_memory_jobs(&mut jobs);
            }
        }
        Ok(())
    }

    pub async fn get(&self, id: &str) -> Result<Option<Job>, sqlx::Error> {
        match &self.backend {
            JobBackend::Database(pool) => {
                let row = sqlx::query(
                    "SELECT id, status, sim_type, simc_input, result_json, combo_metadata_json,
                     error_message, progress_pct, progress_stage, progress_detail, stages_completed,
                     iterations, fight_style, target_error, created_at, raw_json, html_report, text_output, batch_id
                     FROM jobs WHERE id = $1",
                )
                .bind(id)
                .fetch_optional(pool)
                .await?;

                Ok(row.map(|r| {
                    let stages_str: String = r.get("stages_completed");
                    let stages: Vec<String> = serde_json::from_str(&stages_str).unwrap_or_default();
                    let status_str: String = r.get("status");
                    let pct: i32 = r.get("progress_pct");
                    let iterations: i32 = r.get("iterations");
                    Job {
                        id: r.get("id"),
                        status: Self::str_to_status(&status_str),
                        sim_type: r.get("sim_type"),
                        simc_input: r.get("simc_input"),
                        result_json: r.get("result_json"),
                        combo_metadata_json: r.get("combo_metadata_json"),
                        error_message: r.get("error_message"),
                        progress_pct: pct as u8,
                        progress_stage: r.get("progress_stage"),
                        progress_detail: r.get("progress_detail"),
                        stages_completed: stages,
                        iterations: iterations as u32,
                        fight_style: r.get("fight_style"),
                        target_error: r.get("target_error"),
                        created_at: r.get("created_at"),
                        raw_json: r.get("raw_json"),
                        html_report: r.get("html_report"),
                        text_output: r.get("text_output"),
                        batch_id: r.get("batch_id"),
                    }
                }))
            }
            JobBackend::Memory(jobs) => Ok(jobs
                .lock()
                .unwrap()
                .iter()
                .find(|job| job.id == id)
                .cloned()),
        }
    }

    pub async fn list_recent(
        &self,
        limit: usize,
        player: Option<&str>,
        realm: Option<&str>,
    ) -> Result<Vec<JobSummary>, sqlx::Error> {
        match &self.backend {
            JobBackend::Database(pool) => {
                let fetch_limit = if player.is_some() || realm.is_some() {
                    200i32
                } else {
                    limit as i32
                };

                let rows = sqlx::query(
                    "SELECT id, status, sim_type, created_at, fight_style, iterations, error_message, result_json, simc_input, batch_id
                     FROM jobs ORDER BY created_at DESC LIMIT $1",
                )
                .bind(fetch_limit)
                .fetch_all(pool)
                .await?;

                let all: Vec<JobSummary> = rows
                    .iter()
                    .map(|r| {
                        let status_str: String = r.get("status");
                        let result_json: Option<String> = r.get("result_json");
                        let simc_input: String = r.get("simc_input");
                        let iterations: i32 = r.get("iterations");
                        let s = extract_result_summary(&result_json, &simc_input);
                        JobSummary {
                            id: r.get("id"),
                            status: Self::str_to_status(&status_str),
                            sim_type: r.get("sim_type"),
                            created_at: r.get("created_at"),
                            fight_style: r.get("fight_style"),
                            iterations: iterations as u32,
                            error_message: r.get("error_message"),
                            player_name: s.player_name,
                            player_class: s.player_class,
                            realm: s.realm,
                            region: s.region,
                            dps: s.dps,
                            batch_id: r.get("batch_id"),
                        }
                    })
                    .collect();

                if player.is_none() && realm.is_none() {
                    return Ok(all);
                }

                Ok(all
                    .into_iter()
                    .filter(|j| {
                        if let Some(p) = player {
                            if j.player_name.as_deref() != Some(p) {
                                return false;
                            }
                        }
                        if let Some(r) = realm {
                            if j.realm.as_deref() != Some(r) {
                                return false;
                            }
                        }
                        true
                    })
                    .take(limit)
                    .collect())
            }
            JobBackend::Memory(jobs) => {
                let mut all: Vec<JobSummary> = jobs
                    .lock()
                    .unwrap()
                    .iter()
                    .map(|job| {
                        let summary = extract_result_summary(&job.result_json, &job.simc_input);
                        JobSummary {
                            id: job.id.clone(),
                            status: job.status.clone(),
                            sim_type: job.sim_type.clone(),
                            created_at: job.created_at.clone(),
                            fight_style: job.fight_style.clone(),
                            iterations: job.iterations,
                            error_message: job.error_message.clone(),
                            player_name: summary.player_name,
                            player_class: summary.player_class,
                            realm: summary.realm,
                            region: summary.region,
                            dps: summary.dps,
                            batch_id: job.batch_id.clone(),
                        }
                    })
                    .collect();
                all.sort_by(|a, b| b.created_at.cmp(&a.created_at));

                if player.is_none() && realm.is_none() {
                    all.truncate(limit);
                    return Ok(all);
                }

                Ok(all
                    .into_iter()
                    .filter(|job| {
                        if let Some(p) = player {
                            if job.player_name.as_deref() != Some(p) {
                                return false;
                            }
                        }
                        if let Some(r) = realm {
                            if job.realm.as_deref() != Some(r) {
                                return false;
                            }
                        }
                        true
                    })
                    .take(limit)
                    .collect())
            }
        }
    }

    pub async fn update_status(&self, id: &str, status: JobStatus) -> Result<(), sqlx::Error> {
        match &self.backend {
            JobBackend::Database(pool) => {
                sqlx::query("UPDATE jobs SET status = $1 WHERE id = $2")
                    .bind(Self::status_to_str(&status))
                    .bind(id)
                    .execute(pool)
                    .await?;
            }
            JobBackend::Memory(jobs) => {
                if let Some(job) = jobs.lock().unwrap().iter_mut().find(|job| job.id == id) {
                    job.status = status;
                }
            }
        }
        Ok(())
    }

    pub async fn update_progress(
        &self,
        id: &str,
        pct: u8,
        stage: &str,
        detail: &str,
    ) -> Result<(), sqlx::Error> {
        match &self.backend {
            JobBackend::Database(pool) => {
                sqlx::query(
                    "UPDATE jobs SET progress_pct = $1, progress_stage = $2, progress_detail = $3 WHERE id = $4",
                )
                .bind(pct as i32)
                .bind(stage)
                .bind(detail)
                .bind(id)
                .execute(pool)
                .await?;
            }
            JobBackend::Memory(jobs) => {
                if let Some(job) = jobs.lock().unwrap().iter_mut().find(|job| job.id == id) {
                    job.progress_pct = pct;
                    job.progress_stage = if stage.is_empty() {
                        None
                    } else {
                        Some(stage.to_string())
                    };
                    job.progress_detail = if detail.is_empty() {
                        None
                    } else {
                        Some(detail.to_string())
                    };
                }
            }
        }
        Ok(())
    }

    pub async fn complete_stage(&self, id: &str, summary: &str) -> Result<(), sqlx::Error> {
        match &self.backend {
            JobBackend::Database(pool) => {
                let current: Option<String> =
                    sqlx::query("SELECT stages_completed FROM jobs WHERE id = $1")
                        .bind(id)
                        .fetch_optional(pool)
                        .await?
                        .map(|r| r.get("stages_completed"));

                if let Some(stages_str) = current {
                    let mut stages: Vec<String> =
                        serde_json::from_str(&stages_str).unwrap_or_default();
                    stages.push(summary.to_string());
                    let updated = serde_json::to_string(&stages).unwrap_or_default();
                    sqlx::query("UPDATE jobs SET stages_completed = $1 WHERE id = $2")
                        .bind(&updated)
                        .bind(id)
                        .execute(pool)
                        .await?;
                }
            }
            JobBackend::Memory(jobs) => {
                if let Some(job) = jobs.lock().unwrap().iter_mut().find(|job| job.id == id) {
                    job.stages_completed.push(summary.to_string());
                }
            }
        }
        Ok(())
    }

    pub async fn set_result(
        &self,
        id: &str,
        result: &str,
        raw_json: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        match &self.backend {
            JobBackend::Database(pool) => {
                sqlx::query("UPDATE jobs SET result_json = $1, raw_json = $2, status = 'done' WHERE id = $3")
                    .bind(result)
                    .bind(raw_json)
                    .bind(id)
                    .execute(pool)
                    .await?;
            }
            JobBackend::Memory(jobs) => {
                if let Some(job) = jobs.lock().unwrap().iter_mut().find(|job| job.id == id) {
                    job.result_json = Some(result.to_string());
                    job.raw_json = raw_json.map(ToString::to_string);
                    job.status = JobStatus::Done;
                    job.progress_pct = 100;
                }
            }
        }
        Ok(())
    }

    pub async fn set_error(&self, id: &str, error: &str) -> Result<(), sqlx::Error> {
        match &self.backend {
            JobBackend::Database(pool) => {
                sqlx::query("UPDATE jobs SET error_message = $1, status = 'failed' WHERE id = $2")
                    .bind(error)
                    .bind(id)
                    .execute(pool)
                    .await?;
            }
            JobBackend::Memory(jobs) => {
                if let Some(job) = jobs.lock().unwrap().iter_mut().find(|job| job.id == id) {
                    job.error_message = Some(error.to_string());
                    job.status = JobStatus::Failed;
                }
            }
        }
        Ok(())
    }

    pub async fn set_report_files(
        &self,
        id: &str,
        html: Option<&str>,
        text: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        match &self.backend {
            JobBackend::Database(pool) => {
                sqlx::query("UPDATE jobs SET html_report = $1, text_output = $2 WHERE id = $3")
                    .bind(html)
                    .bind(text)
                    .bind(id)
                    .execute(pool)
                    .await?;
            }
            JobBackend::Memory(jobs) => {
                if let Some(job) = jobs.lock().unwrap().iter_mut().find(|job| job.id == id) {
                    job.html_report = html.map(ToString::to_string);
                    job.text_output = text.map(ToString::to_string);
                }
            }
        }
        Ok(())
    }

    pub async fn count_batch(&self, batch_id: &str) -> Result<usize, sqlx::Error> {
        match &self.backend {
            JobBackend::Database(pool) => {
                let row = sqlx::query("SELECT COUNT(*) as cnt FROM jobs WHERE batch_id = $1")
                    .bind(batch_id)
                    .fetch_one(pool)
                    .await?;
                let count: i64 = row.get("cnt");
                Ok(count as usize)
            }
            JobBackend::Memory(jobs) => Ok(jobs
                .lock()
                .unwrap()
                .iter()
                .filter(|job| job.batch_id.as_deref() == Some(batch_id))
                .count()),
        }
    }
}
