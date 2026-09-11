import type { DifficultyDef, SeasonConfigResponse } from '../../lib/types';
import { groupInstances } from '../../lib/instanceCategories';
import type { Instance, UpgradeTracks } from './types';
import { detectClass, detectSpec } from './dropUtils';
import { parseEquippedGear } from '../../lib/inheritedGear';
import { CLASS_SPECS } from '../../lib/classSpecs';

export interface LootCatalog {
  instances: Instance[];
  seasonConfig: SeasonConfigResponse;
  upgradeTracks: UpgradeTracks;
}
export function parseLootCharacter(input: string) {
  const className = detectClass(input);
  const specName = detectSpec(input);
  return {
    className,
    specName,
    identity: [className, specName].join(':'),
    specs: CLASS_SPECS[className ?? ''] ?? [],
    equippedGear: parseEquippedGear(input),
  };
}
/** Categories whose pools contain gear with placeholder secondaries: raids, and
 *  every profession pool (Epic `crafted`, plus `rare-profession` /
 *  `pvp-profession`). Used where per-item eligibility isn't available. */
export function categoryMayUsePreferredStats(category: string): boolean {
  return category === 'raids' || category === 'crafted' || category.endsWith('-profession');
}

export function categoryDetails(catalog: LootCatalog, category: string) {
  const { raids, dungeonCats } = groupInstances(catalog.instances, catalog.seasonConfig);
  const dungeon = dungeonCats.find((group) => group.cat.key === category);
  const isRaid = category === 'raids';
  const isCrafted = category === 'crafted';
  const difficulties = isRaid
    ? catalog.seasonConfig.raid_difficulties
    : (dungeon?.cat.difficultyGroups?.flatMap((group) => group.difficulties) ??
      dungeon?.cat.difficulties ??
      []);
  const instances = isRaid ? raids : (dungeon?.instances ?? []);
  return {
    raids,
    dungeonCats,
    isRaid,
    isCrafted,
    instances,
    difficulties,
    difficultyGroups: dungeon?.cat.difficultyGroups ?? null,
    source: isRaid ? 'type:raid' : dungeon ? String(dungeon.cat.poolInstanceId) : '',
    defaultDifficulty: isRaid
      ? (difficulties.find((d) => d.key === 'heroic')?.key ?? difficulties[0]?.key ?? '')
      : (dungeon?.cat.defaultDifficulty ?? ''),
    poolOnly: !isRaid && instances.length === 0,
  };
}
export interface LootConfiguration {
  category: string;
  difficulty: string;
  upgradeLevel: number;
  pool: Set<string>;
}
export function selectLootCategory(catalog: LootCatalog, category: string): LootConfiguration {
  const details = categoryDetails(catalog, category);
  return {
    category,
    difficulty: details.defaultDifficulty,
    upgradeLevel: details.isRaid
      ? 0
      : (details.difficulties.find((d) => d.key === details.defaultDifficulty)?.level ?? 0),
    pool: new Set(details.instances.map((instance) => String(instance.id))),
  };
}
export function selectLootDifficulty(
  state: LootConfiguration,
  difficulty: DifficultyDef
): LootConfiguration {
  return {
    ...state,
    difficulty: difficulty.key,
    upgradeLevel: state.category === 'raids' ? 0 : (difficulty.level ?? 0),
  };
}
