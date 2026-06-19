use actix_web::web;

#[cfg(not(feature = "desktop"))]
use super::admin_handlers;
use super::armory_handlers;
use super::character_handlers;
use super::cloud_estimate;
use super::droptimizer_handlers;
use super::game_data_handlers;
use super::job_handlers;
use super::mdt_handlers;
use super::provider_handlers;
use super::roster_handlers;
use super::roster_run_handlers;
use super::route_handlers;
use super::sim_handlers;
use super::system_handlers;
use super::resolve_drops;
use super::top_gear_handlers;
use super::upgrade_compare;

pub(super) fn configure(cfg: &mut web::ServiceConfig) {
    cfg.route("/api/sim", web::post().to(sim_handlers::create_sim))
        .route(
            "/api/sim/{id}/sim-row",
            web::post().to(sim_handlers::sim_row),
        )
        .route(
            "/api/top-gear/sim",
            web::post().to(top_gear_handlers::create_top_gear_sim),
        )
        .route(
            "/api/top-gear/combo-count",
            web::post().to(top_gear_handlers::get_top_gear_combo_count),
        )
        .route(
            "/api/top-gear/cloud-estimate",
            web::post().to(cloud_estimate::cloud_estimate_top_gear),
        )
        .route(
            "/api/top-gear/resolve-drops",
            web::post().to(resolve_drops::resolve_drops),
        )
        .route(
            "/api/droptimizer/sim",
            web::post().to(droptimizer_handlers::create_droptimizer_sim),
        )
        .route("/api/mdt/decode", web::post().to(mdt_handlers::decode_mdt))
        .route(
            "/api/mdt/dungeons",
            web::get().to(mdt_handlers::list_dungeons),
        )
        .route(
            "/api/mdt/dungeon/{idx}",
            web::get().to(mdt_handlers::dungeon_overview),
        )
        .route(
            "/api/mdt/serialize",
            web::post().to(mdt_handlers::serialize_route),
        )
        .route(
            "/api/enchants",
            web::get().to(game_data_handlers::list_enchants),
        )
        .route("/api/gems", web::get().to(game_data_handlers::list_gems))
        .route(
            "/api/consumables",
            web::get().to(game_data_handlers::list_consumables),
        )
        .route(
            "/api/upgrade-compare/prepare",
            web::post().to(upgrade_compare::get_upgrade_compare_prepare),
        )
        .route(
            "/api/upgrade-compare/sim",
            web::post().to(upgrade_compare::create_upgrade_compare_sim),
        )
        .route(
            "/api/upgrade-compare/combo-count",
            web::post().to(upgrade_compare::get_upgrade_compare_combo_count),
        )
        .route(
            "/api/upgrade-options",
            web::get().to(upgrade_compare::get_upgrade_options_handler),
        )
        .route("/api/sim/{id}", web::get().to(job_handlers::get_sim_status))
        .route(
            "/api/sim/{id}/logs",
            web::get().to(job_handlers::get_sim_logs),
        )
        .route(
            "/api/sim/{id}/cancel",
            web::post().to(job_handlers::cancel_sim),
        )
        .route(
            "/api/sim/{id}/pause",
            web::post().to(job_handlers::pause_sim),
        )
        .route(
            "/api/sim/{id}/resume",
            web::post().to(job_handlers::resume_sim),
        )
        .route("/api/jobs", web::get().to(job_handlers::list_jobs))
        .route("/api/jobs/{id}", web::delete().to(job_handlers::delete_job))
        .route(
            "/api/sim/{id}/input",
            web::get().to(job_handlers::get_sim_input),
        )
        .route(
            "/api/sim/{id}/input/preview",
            web::get().to(job_handlers::get_sim_input_preview),
        )
        .route(
            "/api/sim/{id}/raw",
            web::get().to(job_handlers::get_sim_raw),
        )
        .route(
            "/api/sim/{id}/html",
            web::get().to(job_handlers::get_sim_html),
        )
        .route(
            "/api/sim/{id}/output.txt",
            web::get().to(job_handlers::get_sim_text_output),
        )
        .route(
            "/api/sim/{id}/data.csv",
            web::get().to(job_handlers::get_sim_csv),
        )
        .route(
            "/api/item-names",
            web::get().to(game_data_handlers::get_item_names),
        )
        .route(
            "/api/item-info/{id}",
            web::get().to(game_data_handlers::get_item_info),
        )
        .route(
            "/api/items/search",
            web::get().to(game_data_handlers::search_items),
        )
        .route(
            "/api/item-info/batch",
            web::post().to(game_data_handlers::get_item_info_batch),
        )
        .route(
            "/api/enchant-info/{id}",
            web::get().to(game_data_handlers::get_enchant_info),
        )
        .route(
            "/api/enchant-info/batch",
            web::post().to(game_data_handlers::get_enchant_info_batch),
        )
        .route(
            "/api/gem-info/{id}",
            web::get().to(game_data_handlers::get_gem_info),
        )
        .route(
            "/api/gem-info/batch",
            web::post().to(game_data_handlers::get_gem_info_batch),
        )
        .route(
            "/api/max-upgrade-ilevels",
            web::post().to(game_data_handlers::get_max_upgrade_ilevels),
        )
        .route(
            "/api/upgrade-tracks",
            web::get().to(game_data_handlers::list_upgrade_tracks),
        )
        .route(
            "/api/gear/resolve",
            web::post().to(game_data_handlers::resolve_gear),
        )
        .route(
            "/api/gear/catalyst-convert",
            web::post().to(game_data_handlers::catalyst_convert),
        )
        .route(
            "/api/gear/void-forge-convert",
            web::post().to(game_data_handlers::void_forge_convert),
        )
        .route(
            "/api/season-config",
            web::get().to(game_data_handlers::get_season_config),
        )
        .route(
            "/api/instances",
            web::get().to(game_data_handlers::list_instances),
        )
        .route(
            "/api/instances/type/{type}/drops",
            web::get().to(game_data_handlers::get_drops_by_type),
        )
        .route(
            "/api/instances/{id}/drops",
            web::get().to(game_data_handlers::get_instance_drops),
        )
        .route(
            "/api/talent-tree/{specId}",
            web::get().to(game_data_handlers::get_talent_tree),
        )
        .route("/api/config", web::get().to(system_handlers::get_config))
        .route(
            "/api/branches",
            web::get().to(system_handlers::get_branches),
        )
        .route(
            "/api/simc/versions",
            web::get().to(system_handlers::get_simc_versions),
        )
        .route(
            "/api/simc/updates",
            web::get().to(system_handlers::check_simc_updates),
        )
        .route(
            "/api/providers",
            web::get().to(provider_handlers::list_providers),
        )
        .route(
            "/api/providers/{id}/test",
            web::post().to(provider_handlers::test_provider),
        )
        .route("/health", web::get().to(system_handlers::health_check))
        .route("/api/routes", web::get().to(route_handlers::list_routes))
        .route("/api/routes", web::post().to(route_handlers::create_route))
        .route(
            "/api/routes/{id}",
            web::delete().to(route_handlers::delete_route),
        )
        .route(
            "/api/characters",
            web::get().to(character_handlers::list_characters),
        )
        .route(
            "/api/characters",
            web::post().to(character_handlers::upsert_character),
        )
        .route(
            "/api/characters/{id}",
            web::delete().to(character_handlers::delete_character),
        )
        .route(
            "/api/characters/{id}/talents",
            web::get().to(character_handlers::get_talent_builds),
        )
        .route(
            "/api/talent-builds/{id}",
            web::delete().to(character_handlers::delete_talent_build),
        )
        .route(
            "/api/armory/import",
            web::post().to(armory_handlers::import_armory_character),
        )
        .route("/api/rosters", web::get().to(roster_handlers::list_rosters))
        .route(
            "/api/rosters",
            web::post().to(roster_handlers::create_roster),
        )
        .route(
            "/api/rosters/{id}",
            web::delete().to(roster_handlers::delete_roster),
        )
        .route(
            "/api/rosters/{id}/members",
            web::get().to(roster_handlers::list_members),
        )
        .route(
            "/api/rosters/{id}/members/{member_id}",
            web::delete().to(roster_handlers::delete_member),
        )
        .route(
            "/api/rosters/{id}/import",
            web::post().to(roster_handlers::import_members),
        )
        .route(
            "/api/rosters/{id}/refresh",
            web::post().to(roster_handlers::refresh_roster),
        )
        .route(
            "/api/rosters/{id}/members/{member_id}/refresh",
            web::post().to(roster_handlers::refresh_member),
        )
        .route(
            "/api/rosters/{id}/runs",
            web::post().to(roster_run_handlers::start_run),
        )
        .route(
            "/api/rosters/{id}/runs",
            web::get().to(roster_run_handlers::list_runs),
        )
        .route(
            "/api/rosters/runs/{run_id}",
            web::get().to(roster_run_handlers::get_run),
        );

    #[cfg(feature = "desktop")]
    {
        cfg.route(
            "/api/system-stats",
            web::get().to(system_handlers::system_stats),
        )
        // Server-side persisted provider keys are desktop-only: web sends keys
        // per-request via X-Provider-<id>-Key so the server never holds them.
        // Exposing these on web would let an anonymous caller plant a key the
        // server then attaches to all sims.
        .route(
            "/api/settings/provider/{id}",
            web::post().to(provider_handlers::save_provider_key),
        )
        .route(
            "/api/settings/provider/{id}",
            web::delete().to(provider_handlers::delete_provider_key),
        )
        .route(
            "/api/providers/{id}/test-stored",
            web::post().to(provider_handlers::test_stored_provider_key),
        );
    }

    #[cfg(not(feature = "desktop"))]
    {
        cfg.route("/api/admin/login", web::post().to(admin_handlers::login))
            .route(
                "/api/admin/auth/check",
                web::get().to(admin_handlers::check_auth),
            )
            .route(
                "/api/admin/settings",
                web::get().to(admin_handlers::get_settings),
            )
            .route(
                "/api/admin/settings",
                web::put().to(admin_handlers::update_settings),
            )
            .route(
                "/api/admin/simc/install",
                web::post().to(admin_handlers::install_simc_version),
            )
            .route(
                "/api/admin/simc/{branch}",
                web::delete().to(admin_handlers::remove_simc_version),
            );
    }
}
