import type { ReactNode } from 'react';
import type { GearItem } from './gearOverviewTypes';

export interface ResultItem extends GearItem {
  encounter?: string;
  type?: 'enchant' | 'gem';
}

export interface TopGearResult {
  name: string;
  items: ResultItem[];
  dps: number;
  talent_build?: string;
  talent_spec?: string;
  delta: number;
  /** 95% CI half-width as a percent of the mean DPS. Combos pruned at
   * earlier (rougher) stages carry the looser precision of that stage. */
  precision_pct?: number;
}

export interface TopGearResultsProps {
  playerName: string;
  playerClass: string;
  playerRealm?: string;
  playerRegion?: string;
  baseDps: number;
  results: TopGearResult[];
  equippedGear?: Record<string, ResultItem>;
  dpsError?: number;
  dpsErrorPct?: number;
  fightLength?: number;
  desiredTargets?: number;
  iterations?: number;
  targetError?: number;
  elapsedTime?: number;
  backLink?: ReactNode;
  /** Source job id — enables the per-row "Sim" verify button. Omit on
   * historical/imported result views where re-running isn't applicable. */
  sourceJobId?: string;
  /** Whether the source job ran in streamed mode (a precondition for the
   * sim-row endpoint). The button is hidden when this is false. */
  sourceIsStreamed?: boolean;
}

export type GroupMode = 'rank' | 'encounter' | 'slot';
