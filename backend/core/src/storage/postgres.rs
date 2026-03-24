use std::sync::Mutex;

use tokio_postgres::{Client, NoTls};

use crate::models::{Job, JobStatus, JobSummary, extract_result_summary};
use super::JobStorage;

pub struct PostgresStorage {
    client: Mutex<Client>,
    rt: tokio::runtime::Runtime,
}

impl PostgresStorage {
    /// Connect to PostgreSQL and create the jobs table if needed.
    /// `url` should be a full connection string, e.g. "host=localhost user=simhammer dbname=simhammer"
    /// or "postgres://simhammer:pass@localhost/simhammer".
    pub async fn new(url: &str) -> Self {
        let (client, connection) = tokio_postgres::connect(url, NoTls)
            .await
            .expect("Failed to connect to PostgreSQL");

        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("Failed to create Tokio runtime for PostgresStorage");

        rt.spawn(async move {
            if let Err(e) = connection.await {
                eprintln!("PostgreSQL connection error: {}", e);
            }
        });

        client.batch_execute(
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
                target_error DOUBLE PRECISION NOT NULL,
                created_at TEXT NOT NULL
            );"
        ).await.expect("Failed to create jobs table");

        // Migrate: add columns if missing
        let _ = client.batch_execute(
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS html_report TEXT;
             ALTER TABLE jobs ADD COLUMN IF NOT EXISTS text_output TEXT;
             ALTER TABLE jobs ADD COLUMN IF NOT EXISTS raw_json TEXT;"
        ).await;

        Self { client: Mutex::new(client), rt }
    }

    /// Run a closure with the DB client on a fresh OS thread,
    /// avoiding Tokio's "cannot block within a runtime" restriction.
    fn blocking<F, T>(&self, f: F) -> T
    where
        F: FnOnce(&Client) -> T + Send,
        T: Send,
    {
        let client = self.client.lock().unwrap();
        std::thread::scope(|s| {
            s.spawn(|| f(&client)).join().unwrap()
        })
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

    fn row_to_job(row: &tokio_postgres::Row) -> Job {
        let status_str: String = row.get(1);
        let stages_str: String = row.get(10);
        let stages: Vec<String> = serde_json::from_str(&stages_str).unwrap_or_default();
        let progress_pct: i32 = row.get(7);
        let iterations: i32 = row.get(11);

        Job {
            id: row.get(0),
            status: Self::str_to_status(&status_str),
            sim_type: row.get(2),
            simc_input: row.get(3),
            result_json: row.get(4),
            combo_metadata_json: row.get(5),
            error_message: row.get(6),
            progress_pct: progress_pct as u8,
            progress_stage: row.get(8),
            progress_detail: row.get(9),
            stages_completed: stages,
            iterations: iterations as u32,
            fight_style: row.get(12),
            target_error: row.get(13),
            created_at: row.get(14),
            raw_json: row.get(15),
            html_report: row.get(16),
            text_output: row.get(17),
        }
    }
}

impl JobStorage for PostgresStorage {
    fn insert(&self, job: Job) {
        let stages_json = serde_json::to_string(&job.stages_completed).unwrap();
        self.blocking(|client| {
            self.rt.block_on(async {
                client.execute(
                    "INSERT INTO jobs (id, status, sim_type, simc_input, result_json, combo_metadata_json,
                     error_message, progress_pct, progress_stage, progress_detail, stages_completed,
                     iterations, fight_style, target_error, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
                    &[
                        &job.id,
                        &Self::status_to_str(&job.status),
                        &job.sim_type,
                        &job.simc_input,
                        &job.result_json,
                        &job.combo_metadata_json,
                        &job.error_message,
                        &(job.progress_pct as i32),
                        &job.progress_stage,
                        &job.progress_detail,
                        &stages_json,
                        &(job.iterations as i32),
                        &job.fight_style,
                        &job.target_error,
                        &job.created_at,
                    ],
                ).await.expect("Failed to insert job");

                // Garbage collect oldest jobs beyond limit
                client.execute(
                    "DELETE FROM jobs WHERE id NOT IN (SELECT id FROM jobs ORDER BY created_at DESC LIMIT $1)",
                    &[&(*super::MAX_JOBS as i64)],
                ).await.ok();
            });
        });
    }

    fn get(&self, id: &str) -> Option<Job> {
        self.blocking(|client| {
            self.rt.block_on(async {
                client.query_opt(
                    "SELECT id, status, sim_type, simc_input, result_json, combo_metadata_json,
                     error_message, progress_pct, progress_stage, progress_detail, stages_completed,
                     iterations, fight_style, target_error, created_at, raw_json, html_report, text_output
                     FROM jobs WHERE id = $1",
                    &[&id],
                ).await.ok().flatten().map(|row| Self::row_to_job(&row))
            })
        })
    }

