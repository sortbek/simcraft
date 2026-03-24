use std::sync::Mutex;

use rusqlite::{params, Connection};

use crate::models::{Job, JobStatus, JobSummary, extract_result_summary};
use super::JobStorage;

pub struct SqliteStorage {
    conn: Mutex<Connection>,
}

impl SqliteStorage {
    pub fn new(path: &str) -> Self {
        let conn = Connection::open(path).expect("Failed to open SQLite database");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'pending',
                sim_type TEXT NOT NULL,
                simc_input TEXT NOT NULL,
                result_json TEXT,
                combo_metadata_json TEXT,
                error_message TEXT,
                progress_pct INTEGER NOT NULL DEFAULT 0,
                progress_stage TEXT,
                progress_detail TEXT,
                stages_completed TEXT NOT NULL DEFAULT '[]',
                iterations INTEGER NOT NULL,
                fight_style TEXT NOT NULL,
                target_error REAL NOT NULL,
                created_at TEXT NOT NULL
            );"
        ).expect("Failed to create jobs table");

        // Migrate: add columns if missing
        let _ = conn.execute_batch(
            "ALTER TABLE jobs ADD COLUMN html_report TEXT;
             ALTER TABLE jobs ADD COLUMN text_output TEXT;"
        );
        let _ = conn.execute_batch("ALTER TABLE jobs ADD COLUMN raw_json TEXT;");

        Self { conn: Mutex::new(conn) }
    }

    fn status_to_str(status: &JobStatus) -> &'static str {
        match status {
            JobStatus::Pending => "pending",
            JobStatus::Running => "running",
            JobStatus::Done => "done",
            JobStatus::Failed => "failed",
        }
    }

    fn str_to_status(s: &str) -> JobStatus {
        match s {
            "running" => JobStatus::Running,
            "done" => JobStatus::Done,
            "failed" => JobStatus::Failed,
            _ => JobStatus::Pending,
        }
    }

    fn row_to_job(row: &rusqlite::Row) -> rusqlite::Result<Job> {
        let status_str: String = row.get(1)?;
        let stages_str: String = row.get(10)?;
        let stages: Vec<String> = serde_json::from_str(&stages_str).unwrap_or_default();

        Ok(Job {
            id: row.get(0)?,
            status: SqliteStorage::str_to_status(&status_str),
            sim_type: row.get(2)?,
            simc_input: row.get(3)?,
            result_json: row.get(4)?,
            combo_metadata_json: row.get(5)?,
            error_message: row.get(6)?,
            progress_pct: row.get::<_, u8>(7)?,
            progress_stage: row.get(8)?,
            progress_detail: row.get(9)?,
            stages_completed: stages,
            iterations: row.get::<_, u32>(11)?,
            fight_style: row.get(12)?,
            target_error: row.get(13)?,
            created_at: row.get(14)?,
            raw_json: row.get(15).ok().flatten(),
            html_report: row.get(16).ok().flatten(),
            text_output: row.get(17).ok().flatten(),
        })
    }
}

impl JobStorage for SqliteStorage {
    fn insert(&self, job: Job) {
        let conn = self.conn.lock().unwrap();
        let stages_json = serde_json::to_string(&job.stages_completed).unwrap();
        conn.execute(
            "INSERT INTO jobs (id, status, sim_type, simc_input, result_json, combo_metadata_json,
             error_message, progress_pct, progress_stage, progress_detail, stages_completed,
             iterations, fight_style, target_error, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                job.id,
                Self::status_to_str(&job.status),
                job.sim_type,
                job.simc_input,
                job.result_json,
                job.combo_metadata_json,
                job.error_message,
                job.progress_pct,
                job.progress_stage,
                job.progress_detail,
                stages_json,
                job.iterations,
                job.fight_style,
                job.target_error,
                job.created_at,
            ],
        ).expect("Failed to insert job");

