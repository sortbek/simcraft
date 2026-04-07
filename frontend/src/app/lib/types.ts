// Shared types matching backend API response shapes.
// These are display-only — no behavior, no business logic.

export type ItemOrigin = 'equipped' | 'bags' | 'vault';

export interface ResolvedItem {
  uid: string;
  slot: string;
  item_id: number;
  ilevel: number;
  simc_string: string;
  origin: ItemOrigin;
  bonus_ids: number[];
  enchant_id: number;
  gem_id: number;
  name: string;
  icon: string;
  quality: number;
  quality_color: string;
  tag: string;
  upgrade: string;
  sockets: number;
  enchant_name: string;
  enchant_item_id?: number;
  gem_name: string;
  gem_icon: string;
  is_catalyst?: boolean;
  can_catalyst?: boolean;
}

export interface SlotResolution {
  equipped: ResolvedItem | null;
  alternatives: ResolvedItem[];
}

export interface CharacterResolveInfo {
  class_name: string | null;
  spec: string | null;
  can_dual_wield: boolean;
}

export interface TalentLoadout {
  name: string;
  talent_string: string;
  is_active: boolean;
}

export interface ResolveGearResponse {
  character: CharacterResolveInfo;
  base_profile: string;
  slots: Record<string, SlotResolution>;
  excluded: { uid: string; item_id: number; name: string; reason: string }[];
  talent_loadouts: TalentLoadout[];
  catalyst_charges?: number;
}

// Fight scenario for multi-sim
export interface FightScenario {
  id: string;
  fightStyle: string;
  targetCount: number;
  fightLength: number;
}

// Season config types

export interface DifficultyDef {
  key: string;
  label: string;
  track: string | null;
  level: number;
  sortOrder: number;
  fixedIlvl?: number;
  fixedQuality?: number;
}

export interface DungeonCategory {
  key: string;
  label: string;
  poolInstanceId: number;
  defaultDifficulty: string;
  difficulties: DifficultyDef[];
}

export interface SeasonConfigResponse {
  season: string;
  raid_difficulties: DifficultyDef[];
  dungeon_categories: DungeonCategory[];
}

// Gear slots constant (matches backend)
export const GEAR_SLOTS = [
  'head',
  'neck',
  'shoulder',
  'back',
  'chest',
  'wrist',
  'hands',
  'waist',
  'legs',
  'feet',
  'finger1',
  'finger2',
  'trinket1',
  'trinket2',
  'main_hand',
  'off_hand',
] as const;

export type GearSlot = (typeof GEAR_SLOTS)[number];

// ---- Talent Parsing (used by TalentPicker) ----

export interface TalentLoadoutParsed {
  name: string;
  talentString: string;
  isActive: boolean;
}

const TALENT_SLOT_RE = new RegExp(
  `^(${['head', 'neck', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet', 'finger1', 'finger2', 'trinket1', 'trinket2', 'main_hand', 'off_hand'].join('|')})=`,
  'i'
);
const TALENT_HEADER_RE = /^#+\s*(.+?)\s*\((\d+)\)\s*$/;

export function parseTalentLoadouts(simcInput: string): TalentLoadoutParsed[] {
  const loadouts: TalentLoadoutParsed[] = [];
  let pendingLabel = '';
  for (const rawLine of simcInput.split('\n')) {
    const stripped = rawLine.trim();
    if (stripped.startsWith('#')) {
      const clean = stripped.replace(/^#+\s*/, '');
      const talentMatch = clean.match(/^talents=(.+)/);
      if (talentMatch) {
        loadouts.push({
          name: pendingLabel || `Loadout ${loadouts.length + 1}`,
          talentString: talentMatch[1],
          isActive: false,
        });
        pendingLabel = '';
      } else if (
        !TALENT_SLOT_RE.test(clean) &&
        !TALENT_HEADER_RE.test(stripped) &&
        clean.length > 0 &&
        clean.length < 60 &&
        !clean.startsWith('gear_')
      ) {
        pendingLabel = clean;
      }
    } else {
      const talentMatch = stripped.match(/^talents=(.+)/);
      if (talentMatch) {
        loadouts.unshift({
          name: pendingLabel || 'Active',
          talentString: talentMatch[1],
          isActive: true,
        });
        pendingLabel = '';
      } else {
        pendingLabel = '';
      }
    }
  }
  return loadouts;
}

// ---- Slot Labels ----

export const SLOT_LABELS: Record<string, string> = {
  head: 'Head',
  neck: 'Neck',
  shoulder: 'Shoulder',
  back: 'Back',
  chest: 'Chest',
  wrist: 'Wrist',
  hands: 'Hands',
  waist: 'Waist',
  legs: 'Legs',
  feet: 'Feet',
  finger1: 'Ring 1',
  finger2: 'Ring 2',
  trinket1: 'Trinket 1',
  trinket2: 'Trinket 2',
  main_hand: 'Main Hand',
  off_hand: 'Off Hand',
};

// ---- Class / Spec Data ----

/** All specs for each class (SimC names). Matches backend CLASSES array. */
export const CLASS_SPECS: Record<string, string[]> = {
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

/** Spec ID → SimC spec name mapping. */
export const SPEC_ID_TO_NAME: Record<number, string> = {
  71: 'arms',
  72: 'fury',
  73: 'protection',
  65: 'holy',
  66: 'protection',
  70: 'retribution',
  253: 'beast_mastery',
  254: 'marksmanship',
  255: 'survival',
  259: 'assassination',
  260: 'outlaw',
  261: 'subtlety',
  256: 'discipline',
  257: 'holy',
  258: 'shadow',
  250: 'blood',
  251: 'frost',
  252: 'unholy',
  262: 'elemental',
  263: 'enhancement',
  264: 'restoration',
  62: 'arcane',
  63: 'fire',
  64: 'frost',
  265: 'affliction',
  266: 'demonology',
  267: 'destruction',
  268: 'brewmaster',
  270: 'mistweaver',
  269: 'windwalker',
  102: 'balance',
  103: 'feral',
  104: 'guardian',
  105: 'restoration',
  577: 'havoc',
  581: 'vengeance',
  1467: 'devastation',
  1468: 'preservation',
  1473: 'augmentation',
};

/** Reverse mapping: spec name → spec ID */
export const SPEC_NAME_TO_ID: Record<string, number> = Object.fromEntries(
  Object.entries(SPEC_ID_TO_NAME).map(([id, name]) => [name, Number(id)])
);

/** Pretty-print a spec name: beast_mastery → Beast Mastery */
export function specDisplayName(spec: string): string {
  return spec
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Official WoW class colors. */
export const CLASS_COLORS: Record<string, string> = {
  warrior: '#C79C6E',
  paladin: '#F58CBA',
  hunter: '#ABD473',
  rogue: '#FFF569',
  priest: '#FFFFFF',
  death_knight: '#C41F3B',
  deathknight: '#C41F3B',
  shaman: '#0070DE',
  mage: '#69CCF0',
  warlock: '#9482C9',
  monk: '#00FF96',
  druid: '#FF7D0A',
  demon_hunter: '#A330C9',
  demonhunter: '#A330C9',
  evoker: '#33937F',
};

/** Look up the WoW class color for a spec name (e.g. "beast_mastery" → "#ABD473"). */
export function classColorForSpec(specName: string): string | undefined {
  for (const [cls, specs] of Object.entries(CLASS_SPECS)) {
    if (specs.includes(specName)) return CLASS_COLORS[cls];
  }
  return undefined;
}
