import type { DropItem, DropItemPayload, TrackInfo, UpgradeTracks } from './types';

export interface IlvlOption {
  ilvl: number;
  bonus_id: number;
  quality: number;
}

/** All achievable item levels for a drop: expand each difficulty/dungeon track
 *  through its upgrade levels, plus any non-track base entry. Deduped by ilvl,
 *  highest first (so the first option is the max ilvl default). */
export function buildItemLevelOptions(item: DropItem, tracks: UpgradeTracks): IlvlOption[] {
  const byIlvl = new Map<number, IlvlOption>();
  const sources: Record<string, TrackInfo>[] = [];
  if (item.difficulty_info) sources.push(item.difficulty_info);
  if (item.dungeon_info) sources.push(item.dungeon_info);

  for (const source of sources) {
    for (const info of Object.values(source)) {
      if (info.track && tracks[info.track]) {
        for (const lvl of tracks[info.track]) {
          if (!byIlvl.has(lvl.ilvl)) {
            byIlvl.set(lvl.ilvl, { ilvl: lvl.ilvl, bonus_id: lvl.bonus_id, quality: lvl.quality });
          }
        }
      } else if (!byIlvl.has(info.ilvl)) {
        byIlvl.set(info.ilvl, { ilvl: info.ilvl, bonus_id: info.bonus_id, quality: info.quality });
      }
    }
  }

  if (byIlvl.size === 0) {
    byIlvl.set(item.ilevel, { ilvl: item.ilevel, bonus_id: 0, quality: item.quality });
  }
  return [...byIlvl.values()].sort((a, b) => b.ilvl - a.ilvl);
}

/** Compose a droptimizer/resolve-drops payload at a chosen ilvl. Matches
 *  DropFinderContent.buildPayload: bonus_ids = [chosen track bonus] + extra. */
export function dropPayloadAtIlvl(item: DropItem, option: IlvlOption): DropItemPayload {
  return {
    ...item,
    ilevel: option.ilvl,
    quality: option.quality,
    bonus_ids: [...(option.bonus_id ? [option.bonus_id] : []), ...(item.extra_bonus_ids ?? [])],
  };
}
