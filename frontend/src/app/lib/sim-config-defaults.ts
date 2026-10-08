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

export const RAID_BUFF_LIST = [
  { key: 'bloodlust', label: 'Bloodlust', icon: 'spell_nature_bloodlust' },
  { key: 'arcane_intellect', label: 'Arcane Intellect', icon: 'spell_holy_magicalsentry' },
  { key: 'power_word_fortitude', label: 'Power Word: Fortitude', icon: 'spell_holy_wordfortitude' },
  { key: 'mark_of_the_wild', label: 'Mark of the Wild', icon: 'spell_nature_regeneration' },
  { key: 'battle_shout', label: 'Battle Shout', icon: 'ability_warrior_battleshout' },
  { key: 'mystic_touch', label: 'Mystic Touch (5% Phys)', icon: 'ability_monk_sparring' },
  { key: 'chaos_brand', label: 'Chaos Brand (3% Magic)', icon: 'ability_demonhunter_empowerwards' },
  { key: 'skyfury', label: 'Skyfury', icon: 'achievement_raidprimalist_windelemental' },
  { key: 'hunters_mark', label: "Hunter's Mark", icon: 'ability_hunter_markedfordeath' },
  { key: 'bleeding', label: 'Bleeding', icon: 'ability_gouge' },
  { key: 'power_infusion', label: 'Power Infusion', icon: 'spell_holy_powerinfusion' },
] as const;

/** Raid-wide effects SimC reports but the config doesn't offer as a toggle. */
export const EXTRA_RAID_BUFFS: Record<string, { label: string; icon: string }> = {
  mortal_wounds: { label: 'Mortal Wounds', icon: 'ability_criticalstrike' },
};

export const CONSUMABLE_LABELS: Record<string, string> = {
  food: 'Food',
  flask: 'Flask',
  potion: 'Potion',
  augmentation: 'Augmentation',
  weapon_rune: 'Weapon Rune',
};

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
  // A single-target external from a Priest, not a raid-wide buff: off unless asked for.
  power_infusion: false,
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
