use actix_web::web;
use actix_web::HttpResponse;
use serde_json::json;
use std::sync::Arc;
#[cfg(feature = "desktop")]
use std::sync::Mutex;

use super::SimcBinaries;

use crate::storage;

#[cfg(feature = "desktop")]
pub(super) struct SystemStats {
    sys: sysinfo::System,
}

#[cfg(feature = "desktop")]
impl SystemStats {
    pub(super) fn new() -> Self {
        let mut sys = sysinfo::System::new();
        sys.refresh_cpu_all();
        Self { sys }
    }

    fn refresh(&mut self) {
        self.sys.refresh_cpu_all();
    }

    fn cpu_usage(&self) -> f32 {
        let cpus = self.sys.cpus();
        if cpus.is_empty() {
            return 0.0;
        }
        cpus.iter().map(|c| c.cpu_usage()).sum::<f32>() / cpus.len() as f32
    }
}

pub(super) async fn get_config() -> HttpResponse {
    let max_combos = *storage::MAX_COMBINATIONS;
    let mut config = json!({
        "max_scenarios": *storage::MAX_SCENARIOS,
    });
    if max_combos > 0 {
        config["max_combinations"] = json!(max_combos);
    }
    HttpResponse::Ok().json(config)
}

pub(super) async fn health_check() -> HttpResponse {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    HttpResponse::Ok().json(json!({
        "status": "ok",
        "threads": threads,
        "mode": "desktop",
    }))
}

pub(super) async fn get_branches(simc: web::Data<Arc<SimcBinaries>>) -> HttpResponse {
    HttpResponse::Ok().json(json!({
        "branches": simc.available_branches(),
        "default": simc.default_branch,
    }))
}

#[cfg(feature = "desktop")]
pub(super) async fn system_stats(stats: web::Data<Arc<Mutex<SystemStats>>>) -> HttpResponse {
    let mut s = stats.lock().unwrap();
    s.refresh();
    let cpu = s.cpu_usage();
    HttpResponse::Ok().json(json!({
        "cpu_usage": (cpu * 10.0).round() / 10.0,
    }))
}
