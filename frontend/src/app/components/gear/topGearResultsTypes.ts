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
  /** 95% CI half-width as % of mean DPS; combos pruned at rougher stages carry that stage's looser precision. */
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
  fightLength?: number;
  desiredTargets?: number;
  iterations?: number;
  targetError?: number;
  elapsedTime?: number;
  backLink?: ReactNode;
  /** Source job id — enables the per-row "Sim" verify button. Omit on historical/imported views where re-running isn't applicable. */
  sourceJobId?: string;
}

export type GroupMode = 'rank' | 'encounter' | 'slot';
