import type { SimProfileData } from './sim-profiles';

/** JSON with object keys sorted recursively, so semantically equal configs
 *  compare equal regardless of key insertion order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export type ProfileSection = 'fight' | 'buffs' | 'advanced';

/** Which part of the Sim settings block each profile field is edited in.
 *  `statWeights` (a Quick Sim footer toggle) and `threads` (set on the
 *  Settings page) are edited elsewhere, so they belong to no section. */
export const PROFILE_SECTION_FIELDS: Record<ProfileSection, readonly (keyof SimProfileData)[]> = {
  fight: ['fightStyle', 'fightLength', 'targetCount', 'scenarios', 'rotationMode'],
  buffs: ['raidBuffs', 'consumables', 'expansionOptions'],
  advanced: [
    'iterations',
    'targetError',
    'customApl',
    'simcBranch',
    'simcHeader',
    'simcBasePlayer',
    'simcRaidActors',
    'simcPostCombos',
    'simcFooter',
    'parallelProfilesets',
    'triageMaxBatchProfilesets',
  ],
};

/** Sections whose fields differ between the saved profile and the live config. */
export function dirtyProfileSections(
  saved: SimProfileData,
  live: SimProfileData
): ProfileSection[] {
  return (Object.keys(PROFILE_SECTION_FIELDS) as ProfileSection[]).filter((section) =>
    PROFILE_SECTION_FIELDS[section].some(
      (field) => stableStringify(saved[field]) !== stableStringify(live[field])
    )
  );
}
