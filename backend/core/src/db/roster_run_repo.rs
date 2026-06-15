use serde::{Deserialize, Serialize};
use sqlx::{AnyPool, Row};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RosterRun {
    pub id: String,
    pub roster_id: String,
    pub instance_id: i64,
    pub difficulty: String,
    pub batch_id: String,
    pub status: String,
    pub report_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RosterRunJob {
    pub run_id: String,
    pub member_id: String,
    pub job_id: String,
}

#[derive(Clone)]
pub struct RosterRunRepo {
    backend: RosterRunBackend,
}

#[derive(Clone)]
enum RosterRunBackend {
    Database(AnyPool),
    Memory(Arc<Mutex<RosterRunMemory>>),
}

#[derive(Default)]
struct RosterRunMemory {
    runs: Vec<RosterRun>,
    jobs: Vec<RosterRunJob>,
}

impl RosterRunRepo {
    pub fn new(pool: AnyPool) -> Self {
        Self {
            backend: RosterRunBackend::Database(pool),
        }
    }

    pub fn new_memory() -> Self {
        Self {
            backend: RosterRunBackend::Memory(Arc::new(Mutex::new(RosterRunMemory::default()))),
        }
    }

    pub async fn create_run(
        &self,
        roster_id: &str,
        instance_id: i64,
        difficulty: &str,
        batch_id: &str,
    ) -> Result<RosterRun, sqlx::Error> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let status = "running".to_string();

        match &self.backend {
            RosterRunBackend::Database(pool) => {
                sqlx::query(
                    "INSERT INTO roster_runs (id, roster_id, instance_id, difficulty, batch_id, status, report_json, created_at) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)",
                )
                .bind(&id)
                .bind(roster_id)
                .bind(instance_id)
                .bind(difficulty)
                .bind(batch_id)
                .bind(&status)
                .bind(&now)
                .execute(pool)
                .await?;
            }
            RosterRunBackend::Memory(memory) => {
                memory.lock().unwrap().runs.push(RosterRun {
                    id: id.clone(),
                    roster_id: roster_id.to_string(),
                    instance_id,
                    difficulty: difficulty.to_string(),
                    batch_id: batch_id.to_string(),
                    status: status.clone(),
                    report_json: None,
                    created_at: now.clone(),
                });
            }
        }

        Ok(RosterRun {
            id,
            roster_id: roster_id.to_string(),
            instance_id,
            difficulty: difficulty.to_string(),
            batch_id: batch_id.to_string(),
            status,
            report_json: None,
            created_at: now,
        })
    }

    pub async fn get_run(&self, id: &str) -> Result<Option<RosterRun>, sqlx::Error> {
        match &self.backend {
            RosterRunBackend::Database(pool) => {
                let row = sqlx::query(
                    "SELECT id, roster_id, instance_id, difficulty, batch_id, status, report_json, created_at FROM roster_runs WHERE id = $1",
                )
                .bind(id)
                .fetch_optional(pool)
                .await?;

                Ok(row.map(|r| RosterRun {
                    id: r.get("id"),
                    roster_id: r.get("roster_id"),
                    instance_id: r.get("instance_id"),
                    difficulty: r.get("difficulty"),
                    batch_id: r.get("batch_id"),
                    status: r.get("status"),
                    report_json: r.get::<Option<String>, _>("report_json"),
                    created_at: r.get("created_at"),
                }))
            }
            RosterRunBackend::Memory(memory) => Ok(memory
                .lock()
                .unwrap()
                .runs
                .iter()
                .find(|r| r.id == id)
                .cloned()),
        }
    }

    pub async fn add_job(
        &self,
        run_id: &str,
        member_id: &str,
        job_id: &str,
    ) -> Result<(), sqlx::Error> {
        match &self.backend {
            RosterRunBackend::Database(pool) => {
                sqlx::query(
                    "INSERT INTO roster_run_jobs (run_id, member_id, job_id) VALUES ($1, $2, $3)",
                )
                .bind(run_id)
                .bind(member_id)
                .bind(job_id)
                .execute(pool)
                .await?;
            }
            RosterRunBackend::Memory(memory) => {
                memory.lock().unwrap().jobs.push(RosterRunJob {
                    run_id: run_id.to_string(),
                    member_id: member_id.to_string(),
                    job_id: job_id.to_string(),
                });
            }
        }
        Ok(())
    }

    pub async fn list_jobs(&self, run_id: &str) -> Result<Vec<RosterRunJob>, sqlx::Error> {
        match &self.backend {
            RosterRunBackend::Database(pool) => {
                let rows = sqlx::query(
                    "SELECT run_id, member_id, job_id FROM roster_run_jobs WHERE run_id = $1",
                )
                .bind(run_id)
                .fetch_all(pool)
                .await?;

                Ok(rows
                    .iter()
                    .map(|r| RosterRunJob {
                        run_id: r.get("run_id"),
                        member_id: r.get("member_id"),
                        job_id: r.get("job_id"),
                    })
                    .collect())
            }
            RosterRunBackend::Memory(memory) => Ok(memory
                .lock()
                .unwrap()
                .jobs
                .iter()
                .filter(|j| j.run_id == run_id)
                .cloned()
                .collect()),
        }
    }

    pub async fn set_report(&self, id: &str, report_json: &str) -> Result<(), sqlx::Error> {
        match &self.backend {
            RosterRunBackend::Database(pool) => {
                sqlx::query(
                    "UPDATE roster_runs SET report_json = $1, status = 'done' WHERE id = $2",
                )
                .bind(report_json)
                .bind(id)
                .execute(pool)
                .await?;
            }
            RosterRunBackend::Memory(memory) => {
                let mut memory = memory.lock().unwrap();
                if let Some(run) = memory.runs.iter_mut().find(|r| r.id == id) {
                    run.report_json = Some(report_json.to_string());
                    run.status = "done".to_string();
                }
            }
        }
        Ok(())
    }

    pub async fn set_status(&self, id: &str, status: &str) -> Result<(), sqlx::Error> {
        match &self.backend {
            RosterRunBackend::Database(pool) => {
                sqlx::query("UPDATE roster_runs SET status = $1 WHERE id = $2")
                    .bind(status)
                    .bind(id)
                    .execute(pool)
                    .await?;
            }
            RosterRunBackend::Memory(memory) => {
                let mut memory = memory.lock().unwrap();
                if let Some(run) = memory.runs.iter_mut().find(|r| r.id == id) {
                    run.status = status.to_string();
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn create_run_then_get_and_map_jobs() {
        let repo = RosterRunRepo::new_memory();
        let run = repo.create_run("roster1", 1234, "heroic", "batch1").await.unwrap();
        assert_eq!(run.status, "running");
        assert_eq!(run.instance_id, 1234);
        assert!(run.report_json.is_none());
        repo.add_job(&run.id, "memberA", "jobA").await.unwrap();
        repo.add_job(&run.id, "memberB", "jobB").await.unwrap();
        let jobs = repo.list_jobs(&run.id).await.unwrap();
        assert_eq!(jobs.len(), 2);
        let got = repo.get_run(&run.id).await.unwrap().unwrap();
        assert_eq!(got.roster_id, "roster1");
        assert_eq!(got.batch_id, "batch1");
    }

    #[tokio::test]
    async fn set_report_marks_done() {
        let repo = RosterRunRepo::new_memory();
        let run = repo.create_run("r", 1, "mythic", "b").await.unwrap();
        repo.set_report(&run.id, "{\"ok\":true}").await.unwrap();
        let got = repo.get_run(&run.id).await.unwrap().unwrap();
        assert_eq!(got.status, "done");
        assert_eq!(got.report_json.as_deref(), Some("{\"ok\":true}"));
    }

    #[tokio::test]
    async fn set_status_updates_run() {
        let repo = RosterRunRepo::new_memory();
        let run = repo.create_run("r", 1, "heroic", "b").await.unwrap();
        repo.set_status(&run.id, "failed").await.unwrap();
        assert_eq!(repo.get_run(&run.id).await.unwrap().unwrap().status, "failed");
    }
}
