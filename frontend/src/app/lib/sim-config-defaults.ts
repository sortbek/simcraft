/** Shared-config defaults and normalizers, in lib so `sim-profiles.ts` can fill
 *  missing profile fields without importing from the component tree. */

import { TRIAGE_BATCH_DEFAULT } from './triageBatch';
import type { FightScenario } from './types';

export type RotationMode = 'default' | 'assisted_combat' | 'one_button';

export function normalizeSimcBranch(value: string): string {
  if (value.startsWith('weekly-')) return 'weekly';
  if (value.startsWith('nightly-')) return 'nightly';
  return value;
}

export function parseRotationMode(value: unknown): RotationMode {
  return value === 'assisted_combat' || value === 'one_button' ? value : 'default';
}

export const DEFAULT_RAID_BUFFS: Record<string, boolean> = {
  bloodlust: true,
  arcane_intellect: true,
  power_word_fortitude: true,
  battle_shout: true,
  mystic_touch: true,
  chaos_brand: true,
  skyfury: true,
  mark_of_the_wild: true,
  hunters_mark: true,
  bleeding: true,
};

export const DEFAULT_EXPANSION_OPTIONS: Record<string, boolean> = {
  'midnight.crucible_of_erratic_energies_violence': true,
  'midnight.crucible_of_erratic_energies_sustenance': true,
  'midnight.crucible_of_erratic_energies_predation': true,
};

/** Every field a profile captures, at its default value. Single authority for
 *  both the live config's initial state and profile-blob normalization: the two
 *  must agree on defaults or an untouched config reads as dirty. `SimProfileData`
 *  is derived from this, so a new field is added here once. */
export const DEFAULT_PROFILE_DATA = {
  fightStyle: 'Patchwerk',
  fightLength: 300,
  targetCount: 1,
  scenarios: [] as FightScenario[],
  iterations: 100000,
  targetError: 0.1,
  threads: 0,
  rotationMode: 'default' as RotationMode,
  customApl: '',
  raidBuffs: DEFAULT_RAID_BUFFS,
  consumables: {} as Record<string, string>,
  expansionOptions: DEFAULT_EXPANSION_OPTIONS,
  simcBranch: '',
  simcHeader: '',
  simcBasePlayer: '',
  simcRaidActors: '',
  simcPostCombos: '',
  simcFooter: '',
  parallelProfilesets: true,
  triageMaxBatchProfilesets: TRIAGE_BATCH_DEFAULT,
  statWeights: false,
};
