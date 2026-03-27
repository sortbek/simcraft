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
