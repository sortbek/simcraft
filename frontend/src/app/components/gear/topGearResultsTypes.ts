import type { ReactNode } from 'react';

export interface ResultItem {
  slot: string;
  item_id: number;
  ilevel: number;
  name: string;
  bonus_ids?: number[];
  enchant_id?: number;
  gem_id?: number;
  is_kept?: boolean;
  encounter?: string;
  origin?: string;
  upgrade_levels?: number;
  type?: 'enchant' | 'gem';
}

export interface TopGearResult {
  name: string;
  items: ResultItem[];
  dps: number;
  talent_build?: string;
  talent_spec?: string;
  delta: number;
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
}

export type GroupMode = 'rank' | 'encounter' | 'slot';
