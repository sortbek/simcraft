use crate::models::{extract_result_summary, Job, JobStatus, JobStatusSummary, SimcInputMode};
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

/// Filter passed to `list_jobs`. Powers the unified /sims overview page.
#[derive(Debug, Clone, Copy)]
pub struct ListJobsFilter<'a> {
    pub status: JobStatusFilter,
    pub player: Option<&'a str>,
    pub realm: Option<&'a str>,
    pub limit: Option<usize>,
}

impl<'a> Default for ListJobsFilter<'a> {
    fn default() -> Self {
        Self {
            status: JobStatusFilter::All,
            player: None,
            realm: None,
            limit: None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum JobStatusFilter {
    All,
    Active,   // pending/running/paused
    Terminal, // done/failed/cancelled
}

impl JobStatusFilter {
    fn sql_where(self) -> &'static str {
        match self {
            JobStatusFilter::All => {
                "status IN ('pending','running','paused','done','failed','cancelled')"
            }
            JobStatusFilter::Active => "status IN ('pending','running','paused')",
            JobStatusFilter::Terminal => "status IN ('done','failed','cancelled')",
        }
    }
    fn includes(self, status: &JobStatus) -> bool {
        use JobStatus as JS;
        match self {
            JobStatusFilter::All => true,
            JobStatusFilter::Active => matches!(status, JS::Pending | JS::Running | JS::Paused),
            JobStatusFilter::Terminal => {
                matches!(status, JS::Done | JS::Failed | JS::Cancelled)
            }
        }
    }
}

fn str_to_status(s: &str) -> JobStatus {
    match s {
        "running" => JobStatus::Running,
        "paused" => JobStatus::Paused,
        "done" => JobStatus::Done,
        "failed" => JobStatus::Failed,
        "cancelled" => JobStatus::Cancelled,
        _ => JobStatus::Pending,
    }
}

/// Convert a `jobs` row (with `simc_input_head` populated via SUBSTR and
/// optionally `result_json`) into a `JobActiveSummary`. Used by both
/// `list_active` and `list_jobs` so the field-mapping logic lives in one place.
fn row_to_overview_summary(r: &sqlx::any::AnyRow, has_result_json: bool) -> crate::models::JobActiveSummary {
    let status_str: String = r.get("status");
    let progress_pct: i32 = r.get("progress_pct");
    let simc_input: String = r.get("simc_input_head");
    let result_json: Option<String> = if has_result_json {
        r.try_get("result_json").ok().flatten()
    } else {
        None
    };
    let summary = extract_result_summary(&result_json, &simc_input);
    let iterations: i32 = r.try_get("iterations").unwrap_or(0);
    crate::models::JobActiveSummary {
        id: r.get("id"),
        status: str_to_status(&status_str),
        sim_type: r.get("sim_type"),
        created_at: r.get("created_at"),
        progress_pct: progress_pct.clamp(0, 100) as u8,
        progress_stage: r.get("progress_stage"),
        progress_detail: r.get("progress_detail"),
        player_name: summary.player_name,
        player_class: summary.player_class,
        fight_style: r.get("fight_style"),
        simc_input_mode: SimcInputMode::from_str(
            &r.try_get::<String, _>("simc_input_mode")
                .unwrap_or_else(|_| "inline".to_string()),
        ),
        pause_requested: r.try_get::<i32, _>("pause_requested").unwrap_or(0) != 0,
        error_message: r.get("error_message"),
        iterations: iterations as u32,
        realm: summary.realm,
        region: summary.region,
        dps: summary.dps,
        batch_id: r.try_get("batch_id").ok().flatten(),
    }
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

    /// Returns the underlying database pool if this repo uses a real database.
    /// Returns None for in-memory repos (e.g. desktop fallback mode).
    pub fn pool(&self) -> Option<&AnyPool> {
        match &self.backend {
            JobBackend::Database(pool) => Some(pool),
            JobBackend::Memory(_) => None,
        }
    }

    fn status_to_str(status: &JobStatus) -> &'static str {
        match status {
            JobStatus::Pending => "pending",
            JobStatus::Running => "running",
            JobStatus::Paused => "paused",
            JobStatus::Done => "done",
            JobStatus::Failed => "failed",
            JobStatus::Cancelled => "cancelled",
        }
    }

    fn str_to_status(s: &str) -> JobStatus {
        str_to_status(s)
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
                    "INSERT INTO jobs (id, status, sim_type, simc_input, result_json,
                     error_message, progress_pct, progress_stage, progress_detail, stages_completed,
                     iterations, fight_style, target_error, created_at, batch_id,
                     request_json, simc_input_mode, checkpoint, pause_requested)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                             $16, $17, $18, $19)",
                )
                .bind(&job.id)
                .bind(Self::status_to_str(&job.status))
                .bind(&job.sim_type)
                .bind(&job.simc_input)
                .bind(&job.result_json)
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
                .bind(&job.request_json)
                .bind(job.simc_input_mode.as_str())
                .bind(&job.checkpoint)
                .bind(if job.pause_requested { 1i32 } else { 0i32 })
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
                    "SELECT id, status, sim_type, simc_input, result_json,
                     error_message, progress_pct, progress_stage, progress_detail, stages_completed,
                     iterations, fight_style, target_error, created_at, raw_json, html_report, text_output, batch_id,
                     request_json, simc_input_mode, checkpoint, pause_requested
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
                        request_json: r.get("request_json"),
                        simc_input_mode: SimcInputMode::from_str(
                            &r.try_get::<String, _>("simc_input_mode")
                              .unwrap_or_else(|_| "inline".to_string()),
                        ),
                        checkpoint: r.get("checkpoint"),
                        pause_requested: r.try_get::<i32, _>("pause_requested").unwrap_or(0) != 0,
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
                sqlx::query("UPDATE jobs SET result_json = $1, raw_json = $2, status = 'done', progress_pct = 100 WHERE id = $3")
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

    pub async fn update_checkpoint(
        &self,
        id: &str,
        checkpoint: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        match &self.backend {
            JobBackend::Database(pool) => {
                sqlx::query("UPDATE jobs SET checkpoint = $1 WHERE id = $2")
                    .bind(checkpoint)
                    .bind(id)
                    .execute(pool)
                    .await?;
            }
            JobBackend::Memory(jobs) => {
                let mut jobs = jobs.lock().unwrap();
                if let Some(job) = jobs.iter_mut().find(|j| j.id == id) {
                    job.checkpoint = checkpoint.map(ToString::to_string);
                }
            }
        }
        Ok(())
    }

    pub async fn set_pause_requested(&self, id: &str, requested: bool) -> Result<(), sqlx::Error> {
        match &self.backend {
            JobBackend::Database(pool) => {
                sqlx::query("UPDATE jobs SET pause_requested = $1 WHERE id = $2")
                    .bind(if requested { 1i32 } else { 0i32 })
                    .bind(id)
                    .execute(pool)
                    .await?;
            }
            JobBackend::Memory(jobs) => {
                let mut jobs = jobs.lock().unwrap();
                if let Some(job) = jobs.iter_mut().find(|j| j.id == id) {
                    job.pause_requested = requested;
                }
            }
        }
        Ok(())
    }

    pub async fn get_pause_requested(&self, id: &str) -> Result<bool, sqlx::Error> {
        match &self.backend {
            JobBackend::Database(pool) => {
                let row = sqlx::query("SELECT pause_requested FROM jobs WHERE id = $1")
                    .bind(id)
                    .fetch_optional(pool)
                    .await?;
                Ok(row
                    .map(|r| r.get::<i32, _>("pause_requested") != 0)
                    .unwrap_or(false))
            }
            JobBackend::Memory(jobs) => Ok(jobs
                .lock()
                .unwrap()
                .iter()
                .find(|j| j.id == id)
                .map(|j| j.pause_requested)
                .unwrap_or(false)),
        }
    }

    /// Return all active (Pending / Running / Paused) jobs plus the most
    /// recent `limit_recent` terminal jobs. Used by the sims overview page.
    ///
    /// Returns a slim `JobActiveSummary` (no full simc_input / result_json
    /// bodies). The Database backend reads only the head of `simc_input`
    /// (4 KB) to extract player_name/class via regex, keeping per-poll I/O
    /// cheap even with many jobs. The header where the player= line lives
    /// is always near the start of the profile, so the truncation is safe.
    pub async fn list_active(
        &self,
        limit_recent: usize,
    ) -> Result<Vec<crate::models::JobActiveSummary>, sqlx::Error> {
        use crate::models::{JobActiveSummary, JobStatus as JS};
        match &self.backend {
            JobBackend::Database(pool) => {
                let active_rows = sqlx::query(
                    "SELECT id, status, sim_type, created_at, fight_style, \
                            progress_pct, progress_stage, progress_detail, \
                            simc_input_mode, pause_requested, error_message, \
                            iterations, batch_id, \
                            SUBSTR(simc_input, 1, 4096) AS simc_input_head \
                     FROM jobs \
                     WHERE status IN ('pending', 'running', 'paused') \
                     ORDER BY created_at DESC",
                )
                .fetch_all(pool)
                .await?;

                let terminal_rows = sqlx::query(
                    "SELECT id, status, sim_type, created_at, fight_style, \
                            progress_pct, progress_stage, progress_detail, \
                            simc_input_mode, pause_requested, error_message, \
                            iterations, batch_id, result_json, \
                            SUBSTR(simc_input, 1, 4096) AS simc_input_head \
                     FROM jobs \
                     WHERE status IN ('done', 'failed', 'cancelled') \
                     ORDER BY created_at DESC LIMIT $1",
                )
                .bind(limit_recent as i32)
                .fetch_all(pool)
                .await?;

                let mut out: Vec<JobActiveSummary> =
                    Vec::with_capacity(active_rows.len() + terminal_rows.len());
                for r in active_rows.iter() {
                    out.push(row_to_overview_summary(r, false));
                }
                for r in terminal_rows.iter() {
                    out.push(row_to_overview_summary(r, true));
                }
                Ok(out)
            }
            JobBackend::Memory(jobs) => {
                let guard = jobs.lock().unwrap();
                let mut active: Vec<JobActiveSummary> = Vec::new();
                let mut terminal: Vec<JobActiveSummary> = Vec::new();
                for j in guard.iter() {
                    let s = extract_result_summary(&j.result_json, &j.simc_input);
                    let summary = JobActiveSummary {
                        id: j.id.clone(),
                        status: j.status.clone(),
                        sim_type: j.sim_type.clone(),
                        created_at: j.created_at.clone(),
                        progress_pct: j.progress_pct,
                        progress_stage: j.progress_stage.clone(),
                        progress_detail: j.progress_detail.clone(),
                        player_name: s.player_name,
                        player_class: s.player_class,
                        fight_style: j.fight_style.clone(),
                        simc_input_mode: j.simc_input_mode,
                        pause_requested: j.pause_requested,
                        error_message: j.error_message.clone(),
                        iterations: j.iterations,
                        realm: s.realm,
                        region: s.region,
                        dps: s.dps,
                        batch_id: j.batch_id.clone(),
                    };
                    match j.status {
                        JS::Pending | JS::Running | JS::Paused => active.push(summary),
                        _ => terminal.push(summary),
                    }
                }
                active.sort_by(|a, b| b.created_at.cmp(&a.created_at));
                terminal.sort_by(|a, b| b.created_at.cmp(&a.created_at));
                terminal.truncate(limit_recent);
                active.extend(terminal);
                Ok(active)
            }
        }
    }

    /// Unified job listing for the /sims overview page (combined Active/All view
    /// + stats panel + batch grouping). Returns a single ordered list filtered
    /// by the requested status set, with optional player/realm scoping.
    pub async fn list_jobs(
        &self,
        filter: ListJobsFilter<'_>,
    ) -> Result<Vec<crate::models::JobActiveSummary>, sqlx::Error> {
        use crate::models::JobActiveSummary;
        match &self.backend {
            JobBackend::Database(pool) => {
                let status_clause = filter.status.sql_where();
                let mut sql = format!(
                    "SELECT id, status, sim_type, created_at, fight_style, \
                            progress_pct, progress_stage, progress_detail, \
                            simc_input_mode, pause_requested, error_message, \
                            iterations, batch_id, result_json, \
                            SUBSTR(simc_input, 1, 4096) AS simc_input_head \
                     FROM jobs \
                     WHERE {status_clause} \
                     ORDER BY created_at DESC LIMIT $1"
                );
                if filter.player.is_some() || filter.realm.is_some() {
                    // Filtering happens in Rust after the SUBSTR head is parsed,
                    // since neither field is a column. Widen the SQL limit so the
                    // post-filter result still has a reasonable cap.
                    sql = sql.replace("LIMIT $1", "LIMIT 1000");
                }
                let limit = filter.limit.unwrap_or(200) as i32;
                let rows = if sql.contains("LIMIT 1000") {
                    sqlx::query(&sql).fetch_all(pool).await?
                } else {
                    sqlx::query(&sql).bind(limit).fetch_all(pool).await?
                };

                let mut all: Vec<JobActiveSummary> = rows
                    .iter()
                    .map(|r| row_to_overview_summary(r, true))
                    .collect();

                if filter.player.is_some() || filter.realm.is_some() {
                    all.retain(|j| {
                        if let Some(p) = filter.player {
                            if j.player_name.as_deref() != Some(p) {
                                return false;
                            }
                        }
                        if let Some(r) = filter.realm {
                            if j.realm.as_deref() != Some(r) {
                                return false;
                            }
                        }
                        true
                    });
                    all.truncate(limit as usize);
                }
                Ok(all)
            }
            JobBackend::Memory(jobs) => {
                let guard = jobs.lock().unwrap();
                let mut all: Vec<JobActiveSummary> = guard
                    .iter()
                    .filter(|j| filter.status.includes(&j.status))
                    .filter(|j| {
                        filter
                            .player
                            .map(|p| {
                                extract_result_summary(&j.result_json, &j.simc_input)
                                    .player_name
                                    .as_deref()
                                    == Some(p)
                            })
                            .unwrap_or(true)
                    })
                    .filter(|j| {
                        filter
                            .realm
                            .map(|r| {
                                extract_result_summary(&j.result_json, &j.simc_input)
                                    .realm
                                    .as_deref()
                                    == Some(r)
                            })
                            .unwrap_or(true)
                    })
                    .map(|j| {
                        let s = extract_result_summary(&j.result_json, &j.simc_input);
                        JobActiveSummary {
                            id: j.id.clone(),
                            status: j.status.clone(),
                            sim_type: j.sim_type.clone(),
                            created_at: j.created_at.clone(),
                            progress_pct: j.progress_pct,
                            progress_stage: j.progress_stage.clone(),
                            progress_detail: j.progress_detail.clone(),
                            player_name: s.player_name,
                            player_class: s.player_class,
                            fight_style: j.fight_style.clone(),
                            simc_input_mode: j.simc_input_mode,
                            pause_requested: j.pause_requested,
                            error_message: j.error_message.clone(),
                            iterations: j.iterations,
                            realm: s.realm,
                            region: s.region,
                            dps: s.dps,
                            batch_id: j.batch_id.clone(),
                        }
                    })
                    .collect();
                all.sort_by(|a, b| b.created_at.cmp(&a.created_at));
                all.truncate(filter.limit.unwrap_or(200));
                Ok(all)
            }
        }
    }

    /// Delete a terminal-state job and its associated rows in dedup / metadata /
    /// triage_batches tables. Returns an error if the job is still active.
    pub async fn delete_job(&self, id: &str) -> Result<(), sqlx::Error> {
        match &self.backend {
            JobBackend::Database(pool) => {
                let _ = sqlx::query("DELETE FROM combo_dedup WHERE job_id = $1")
                    .bind(id)
                    .execute(pool)
                    .await;
                let _ = sqlx::query("DELETE FROM combo_metadata WHERE job_id = $1")
                    .bind(id)
                    .execute(pool)
                    .await;
                let _ = sqlx::query("DELETE FROM triage_batches WHERE job_id = $1")
                    .bind(id)
                    .execute(pool)
                    .await;
                sqlx::query("DELETE FROM jobs WHERE id = $1")
                    .bind(id)
                    .execute(pool)
                    .await?;
                Ok(())
            }
            JobBackend::Memory(jobs) => {
                jobs.lock().unwrap().retain(|j| j.id != id);
                Ok(())
            }
        }
    }

    /// Slim read for `get_sim_status`. Returns only the columns the status
    /// endpoint actually reads — excludes raw_json, html_report, text_output,
    /// request_json, and simc_input (which can be many MB for completed jobs).
    pub async fn get_status_summary(
        &self,
        id: &str,
    ) -> Result<Option<JobStatusSummary>, sqlx::Error> {
        match &self.backend {
            JobBackend::Database(pool) => {
                let row = sqlx::query(
                    "SELECT id, status, progress_pct, progress_stage, progress_detail,
                     stages_completed, result_json, error_message, simc_input_mode,
                     pause_requested
                     FROM jobs WHERE id = $1",
                )
                .bind(id)
                .fetch_optional(pool)
                .await?;

                Ok(row.map(|r| {
                    let stages_str: String = r.get("stages_completed");
                    let stages: Vec<String> =
                        serde_json::from_str(&stages_str).unwrap_or_default();
                    let status_str: String = r.get("status");
                    let status = Self::str_to_status(&status_str);
                    let pct: i32 = r.get("progress_pct");
                    // Only return result_json when the job is done.
                    let result_json: Option<String> = if status == JobStatus::Done {
                        r.get("result_json")
                    } else {
                        None
                    };
                    JobStatusSummary {
                        id: r.get("id"),
                        status,
                        progress_pct: pct as u8,
                        progress_stage: r.get("progress_stage"),
                        progress_detail: r.get("progress_detail"),
                        stages_completed: stages,
                        result_json,
                        error_message: r.get("error_message"),
                        simc_input_mode: SimcInputMode::from_str(
                            &r.try_get::<String, _>("simc_input_mode")
                                .unwrap_or_else(|_| "inline".to_string()),
                        ),
                        pause_requested: r
                            .try_get::<i32, _>("pause_requested")
                            .unwrap_or(0)
                            != 0,
                    }
                }))
            }
            JobBackend::Memory(jobs) => Ok(jobs
                .lock()
                .unwrap()
                .iter()
                .find(|j| j.id == id)
                .map(|j| JobStatusSummary {
                    id: j.id.clone(),
                    status: j.status.clone(),
                    progress_pct: j.progress_pct,
                    progress_stage: j.progress_stage.clone(),
                    progress_detail: j.progress_detail.clone(),
                    stages_completed: j.stages_completed.clone(),
                    result_json: if j.status == JobStatus::Done {
                        j.result_json.clone()
                    } else {
                        None
                    },
                    error_message: j.error_message.clone(),
                    simc_input_mode: j.simc_input_mode,
                    pause_requested: j.pause_requested,
                })),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_job(id: &str, status: JobStatus) -> Job {
        Job {
            id: id.to_string(),
            status,
            sim_type: "quick".to_string(),
            simc_input: String::new(),
            result_json: None,
            raw_json: None,
            error_message: None,
            progress_pct: 0,
            progress_stage: None,
            progress_detail: None,
            stages_completed: Vec::new(),
            iterations: 1000,
            fight_style: "Patchwerk".to_string(),
            target_error: 0.05,
            created_at: "2026-05-17T00:00:00Z".to_string(),
            html_report: None,
            text_output: None,
            batch_id: None,
            request_json: None,
            simc_input_mode: SimcInputMode::Inline,
            checkpoint: None,
            pause_requested: false,
        }
    }

    impl JobRepo {
        async fn insert_test_job(&self, job: Job) -> Result<(), sqlx::Error> {
            match &self.backend {
                JobBackend::Memory(jobs) => {
                    jobs.lock().unwrap().push(job);
                    Ok(())
                }
                JobBackend::Database(pool) => {
                    let status = Self::status_to_str(&job.status);
                    let simc_input_mode = match job.simc_input_mode {
                        SimcInputMode::Inline => "inline",
                        SimcInputMode::Streamed => "streamed",
                    };
                    sqlx::query(
                        "INSERT INTO jobs (id, status, sim_type, simc_input, iterations, \
                            fight_style, target_error, created_at, progress_pct, \
                            simc_input_mode, pause_requested) \
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
                    )
                    .bind(&job.id)
                    .bind(status)
                    .bind(&job.sim_type)
                    .bind(&job.simc_input)
                    .bind(job.iterations as i32)
                    .bind(&job.fight_style)
                    .bind(job.target_error)
                    .bind(&job.created_at)
                    .bind(job.progress_pct as i32)
                    .bind(simc_input_mode)
                    .bind(if job.pause_requested { 1i32 } else { 0i32 })
                    .execute(pool)
                    .await?;
                    Ok(())
                }
            }
        }
    }

    #[tokio::test]
    async fn list_active_includes_running_paused_and_recent_terminal() {
        let repo = JobRepo::new_memory();

        let mut running = make_test_job("run-1", JobStatus::Running);
        running.created_at = "2026-05-17T10:00:00Z".to_string();
        let mut paused = make_test_job("pause-1", JobStatus::Paused);
        paused.created_at = "2026-05-17T11:00:00Z".to_string();
        let mut pending = make_test_job("pending-1", JobStatus::Pending);
        pending.created_at = "2026-05-17T09:00:00Z".to_string();

        let mut done_new = make_test_job("done-1", JobStatus::Done);
        done_new.created_at = "2026-05-17T12:00:00Z".to_string();
        let mut failed_old = make_test_job("failed-1", JobStatus::Failed);
        failed_old.created_at = "2026-05-16T08:00:00Z".to_string();

        repo.insert_test_job(running).await.unwrap();
        repo.insert_test_job(paused).await.unwrap();
        repo.insert_test_job(pending).await.unwrap();
        repo.insert_test_job(done_new).await.unwrap();
        repo.insert_test_job(failed_old).await.unwrap();

        let summaries = repo.list_active(10).await.unwrap();
        let ids: Vec<&str> = summaries.iter().map(|s| s.id.as_str()).collect();

        // Exact expected order:
        //   active jobs DESC by created_at: pause-1 (11:00), run-1 (10:00), pending-1 (09:00)
        //   then terminal DESC by created_at: done-1 (12:00), failed-1 (16th 08:00)
        assert_eq!(ids, vec!["pause-1", "run-1", "pending-1", "done-1", "failed-1"]);
    }

    #[tokio::test]
    async fn list_active_limits_terminal_jobs() {
        let repo = JobRepo::new_memory();
        for i in 0..5 {
            let mut j = make_test_job(&format!("done-{i}"), JobStatus::Done);
            j.created_at = format!("2026-05-17T1{i}:00:00Z");
            repo.insert_test_job(j).await.unwrap();
        }
        let summaries = repo.list_active(2).await.unwrap();
        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[0].id, "done-4");
        assert_eq!(summaries[1].id, "done-3");
    }

    #[tokio::test]
    async fn list_active_returns_empty_for_empty_repo() {
        let repo = JobRepo::new_memory();
        let summaries = repo.list_active(10).await.unwrap();
        assert!(summaries.is_empty());
    }

    #[tokio::test]
    async fn list_active_zero_limit_drops_all_terminal() {
        let repo = JobRepo::new_memory();
        let mut running = make_test_job("r1", JobStatus::Running);
        running.created_at = "2026-05-17T10:00:00Z".to_string();
        let mut done = make_test_job("d1", JobStatus::Done);
        done.created_at = "2026-05-17T11:00:00Z".to_string();
        repo.insert_test_job(running).await.unwrap();
        repo.insert_test_job(done).await.unwrap();

        let summaries = repo.list_active(0).await.unwrap();
        let ids: Vec<&str> = summaries.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["r1"]);
    }

    /// Exercises the Database arm of list_active against a real in-memory
    /// SQLite — the Memory tests above never run the `SUBSTR(simc_input,…)`
    /// query, the two-query union, or the status-string filtering, so without
    /// this test a SQL or dialect regression would slip through.
    #[tokio::test]
    async fn list_active_database_backend_matches_expected_order() {
        sqlx::any::install_default_drivers();
        let db = crate::db::Database::connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite");
        let repo = JobRepo::new(db.pool.clone());

        let mut running = make_test_job("run-1", JobStatus::Running);
        running.created_at = "2026-05-17T10:00:00Z".to_string();
        let mut paused = make_test_job("pause-1", JobStatus::Paused);
        paused.created_at = "2026-05-17T11:00:00Z".to_string();
        let mut done_new = make_test_job("done-1", JobStatus::Done);
        done_new.created_at = "2026-05-17T12:00:00Z".to_string();
        let mut failed_old = make_test_job("failed-1", JobStatus::Failed);
        failed_old.created_at = "2026-05-16T08:00:00Z".to_string();

        repo.insert_test_job(running).await.unwrap();
        repo.insert_test_job(paused).await.unwrap();
        repo.insert_test_job(done_new).await.unwrap();
        repo.insert_test_job(failed_old).await.unwrap();

        let summaries = repo.list_active(10).await.unwrap();
        let ids: Vec<&str> = summaries.iter().map(|s| s.id.as_str()).collect();

        // Active (DESC by created_at): pause-1 (11:00), run-1 (10:00)
        // Terminal (DESC by created_at, LIMIT 10): done-1 (12:00), failed-1 (May 16)
        assert_eq!(ids, vec!["pause-1", "run-1", "done-1", "failed-1"]);

        // Sanity-check the SUBSTR path: insert a job with a multi-line simc_input
        // and confirm list_active still returns it without truncation-induced errors.
        let mut chatty = make_test_job("chatty-1", JobStatus::Running);
        chatty.created_at = "2026-05-17T13:00:00Z".to_string();
        chatty.simc_input = "deathknight=\"Tester\"\n".repeat(500); // > 4 KB
        repo.insert_test_job(chatty).await.unwrap();

        let summaries = repo.list_active(10).await.unwrap();
        let ids: Vec<&str> = summaries.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids[0], "chatty-1");
        let chatty_summary = summaries.iter().find(|s| s.id == "chatty-1").unwrap();
        assert_eq!(chatty_summary.player_name.as_deref(), Some("Tester"));
    }
}
