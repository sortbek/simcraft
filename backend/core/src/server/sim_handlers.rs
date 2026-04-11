use actix_web::{web, HttpResponse};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use super::helpers::*;
use super::types::*;
use crate::addon_parser;
use crate::game_data;
use crate::gear_resolver;
use crate::log_buffer::LogBuffer;
use crate::models::{Job, JobStatus};
use crate::profileset_generator;
use crate::result_parser;
use crate::simc_runner;
use crate::storage::JobStorage;

pub(super) async fn create_sim(
    req: web::Json<SimRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let simc_input = if req.raw {
        req.simc_input.clone()
    } else {
        let mut input = if req.max_upgrade {
            game_data::upgrade_simc_input(&req.simc_input)
        } else {
            req.simc_input.clone()
        };
        input = apply_talent_override(&input, &req.options.talents);
        input = apply_spec_override(&input, &req.options.spec_override);
        input = crate::talent_normalize::normalize_simc_talents(&input);
        input = inject_expert_fields(&input, &req.options);
        input
    };

    if let Some(resp) = validate_batch(&req.options.batch_id, store.get_ref().as_ref()) {
        return resp;
    }

    // Build the full input with sim options inline for "View Raw Input"
    let options_for_display = req.options.to_json_with_sim_type(&req.sim_type);
    let display_input = if req.raw {
        simc_input.clone()
    } else {
        simc_runner::build_simc_input_from_options(&simc_input, &options_for_display)
    };

    let mut job = Job::new(
        display_input,
        req.sim_type.clone(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    job.batch_id = req.options.batch_id.clone();
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();
    store.insert(job);

    // Spawn background task
    let store_clone = store.get_ref().clone();
    let simc = simc_path.get_ref().clone();
    let mut options = req.options.to_json_with_sim_type(&req.sim_type);
    if req.raw {
        options["raw"] = serde_json::json!(true);
    }

    let job_id_clone = job_id.clone();
    let logs = log_buffer.get_ref().clone();
    let jid_logs = job_id.clone();

    tokio::spawn(async move {
        store_clone.update_status(&job_id_clone, JobStatus::Running);
        store_clone.update_progress(&job_id_clone, 20, "Simulating", "");
        let logs_cb = logs.clone();
        let jid_cb = jid_logs.clone();
        match simc_runner::run_simc(&simc, &job_id_clone, &simc_input, &options, move |line| {
            logs_cb.push_line(&jid_cb, line.to_string());
        })
        .await
        {
            Ok(output) => {
                let mut parsed = result_parser::parse_simc_result(&output.json);
                inject_realm(&mut parsed, &simc_input);
                let result_str = serde_json::to_string(&parsed).unwrap_or_default();
                let raw_str = serde_json::to_string(&output.json).ok();
                store_clone.set_result(&job_id_clone, result_str, raw_str);
                store_clone.set_report_files(&job_id_clone, output.html_report, output.text_output);
            }
            Err(e) => {
                let is_cancelled = store_clone
                    .get(&job_id_clone)
                    .map(|j| j.status == JobStatus::Cancelled)
                    .unwrap_or(false);
                if !is_cancelled {
                    store_clone.set_error(&job_id_clone, e);
                }
            }
        }
        logs.remove(&jid_logs);
    });

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}

pub(super) async fn create_top_gear_sim(
    req: web::Json<TopGearRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let mut simc_input = if req.max_upgrade {
        game_data::upgrade_simc_input(&req.simc_input)
    } else {
        req.simc_input.clone()
    };
    simc_input = apply_spec_override(
        &apply_talent_override(&simc_input, &req.options.talents),
        &req.options.spec_override,
    );
    simc_input = crate::talent_normalize::normalize_simc_talents(&simc_input);

    let parse_result = addon_parser::parse_simc_input(&simc_input);

    // Always resolve catalyst charges — needed for constraints even with per-item converts
    let currency_id_sim = crate::item_db::catalyst_currency_id();
    let catalyst_charges = req
        .catalyst_charges
        .or_else(|| crate::addon_parser::parse_catalyst_charges(&req.simc_input, currency_id_sim));

    // Always resolve with catalyst when charges exist so items get the is_catalyst flag
    let resolved = if req.catalyst || catalyst_charges.is_some() {
        gear_resolver::resolve_gear_with_catalyst(&parse_result, catalyst_charges)
    } else {
        gear_resolver::resolve_gear(&parse_result)
    };
    let base_profile = resolved.base_profile.clone();

    let mut items_by_slot: HashMap<String, Vec<serde_json::Value>> =
        if let Some(ref ibs) = req.items_by_slot {
            ibs.clone()
        } else {
            resolve_to_items_by_slot(&resolved)
        };

    if req.max_upgrade {
        items_by_slot = game_data::upgrade_items_by_slot(&items_by_slot);
    }

    if req.copy_enchants {
        items_by_slot = game_data::apply_copy_enchants(&items_by_slot);
    }

    // Build talent builds list: normalize each talent string
    let talent_builds: Vec<(String, String)> = req
        .talent_builds
        .iter()
        .map(|tb| {
            let normalized = crate::talent_normalize::normalize_simc_talents(&format!(
                "talents={}",
                tb.talent_string
            ));
            let ts = normalized
                .strip_prefix("talents=")
                .unwrap_or(&tb.talent_string)
                .to_string();
            (tb.name.clone(), ts)
        })
        .collect();

    // Enforce server-side max combinations cap
    let server_max = *crate::storage::MAX_COMBINATIONS;
    let max_combinations = match (req.max_combinations, server_max) {
        (Some(client), s) if s > 0 => Some(client.min(s)),
        (None, s) if s > 0 => Some(s),
        (client, _) => client,
    };

    // Collect item IDs that have sockets (from all resolved items)
    let socketed_item_ids: std::collections::HashSet<u64> = resolved
        .slots
        .values()
        .flat_map(|res| {
            let mut ids = Vec::new();
            if let Some(eq) = &res.equipped {
                if eq.sockets > 0 { ids.push(eq.item_id); }
            }
            for alt in &res.alternatives {
                if alt.sockets > 0 { ids.push(alt.item_id); }
            }
            ids
        })
        .collect();

    let (generated_input, combo_count, combo_metadata) =
        match profileset_generator::generate_top_gear_input_with_talents(
            &base_profile,
            &items_by_slot,
            &req.selected_items,
            max_combinations,
            &talent_builds,
            catalyst_charges,
            &req.enchant_selections,
            &req.gem_options,
            &socketed_item_ids,
            req.replace_gems,
            req.diamond_always_use,
            req.max_colors,
        ) {
            Ok(r) => r,
            Err(e) => {
                return HttpResponse::BadRequest().json(json!({"detail": e}));
            }
        };

    let has_enchant_gem = req.enchant_selections.values().any(|v| !v.is_empty())
        || !req.gem_options.is_empty();
    if combo_count == 0 && req.talent_builds.len() <= 1 && !has_enchant_gem {
        return HttpResponse::BadRequest().json(json!({
            "detail": "No alternative items selected. Select at least one non-equipped item or multiple talent builds."
        }));
    }

    let generated_input = inject_expert_fields(&generated_input, &req.options);

    if let Some(resp) = validate_batch(&req.options.batch_id, store.get_ref().as_ref()) {
        return resp;
    }

    let options_json = req.options.to_json();
    let display_input = simc_runner::build_simc_input_from_options(&generated_input, &options_json);
    let job = Job::new(
        display_input,
        "top_gear".to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    // Store combo metadata on the job
    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
    }))
    .unwrap_or_default();

    let mut job = job;
    job.combo_metadata_json = Some(meta_json);
    job.batch_id = req.options.batch_id.clone();
    store.insert(job);

    spawn_staged_sim(
        store.get_ref().clone(),
        simc_path.get_ref().clone(),
        req.options.to_json(),
        job_id.clone(),
        generated_input,
        combo_count,
        log_buffer.get_ref().clone(),
    );

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}

