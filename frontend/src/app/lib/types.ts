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
  gem_name: string;
  gem_icon: string;
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
