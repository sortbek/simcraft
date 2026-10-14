/** i18n keys for the engine's spec keys. */
export const SPEC_LABEL_KEYS: Record<string, string> = {
  balanceDruid: 'forever.spec.balance',
  feralCatDruid: 'forever.spec.feralCat',
  feralBearDruid: 'forever.spec.feralBear',
  retributionPaladin: 'forever.spec.retribution',
  protectionPaladin: 'forever.spec.protectionPaladin',
  elementalShaman: 'forever.spec.elemental',
  enhancementShaman: 'forever.spec.enhancement',
  dpsWarrior: 'forever.spec.dpsWarrior',
  protectionWarrior: 'forever.spec.protectionWarrior',
};

const HEALERS = new Set(['holyPaladin', 'healerPriest', 'restorationDruid', 'restorationShaman']);

/** Mirror of the backend's spec::blocked_reason, applied to the spec the user picked. */
export function blockedReason(level: number, specKey: string | null): 'level' | 'healer' | null {
  if (level < 60) return 'level';
  if (!specKey || HEALERS.has(specKey)) return 'healer';
  return null;
}

/** Points per talent tree as the game shows them ("0 / 23 / 0"), or null without talents. */
export function talentPointsLabel(pointsPerTree: number[]): string | null {
  return pointsPerTree.length > 0 ? pointsPerTree.join(' / ') : null;
}