pub(super) async fn get_top_gear_combo_count(req: web::Json<TopGearRequest>) -> HttpResponse {
    let mut simc_input = if req.max_upgrade {
        game_data::upgrade_simc_input(&req.simc_input)
    } else {
        req.simc_input.clone()
    };
    simc_input = apply_spec_override(
        &apply_talent_override(&simc_input, &req.options.talents),
        &req.options.spec_override,
    );
    simc_input = crate::talent_normalize::normalize_simc_talents(&simc_input);

    let parse_result = addon_parser::parse_simc_input(&simc_input);

    // Always resolve catalyst charges — needed for constraints even with per-item converts
    let currency_id = crate::item_db::catalyst_currency_id();
    let catalyst_charges = req
        .catalyst_charges
        .or_else(|| crate::addon_parser::parse_catalyst_charges(&req.simc_input, currency_id));

    // Always resolve with catalyst when charges exist so items get the is_catalyst flag
    let resolved = if req.catalyst || catalyst_charges.is_some() {
        gear_resolver::resolve_gear_with_catalyst(&parse_result, catalyst_charges)
    } else {
        gear_resolver::resolve_gear(&parse_result)
    };
    let base_profile = resolved.base_profile.clone();

    let mut items_by_slot: HashMap<String, Vec<serde_json::Value>> =
        if let Some(ref ibs) = req.items_by_slot {
            ibs.clone()
        } else {
            resolve_to_items_by_slot(&resolved)
        };

    if req.max_upgrade {
        items_by_slot = game_data::upgrade_items_by_slot(&items_by_slot);
    }
    if req.copy_enchants {
        items_by_slot = game_data::apply_copy_enchants(&items_by_slot);
    }

    let talent_builds: Vec<(String, String)> = req
        .talent_builds
        .iter()
        .map(|tb| {
            let normalized = crate::talent_normalize::normalize_simc_talents(&format!(
                "talents={}",
                tb.talent_string
            ));
            let ts = normalized
                .strip_prefix("talents=")
                .unwrap_or(&tb.talent_string)
                .to_string();
            (tb.name.clone(), ts)
        })
        .collect();

    let server_max = *crate::storage::MAX_COMBINATIONS;
    let max_combinations = match (req.max_combinations, server_max) {
        (Some(client), s) if s > 0 => Some(client.min(s)),
        (None, s) if s > 0 => Some(s),
        (client, _) => client,
    };

    let socketed_item_ids: std::collections::HashSet<u64> = resolved
        .slots
        .values()
        .flat_map(|res| {
            let mut ids = Vec::new();
            if let Some(eq) = &res.equipped {
                if eq.sockets > 0 { ids.push(eq.item_id); }
            }
            for alt in &res.alternatives {
                if alt.sockets > 0 { ids.push(alt.item_id); }
            }
            ids
        })
        .collect();

    match profileset_generator::generate_top_gear_input_with_talents(
        &base_profile,
        &items_by_slot,
        &req.selected_items,
        max_combinations,
        &talent_builds,
        catalyst_charges,
        &req.enchant_selections,
        &req.gem_options,
        &socketed_item_ids,
        req.replace_gems,
        req.diamond_always_use,
        req.max_colors,
    ) {
        Ok((_, count, _)) => HttpResponse::Ok().json(json!({ "combo_count": count })),
        Err(e) => {
            let count: usize = e
                .split('(')
                .nth(1)
                .and_then(|s| s.split(')').next())
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            HttpResponse::Ok().json(json!({ "combo_count": count, "error": e }))
        }
    }
}