        // Garbage collect oldest jobs beyond limit
        conn.execute(
            "DELETE FROM jobs WHERE id NOT IN (SELECT id FROM jobs ORDER BY created_at DESC LIMIT ?1)",
            params![*super::MAX_JOBS as u32],
        ).ok();
    }

    fn get(&self, id: &str) -> Option<Job> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, status, sim_type, simc_input, result_json, combo_metadata_json,
             error_message, progress_pct, progress_stage, progress_detail, stages_completed,
             iterations, fight_style, target_error, created_at, raw_json, html_report, text_output
             FROM jobs WHERE id = ?1",
            params![id],
            Self::row_to_job,
        ).ok()
    }

    fn list_recent(&self, limit: usize, player: Option<&str>, realm: Option<&str>) -> Vec<JobSummary> {
        let conn = self.conn.lock().unwrap();
        // Fetch more rows than needed when filtering, since we filter in code
        let fetch_limit = if player.is_some() || realm.is_some() { 200u32 } else { limit as u32 };
        let mut stmt = conn.prepare(
            "SELECT id, status, sim_type, created_at, fight_style, iterations, error_message, result_json, simc_input
             FROM jobs ORDER BY created_at DESC LIMIT ?1"
        ).unwrap();
        let all: Vec<JobSummary> = stmt.query_map(params![fetch_limit], |row| {
            let status_str: String = row.get(1)?;
            let result_json: Option<String> = row.get(7)?;
            let simc_input: String = row.get::<_, String>(8).unwrap_or_default();
            let s = extract_result_summary(&result_json, &simc_input);
            Ok(JobSummary {
                id: row.get(0)?,
                status: Self::str_to_status(&status_str),
                sim_type: row.get(2)?,
                created_at: row.get(3)?,
                fight_style: row.get(4)?,
                iterations: row.get::<_, u32>(5)?,
                error_message: row.get(6)?,
                player_name: s.player_name,
                player_class: s.player_class,
                realm: s.realm,
                dps: s.dps,
            })
        }).unwrap().filter_map(|r| r.ok()).collect();

        if player.is_none() && realm.is_none() {
            return all;
        }
        all.into_iter().filter(|j| {
            if let Some(p) = player {
                if j.player_name.as_deref() != Some(p) { return false; }
            }
            if let Some(r) = realm {
                if j.realm.as_deref() != Some(r) { return false; }
            }
            true
        }).take(limit).collect()
    }

    fn update_status(&self, id: &str, status: JobStatus) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET status = ?1 WHERE id = ?2",
            params![Self::status_to_str(&status), id],
        ).ok();
    }

    fn update_progress(&self, id: &str, pct: u8, stage: &str, detail: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET progress_pct = ?1, progress_stage = ?2, progress_detail = ?3 WHERE id = ?4",
            params![pct, stage, detail, id],
        ).ok();
    }

    fn complete_stage(&self, id: &str, summary: &str) {
        let conn = self.conn.lock().unwrap();
        // Read current stages, append, write back
        let current: Option<String> = conn.query_row(
            "SELECT stages_completed FROM jobs WHERE id = ?1",
            params![id],
            |row| row.get(0),
        ).ok();

        if let Some(stages_str) = current {
            let mut stages: Vec<String> = serde_json::from_str(&stages_str).unwrap_or_default();
            stages.push(summary.to_string());
            let updated = serde_json::to_string(&stages).unwrap();
            conn.execute(
                "UPDATE jobs SET stages_completed = ?1 WHERE id = ?2",
                params![updated, id],
            ).ok();
        }
    }

    fn set_result(&self, id: &str, result: String, raw_json: Option<String>) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET result_json = ?1, raw_json = ?2, status = 'done' WHERE id = ?3",
            params![result, raw_json, id],
        ).ok();
    }

    fn set_error(&self, id: &str, error: String) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET error_message = ?1, status = 'failed' WHERE id = ?2",
            params![error, id],
        ).ok();
    }

    fn set_report_files(&self, id: &str, html: Option<String>, text: Option<String>) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET html_report = ?1, text_output = ?2 WHERE id = ?3",
            params![html, text, id],
        ).ok();
    }
}
