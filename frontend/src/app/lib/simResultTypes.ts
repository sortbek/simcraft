import type { GearItem } from '../components/gear/gearOverviewTypes';
import type { TopGearResult } from '../components/gear/topGearResultsTypes';
import { GEAR_COMPARISON_SIM_TYPES } from './simTypes';

/** One ability row in the Quick Sim DPS breakdown (parse_simc_result). */
export interface AbilityBreakdown {
  name: string;
  portion_dps: number;
  school: string;
  spell_id?: number;
  icon?: string;
  children?: AbilityBreakdown[];
}

/** Fields injected post-parse (helpers.rs) + Simmit provider metadata.
 *  Present on both result shapes, all optional. */
interface InjectedResultFields {
  /** server= from the input (helpers.rs::inject_realm). */
  realm?: string;
  /** region= from the input. */
  region?: string;
  /** talents= from the input. */
  talent_string?: string;
  /** End-to-end elapsed seconds (helpers.rs::inject_total_elapsed). */
  total_elapsed_seconds?: number;
  /** Simmit provider metadata (non-local jobs only). */
  simmit?: {
    credits_consumed?: number;
    sim_duration_ms?: number;
    build_id?: string;
    build_commit?: string;
  };
}

/** Fields common to both result shapes. */
interface CommonResultFields extends InjectedResultFields {
  player_name: string;
  player_class: string;
  dps_error?: number;
  dps_error_pct?: number;
  fight_length: number;
  desired_targets?: number;
  iterations?: number;
  elapsed_time_seconds?: number;
  target_error?: number;
  simc_version?: string;
  simc_git_revision?: string;
  equipped_gear?: Record<string, GearItem>;
}

/** Quick Sim / Stat Weights result. Has NO `result_kind` (the discriminant). */
export interface QuickSimResult extends CommonResultFields {
  result_kind?: undefined;
  type?: undefined;
  dps: number;
  base_dps?: number;
  abilities?: AbilityBreakdown[];
  stat_weights?: Record<string, number>;
}

/** Top Gear / Drop Finder / Upgrade Compare / Enchant-Gem result. */
export interface GearComparisonResult extends CommonResultFields {
  result_kind: 'gear_comparison';
  /** Wire sim-type string, e.g. "top_gear". */
  type: string;
  base_dps: number;
  max_time?: number;
  results: TopGearResult[];
}

export type SimResult = QuickSimResult | GearComparisonResult;

/**
 * Type guard: narrows a SimResult to GearComparisonResult. Primary discriminant
 * is `result_kind`; the `type`-based check is a legacy fallback for results
 * persisted before `result_kind` started shipping (mirrors the old inline logic
 * in SimResultClient). Returns `r is GearComparisonResult` for typed access.
 */
export function isGearComparisonResult(r: SimResult): r is GearComparisonResult {
  return (
    r.result_kind === 'gear_comparison' ||
    (GEAR_COMPARISON_SIM_TYPES as readonly string[]).includes(r.type ?? '')
  );
}