pub(super) async fn create_droptimizer_sim(
    req: web::Json<DroptimizerRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let simc_input = apply_spec_override(
        &apply_talent_override(&req.simc_input, &req.options.talents),
        &req.options.spec_override,
    );
    let simc_input = crate::talent_normalize::normalize_simc_talents(&simc_input);
    let parse_result = addon_parser::parse_simc_input(&simc_input);
    let base_profile = parse_result.base_profile.clone();

    let (generated_input, combo_count, combo_metadata) =
        profileset_generator::generate_droptimizer_input(&base_profile, &req.drop_items);

    if combo_count == 0 {
        return HttpResponse::BadRequest().json(json!({
            "detail": "No items selected. Select at least one drop item."
        }));
    }

    let generated_input = inject_expert_fields(&generated_input, &req.options);

    if let Some(resp) = validate_batch(&req.options.batch_id, store.get_ref().as_ref()) {
        return resp;
    }

    let options_json_drop = req.options.to_json();
    let display_input_drop = simc_runner::build_simc_input_from_options(&generated_input, &options_json_drop);
    let job = Job::new(
        display_input_drop,
        "droptimizer".to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
    }))
    .unwrap_or_default();

    let mut job = job;
    job.combo_metadata_json = Some(meta_json);
    job.batch_id = req.options.batch_id.clone();
    store.insert(job);

    spawn_staged_sim(
        store.get_ref().clone(),
        simc_path.get_ref().clone(),
        req.options.to_json(),
        job_id.clone(),
        generated_input,
        combo_count,
        log_buffer.get_ref().clone(),
    );

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}

// ---- Enchant & Gem sim ----