    fn list_recent(&self, limit: usize, player: Option<&str>, realm: Option<&str>) -> Vec<JobSummary> {
        let player = player.map(String::from);
        let realm = realm.map(String::from);
        self.blocking(|client| {
            self.rt.block_on(async {
                let fetch_limit = if player.is_some() || realm.is_some() { 200i64 } else { limit as i64 };
                let rows = client.query(
                    "SELECT id, status, sim_type, created_at, fight_style, iterations, error_message, result_json, simc_input
                     FROM jobs ORDER BY created_at DESC LIMIT $1",
                    &[&fetch_limit],
                ).await.unwrap_or_default();
                let all: Vec<JobSummary> = rows.iter().map(|row| {
                    let status_str: String = row.get(1);
                    let iterations: i32 = row.get(5);
                    let result_json: Option<String> = row.get(7);
                    let simc_input: String = row.get::<_, Option<String>>(8).unwrap_or_default();
                    let s = extract_result_summary(&result_json, &simc_input);
                    JobSummary {
                        id: row.get(0),
                        status: Self::str_to_status(&status_str),
                        sim_type: row.get(2),
                        created_at: row.get(3),
                        fight_style: row.get(4),
                        iterations: iterations as u32,
                        error_message: row.get(6),
                        player_name: s.player_name,
                        player_class: s.player_class,
                        realm: s.realm,
                        dps: s.dps,
                    }
                }).collect();
                if player.is_none() && realm.is_none() {
                    return all;
                }
                all.into_iter().filter(|j| {
                    if let Some(ref p) = player {
                        if j.player_name.as_deref() != Some(p) { return false; }
                    }
                    if let Some(ref r) = realm {
                        if j.realm.as_deref() != Some(r) { return false; }
                    }
                    true
                }).take(limit).collect()
            })
        })
    }

    fn update_status(&self, id: &str, status: JobStatus) {
        self.blocking(|client| {
            self.rt.block_on(async {
                client.execute(
                    "UPDATE jobs SET status = $1 WHERE id = $2",
                    &[&Self::status_to_str(&status), &id],
                ).await.ok();
            });
        });
    }

    fn update_progress(&self, id: &str, pct: u8, stage: &str, detail: &str) {
        self.blocking(|client| {
            self.rt.block_on(async {
                client.execute(
                    "UPDATE jobs SET progress_pct = $1, progress_stage = $2, progress_detail = $3 WHERE id = $4",
                    &[&(pct as i32), &stage, &detail, &id],
                ).await.ok();
            });
        });
    }

    fn complete_stage(&self, id: &str, summary: &str) {
        self.blocking(|client| {
            self.rt.block_on(async {
                let row = client.query_opt(
                    "SELECT stages_completed FROM jobs WHERE id = $1",
                    &[&id],
                ).await.ok().flatten();

                if let Some(row) = row {
                    let stages_str: String = row.get(0);
                    let mut stages: Vec<String> = serde_json::from_str(&stages_str).unwrap_or_default();
                    stages.push(summary.to_string());
                    let updated = serde_json::to_string(&stages).unwrap();
                    client.execute(
                        "UPDATE jobs SET stages_completed = $1 WHERE id = $2",
                        &[&updated, &id],
                    ).await.ok();
                }
            });
        });
    }

    fn set_result(&self, id: &str, result: String, raw_json: Option<String>) {
        self.blocking(|client| {
            self.rt.block_on(async {
                client.execute(
                    "UPDATE jobs SET result_json = $1, raw_json = $2, status = 'done' WHERE id = $3",
                    &[&result, &raw_json, &id],
                ).await.ok();
            });
        });
    }

    fn set_error(&self, id: &str, error: String) {
        self.blocking(|client| {
            self.rt.block_on(async {
                client.execute(
                    "UPDATE jobs SET error_message = $1, status = 'failed' WHERE id = $2",
                    &[&error, &id],
                ).await.ok();
            });
        });
    }

    fn set_report_files(&self, id: &str, html: Option<String>, text: Option<String>) {
        self.blocking(|client| {
            self.rt.block_on(async {
                client.execute(
                    "UPDATE jobs SET html_report = $1, text_output = $2 WHERE id = $3",
                    &[&html, &text, &id],
                ).await.ok();
            });
        });
    }
}
