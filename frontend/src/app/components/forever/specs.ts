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
  restorationDruid: 'forever.spec.restoration',
  holyPaladin: 'forever.spec.holy',
  dpsPriest: 'forever.spec.dpsPriest',
  healerPriest: 'forever.spec.healerPriest',
  restorationShaman: 'forever.spec.restoration',
};

/** Mirror of the backend's spec::blocked_reason, applied to the spec the user picked. */
export function blockedReason(
  level: number,
  hasSheet: boolean,
  specKey: string | null
): 'levelMin' | 'level' | 'noSpec' | null {
  if (level < 10) return 'levelMin';
  if (level < 60 && !hasSheet) return 'level';
  if (!specKey) return 'noSpec';
  return null;
}

/** Points per talent tree as the game shows them ("0 / 23 / 0"), or null without talents. */
export function talentPointsLabel(pointsPerTree: number[]): string | null {
  return pointsPerTree.length > 0 ? pointsPerTree.join(' / ') : null;
}
