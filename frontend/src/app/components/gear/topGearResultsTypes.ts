import type { ReactNode } from 'react';
import type { GearItem } from './gearOverviewTypes';
import type { SimSetup } from '../../lib/simResultTypes';

export interface ResultItem extends GearItem {
  encounter?: string;
  /** Raid or dungeon the encounter sits in; absent on older results. */
  instance?: string;
  type?: 'enchant' | 'gem';
  talent_build?: string;
  talent_spec?: string;
  folio_build?: string;
}

export interface TopGearResult {
  name: string;
  items: ResultItem[];
  dps: number;
  talent_build?: string;
  talent_spec?: string;
  /** Omnium Folio combination this combo ran, when the folio varied. */
  folio_build?: string;
  /** Consumable slot -> SimC value this combo used instead of the Sim settings one. */
  consumables?: Record<string, string>;
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
  /** Consumables and raid buffs the base actor ran with, for the hero's corner. */
  setup?: SimSetup;
  /** Source job id — enables the per-row "Sim" verify button. Omit on historical/imported views where re-running isn't applicable. */
  sourceJobId?: string;
}

export type GroupMode = 'rank' | 'encounter' | 'slot';
