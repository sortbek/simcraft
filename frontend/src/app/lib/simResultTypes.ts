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

/** A Forever ability with what the engine counted for it. */
export interface ForeverAbilityDetail {
  name: string;
  /** The pet whose ability it is; empty for the player's own. */
  owner: string;
  spell_id?: number | null;
  icon?: string | null;
  dps: number;
  /** Casts a fight. */
  casts: number;
  per_cast: number;
  crit_pct: number;
  miss_pct: number;
}

export interface ForeverUptime {
  name: string;
  spell_id?: number | null;
  icon?: string | null;
  uptime_pct: number;
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

/** A consumable SimC ran with; name/icon present when it's in the app's lists. */
export interface SetupConsumable {
  value: string;
  name?: string;
  icon?: string;
  item_id?: number;
  quality?: number;
}

/** What SimC actually ran with (its defaults resolved). Absent on old shares. */
export interface SimSetup {
  consumables: Record<string, SetupConsumable | null>;
  raid_buffs: Record<string, boolean>;
  fight_style?: string | null;
  desired_targets?: number | null;
  max_time?: number | null;
}

/** Fields common to both result shapes. */
interface CommonResultFields extends InjectedResultFields {
  player_name: string;
  player_class: string;
  /** "hps" when the numbers are healing per second (Forever healers). */
  metric?: string;
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
  /** `null` once a backfill found nothing to read. */
  setup?: SimSetup | null;
}

/** Quick Sim / Stat Weights result. Has NO `result_kind` (the discriminant). */
export interface QuickSimResult extends CommonResultFields {
  result_kind?: undefined;
  type?: undefined;
  dps: number;
  base_dps?: number;
  abilities?: AbilityBreakdown[];
  stat_weights?: Record<string, number>;
  /** Forever only: what its engine reports beyond the breakdown. */
  dps_min?: number;
  dps_max?: number;
  dps_stdev?: number;
  /** [bucket, fights], lowest bucket first. */
  dps_hist?: [number, number][];
  ability_details?: ForeverAbilityDetail[];
  buffs?: ForeverUptime[];
  debuffs?: ForeverUptime[];
  oom_seconds?: number;
  sim_settings?: {
    level: number;
    target_level: number;
    talents_string: string;
    /** Chosen toggle ids; null ran the build's own set. */
    buffs: string[] | null;
    consumables: boolean | null;
  } | null;
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

/** Type guard narrowing to GearComparisonResult. Discriminant is `result_kind`; the
 *  `type`-based check is a legacy fallback for results persisted before `result_kind` shipped. */
export function isGearComparisonResult(r: SimResult): r is GearComparisonResult {
  return (
    r.result_kind === 'gear_comparison' ||
    (GEAR_COMPARISON_SIM_TYPES as readonly string[]).includes(r.type ?? '')
  );
}
