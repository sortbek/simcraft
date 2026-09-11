/** Canonical frontend class/spec names and IDs. */
export const CLASS_SPEC_DATA: Record<string, { name: string; id: number }[]> = {
  warrior: [
    { name: 'arms', id: 71 },
    { name: 'fury', id: 72 },
    { name: 'protection', id: 73 },
  ],
  paladin: [
    { name: 'holy', id: 65 },
    { name: 'protection', id: 66 },
    { name: 'retribution', id: 70 },
  ],
  hunter: [
    { name: 'beast_mastery', id: 253 },
    { name: 'marksmanship', id: 254 },
    { name: 'survival', id: 255 },
  ],
  rogue: [
    { name: 'assassination', id: 259 },
    { name: 'outlaw', id: 260 },
    { name: 'subtlety', id: 261 },
  ],
  priest: [
    { name: 'discipline', id: 256 },
    { name: 'holy', id: 257 },
    { name: 'shadow', id: 258 },
  ],
  death_knight: [
    { name: 'blood', id: 250 },
    { name: 'frost', id: 251 },
    { name: 'unholy', id: 252 },
  ],
  shaman: [
    { name: 'elemental', id: 262 },
    { name: 'enhancement', id: 263 },
    { name: 'restoration', id: 264 },
  ],
  mage: [
    { name: 'arcane', id: 62 },
    { name: 'fire', id: 63 },
    { name: 'frost', id: 64 },
  ],
  warlock: [
    { name: 'affliction', id: 265 },
    { name: 'demonology', id: 266 },
    { name: 'destruction', id: 267 },
  ],
  monk: [
    { name: 'brewmaster', id: 268 },
    { name: 'mistweaver', id: 270 },
    { name: 'windwalker', id: 269 },
  ],
  druid: [
    { name: 'balance', id: 102 },
    { name: 'feral', id: 103 },
    { name: 'guardian', id: 104 },
    { name: 'restoration', id: 105 },
  ],
  demon_hunter: [
    { name: 'havoc', id: 577 },
    { name: 'vengeance', id: 581 },
    { name: 'devourer', id: 1480 },
  ],
  evoker: [
    { name: 'devastation', id: 1467 },
    { name: 'preservation', id: 1468 },
    { name: 'augmentation', id: 1473 },
  ],
};
const aliases: Record<string, string> = {
  deathknight: 'death_knight',
  demonhunter: 'demon_hunter',
};
export const CLASS_SPECS: Record<string, string[]> = Object.fromEntries(
  Object.entries(CLASS_SPEC_DATA).map(([cls, specs]) => [cls, specs.map((spec) => spec.name)])
);
for (const [alias, canonical] of Object.entries(aliases))
  CLASS_SPECS[alias] = CLASS_SPECS[canonical];
export const SPEC_ID_TO_NAME: Record<number, string> = Object.fromEntries(
  Object.values(CLASS_SPEC_DATA)
    .flat()
    .map((spec) => [spec.id, spec.name])
);
/** Legacy lookup for callers without class context; ambiguous names retain their existing mapping. */
export const SPEC_NAME_TO_ID: Record<string, number> = Object.fromEntries(
  Object.entries(SPEC_ID_TO_NAME).map(([id, name]) => [name, Number(id)])
);