pub(super) async fn create_enchant_gem_sim(
    req: web::Json<EnchantGemSimRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let simc_input = apply_spec_override(
        &apply_talent_override(&req.simc_input, &req.options.talents),
        &req.options.spec_override,
    );
    let simc_input = crate::talent_normalize::normalize_simc_talents(&simc_input);
    let parse_result = addon_parser::parse_simc_input(&simc_input);
    let resolved = gear_resolver::resolve_gear(&parse_result);
    let base_profile = resolved.base_profile.clone();

    let server_max = *crate::storage::MAX_COMBINATIONS;
    let max_combinations = match (req.max_combinations, server_max) {
        (Some(client), s) if s > 0 => Some(client.min(s)),
        (None, s) if s > 0 => Some(s),
        (client, _) => client,
    };

    let socketed_item_ids: std::collections::HashSet<u64> = resolved
        .slots
        .values()
        .flat_map(|res| {
            let mut ids = Vec::new();
            if let Some(eq) = &res.equipped {
                if eq.sockets > 0 { ids.push(eq.item_id); }
            }
            for alt in &res.alternatives {
                if alt.sockets > 0 { ids.push(alt.item_id); }
            }
            ids
        })
        .collect();

    let (generated_input, combo_count, combo_metadata) =
        match profileset_generator::generate_enchant_gem_input(
            &base_profile,
            &req.enchant_selections,
            &req.gem_options,
            &socketed_item_ids,
            max_combinations,
        ) {
            Ok(r) => r,
            Err(e) => {
                return HttpResponse::BadRequest().json(json!({"detail": e}));
            }
        };

    if combo_count == 0 {
        return HttpResponse::BadRequest().json(json!({
            "detail": "No enchant or gem options selected. Select at least two options for a slot."
        }));
    }

    let generated_input = inject_expert_fields(&generated_input, &req.options);

    if let Some(resp) = validate_batch(&req.options.batch_id, store.get_ref().as_ref()) {
        return resp;
    }

    let options_json_eg = req.options.to_json();
    let display_input_eg = simc_runner::build_simc_input_from_options(&generated_input, &options_json_eg);
    let job = Job::new(
        display_input_eg,
        "enchant_gem".to_string(),
        req.options.iterations,
        req.options.fight_style.clone(),
        req.options.target_error,
    );
    let job_id = job.id.clone();
    let created_at = job.created_at.clone();

    let meta_json = serde_json::to_string(&json!({
        "_combo_metadata": combo_metadata,
        "_combo_count": combo_count,
    }))
    .unwrap_or_default();

    let mut job = job;
    job.combo_metadata_json = Some(meta_json);
    job.batch_id = req.options.batch_id.clone();
    store.insert(job);

    spawn_staged_sim(
        store.get_ref().clone(),
        simc_path.get_ref().clone(),
        req.options.to_json(),
        job_id.clone(),
        generated_input,
        combo_count,
        log_buffer.get_ref().clone(),
    );

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}

pub(super) async fn get_enchant_gem_combo_count(
    req: web::Json<EnchantGemSimRequest>,
) -> HttpResponse {
    let simc_input = apply_spec_override(
        &apply_talent_override(&req.simc_input, &req.options.talents),
        &req.options.spec_override,
    );
    let simc_input = crate::talent_normalize::normalize_simc_talents(&simc_input);
    let parse_result = addon_parser::parse_simc_input(&simc_input);
    let resolved = gear_resolver::resolve_gear(&parse_result);
    let base_profile = resolved.base_profile.clone();

    let server_max = *crate::storage::MAX_COMBINATIONS;
    let max_combinations = match (req.max_combinations, server_max) {
        (Some(client), s) if s > 0 => Some(client.min(s)),
        (None, s) if s > 0 => Some(s),
        (client, _) => client,
    };

    let socketed_item_ids: std::collections::HashSet<u64> = resolved
        .slots
        .values()
        .flat_map(|res| {
            let mut ids = Vec::new();
            if let Some(eq) = &res.equipped {
                if eq.sockets > 0 { ids.push(eq.item_id); }
            }
            for alt in &res.alternatives {
                if alt.sockets > 0 { ids.push(alt.item_id); }
            }
            ids
        })
        .collect();

    match profileset_generator::generate_enchant_gem_input(
        &base_profile,
        &req.enchant_selections,
        &req.gem_options,
        &socketed_item_ids,
        max_combinations,
    ) {
        Ok((_, count, _)) => HttpResponse::Ok().json(json!({"combo_count": count})),
        Err(e) => HttpResponse::BadRequest().json(json!({"detail": e})),
    }
}
