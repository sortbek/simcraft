export interface Instance {
  id: number;
  name: string;
  type: string;
  order?: number;
  encounters: { id: number; name: string }[];
}

export interface TrackInfo {
  ilvl: number;
  bonus_id: number;
  quality: number;
  track?: string;
  level?: number;
  max_level?: number;
}

export interface TrackLevel {
  level: number;
  max_level: number;
  ilvl: number;
  bonus_id: number;
  quality: number;
}

export type UpgradeTracks = Record<string, TrackLevel[]>;

export interface DropItem {
  item_id: number;
  name: string;
  icon: string;
  quality: number;
  ilevel: number;
  encounter: string;
  inventory_type?: number;
  bonus_ids?: number[];
  difficulty_info?: Record<string, TrackInfo>;
  dungeon_info?: Record<string, TrackInfo>;
  specs?: number[];
  off_spec?: boolean;
}

export const QUALITY_COLORS: Record<number, string> = {
  1: 'text-gray-400',
  2: 'text-green-400',
  3: 'text-blue-400',
  4: 'text-purple-400',
  5: 'text-orange-400',
  6: 'text-amber-300',
};

export function getTrackInfo(
  item: DropItem,
  raidDiff: string,
  dungeonDiff: string
): TrackInfo | null {
  return item.dungeon_info?.[dungeonDiff] ?? item.difficulty_info?.[raidDiff] ?? null;
}

export function resolveUpgrade(
  item: DropItem,
  raidDiff: string,
  dungeonDiff: string,
  upgradeLevel: number,
  tracks: UpgradeTracks
): { ilvl: number; bonus_id: number; quality: number } {
  const base = getTrackInfo(item, raidDiff, dungeonDiff);
  if (!base || !base.track || upgradeLevel <= 0) {
    return {
      ilvl: base?.ilvl ?? item.ilevel,
      bonus_id: base?.bonus_id ?? 0,
      quality: base?.quality ?? item.quality,
    };
  }
  const trackLevels = tracks[base.track];
  if (!trackLevels) return { ilvl: base.ilvl, bonus_id: base.bonus_id, quality: base.quality };
  const target = trackLevels.find((t) => t.level === upgradeLevel);
  if (!target) return { ilvl: base.ilvl, bonus_id: base.bonus_id, quality: base.quality };
  return { ilvl: target.ilvl, bonus_id: target.bonus_id, quality: target.quality };
}

export function detectClass(simcInput: string): string | null {
  const m = simcInput.match(
    /^(warrior|paladin|hunter|rogue|priest|death_knight|deathknight|shaman|mage|warlock|monk|demon_hunter|demonhunter|druid|evoker)\s*=/m
  );
  return m ? m[1] : null;
}

export function detectSpec(simcInput: string): string | null {
  const m = simcInput.match(/^spec=(\w+)/m);
  return m ? m[1] : null;
}

const CLASS_SPECS: Record<string, string[]> = {
  warrior: ['arms', 'fury', 'protection'],
  paladin: ['holy', 'protection', 'retribution'],
  hunter: ['beast_mastery', 'marksmanship', 'survival'],
  rogue: ['assassination', 'outlaw', 'subtlety'],
  priest: ['discipline', 'holy', 'shadow'],
  death_knight: ['blood', 'frost', 'unholy'],
  deathknight: ['blood', 'frost', 'unholy'],
  shaman: ['elemental', 'enhancement', 'restoration'],
  mage: ['arcane', 'fire', 'frost'],
  warlock: ['affliction', 'demonology', 'destruction'],
  monk: ['brewmaster', 'mistweaver', 'windwalker'],
  druid: ['balance', 'feral', 'guardian', 'restoration'],
  demon_hunter: ['havoc', 'vengeance'],
  demonhunter: ['havoc', 'vengeance'],
  evoker: ['devastation', 'preservation', 'augmentation'],
};

export function getClassSpecs(className: string): string[] {
  return CLASS_SPECS[className] ?? [];
}

const SPEC_IDS: Record<string, number> = {
  arms: 71,
  fury: 72,
  protection_warrior: 73,
  holy_paladin: 65,
  protection_paladin: 66,
  retribution: 70,
  beast_mastery: 253,
  marksmanship: 254,
  survival: 255,
  assassination: 259,
  outlaw: 260,
  subtlety: 261,
  discipline: 256,
  holy_priest: 257,
  shadow: 258,
  blood: 250,
  frost_dk: 251,
  unholy: 252,
  elemental: 262,
  enhancement: 263,
  restoration_shaman: 264,
  arcane: 62,
  fire: 63,
  frost_mage: 64,
  affliction: 265,
  demonology: 266,
  destruction: 267,
  brewmaster: 268,
  windwalker: 269,
  mistweaver: 270,
  balance: 102,
  feral: 103,
  guardian: 104,
  restoration_druid: 105,
  havoc: 577,
  vengeance: 581,
  devastation: 1467,
  preservation: 1468,
  augmentation: 1473,
};

export function getSpecId(className: string, specName: string): number | null {
  // Handle ambiguous spec names using class context
  const key = (() => {
    switch (specName) {
      case 'protection':
        return className === 'warrior' ? 'protection_warrior' : 'protection_paladin';
      case 'holy':
        return className === 'paladin' ? 'holy_paladin' : 'holy_priest';
      case 'frost':
        return className === 'mage' ? 'frost_mage' : 'frost_dk';
      case 'restoration':
        return className === 'shaman' ? 'restoration_shaman' : 'restoration_druid';
      default:
        return specName;
    }
  })();
  return SPEC_IDS[key] ?? null;
}

export function formatSpecName(spec: string): string {
  return spec.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
