import type { Instance } from '../components/loot/types';
import type { SeasonConfigResponse, DungeonCategory } from './types';

/**
 * Group raw instances into raids + dungeon categories using the season config.
 *
 * - Raids: instances with `type === 'raid'` and a positive id, sorted by `order`.
 * - Dungeon categories: one bucket per `seasonConfig.dungeon_categories`, each filled
 *   with the dungeons in its pool instance. Dungeons not matched to any pool fall back
 *   to the last category. Each bucket is sorted by name.
 *
 * Returns empty arrays when `seasonConfig` is null.
 */
export function groupInstances(
  instances: Instance[],
  seasonConfig: SeasonConfigResponse | null
): { raids: Instance[]; dungeonCats: { cat: DungeonCategory; instances: Instance[] }[] } {
  if (!seasonConfig)
    return {
      raids: [] as Instance[],
      dungeonCats: [] as { cat: DungeonCategory; instances: Instance[] }[],
    };

  const poolMap = new Map<number, Set<number>>();
  for (const cat of seasonConfig.dungeon_categories) {
    const meta = instances.find((i) => i.id === cat.poolInstanceId);
    if (meta) {
      poolMap.set(cat.poolInstanceId, new Set(meta.encounters.map((e) => e.id)));
    }
  }

  const raidList: Instance[] = [];
  const dcList: { cat: DungeonCategory; instances: Instance[] }[] =
    seasonConfig.dungeon_categories.map((cat) => ({ cat, instances: [] }));

  for (const inst of instances) {
    if (inst.type === 'raid' && inst.id > 0) {
      raidList.push(inst);
    } else if (inst.type === 'dungeon') {
      let placed = false;
      for (const dc of dcList) {
        const pool = poolMap.get(dc.cat.poolInstanceId);
        if (pool?.has(inst.id)) {
          dc.instances.push(inst);
          placed = true;
        }
      }
      if (!placed && dcList.length > 0) {
        dcList[dcList.length - 1].instances.push(inst);
      }
    }
  }
  raidList.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const dc of dcList) {
    dc.instances.sort((a, b) => a.name.localeCompare(b.name));
  }
  return { raids: raidList, dungeonCats: dcList };
}
