import { useMemo, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { useItemNames } from '../../lib/useItemInfo';
import {
  categoryDetails,
  selectLootCategory,
  selectLootDifficulty,
  type LootCatalog,
  type parseLootCharacter,
} from './lootConfiguration';
import { useDropFinderData } from './useDropFinderData';
import { useLootSelection } from './useLootSelection';
import { dropUid, getTrackInfo } from './dropUtils';
import { compareSlots } from './slotOrder';
import { embellishmentCapReached } from './lootTableModel';
import { buildLootItemRow } from './lootItemRowModel';
import { dropPayload, resolveDropConfiguration } from './dropConfiguration';
import type { DropItemPayload } from './types';
import { DEFAULT_PREFERRED_STATS } from './PreferredStatsSelect';
import { VOID_FORGE_ENABLED } from '../../lib/featureFlags';
export type LootSubmission = {
  drop_items: DropItemPayload[];
  preferred_crafted_stats?: [number, number];
};
export function useLootBrowserModel(
  catalog: LootCatalog,
  character: ReturnType<typeof parseLootCharacter>
) {
  const { t, locale } = useLanguage();
  useItemNames(); // Name arrival re-prepares rows before the table filters them.
  const [configuration, setConfiguration] = useState(() => selectLootCategory(catalog, 'mplus'));
  const [activeSpecs, setActiveSpecs] = useState(
    new Set(character.specName ? [character.specName] : [])
  );
  const [includeVoidForge, setIncludeVoidForge] = useState(false);
  const [includeCatalyst, setIncludeCatalyst] = useState(false);
  const [preferredStats, setPreferredStats] = useState<[number, number]>(DEFAULT_PREFERRED_STATS);
  const [embellishmentPicks, setEmbellishmentPicks] = useState<Record<number, number>>({});
  const details = useMemo(
    () => categoryDetails(catalog, configuration.category),
    [catalog, configuration.category]
  );
  const query = useDropFinderData({
    source: details.source,
    className: character.className,
    specs: [...activeSpecs].sort((a, b) =>
      a === character.specName ? -1 : b === character.specName ? 1 : a.localeCompare(b)
    ),
    voidForge: VOID_FORGE_ENABLED && includeVoidForge,
    catalyst: !details.isCrafted && includeCatalyst,
  });
  const drops = query.status === 'success' ? query.data : null;
  // Raids and dungeons index different maps. Passing the raid key as the dungeon
  // key too lets `dungeon_info` shadow `difficulty_info` whenever the two share a
  // name — a raid Mythic selection then resolves on the Mythic-dungeon (M0) track.
  const dungeonDiff = details.isRaid ? '' : configuration.difficulty;
  const filtered = Object.entries(drops ?? {}).flatMap(([slot, items]) =>
    items
      .filter(
        (item) =>
          details.poolOnly ||
          (configuration.pool.size > 0 &&
            (configuration.pool.has(String(item.instance_id)) ||
              item.instance_id === Number(details.source)))
      )
      .filter(
        (item) =>
          !item.is_void_forge || getTrackInfo(item, configuration.difficulty, dungeonDiff) !== null
      )
      .map((item) => ({ item, slot, uid: dropUid(item) }))
  );
  const availableBySlot: Record<string, string[]> = {};
  for (const entry of filtered) (availableBySlot[entry.slot] ??= []).push(entry.uid);
  const selection = useLootSelection(
    query.datasetId + (query.status === 'success' ? ':ready' : ':pending'),
    availableBySlot
  );
  const visible = filtered.filter((entry) => !selection.excludedSlots.has(entry.slot));
  // Eligibility is per item (backend `accepts_preferred_stats`), not per category:
  // Rare and PVP profession pools carry flexible-stat gear too, so a raid/crafted
  // whitelist would silently drop the pair for them.
  const usesPreferredStats = filtered.some((entry) => entry.item.accepts_preferred_stats);
  const preferredPair = usesPreferredStats ? preferredStats : undefined;
  const itemConfiguration = {
    difficulty: configuration.difficulty,
    dungeonDiff,
    upgradeLevel: configuration.upgradeLevel,
    upgradeTracks: catalog.upgradeTracks,
    preferredStats: preferredPair,
  };
  // The 2-piece cap counts what the player wears PLUS what this run already
  // selects — an equipped-only count misses "wear 1, select 2" entirely.
  const equippedEmbellished = Object.values(character.equippedGear).filter(
    (gear) => gear.embellished
  ).length;
  const selectedEmbellished = visible.filter(
    ({ item, uid }) =>
      selection.selected.has(uid) &&
      (item.embellished === true || embellishmentPicks[item.item_id] !== undefined)
  ).length;
  const embellishmentLimitReached = embellishmentCapReached(
    equippedEmbellished,
    selectedEmbellished
  );
  const embellishmentOptions = details.isCrafted
    ? catalog.seasonConfig.crafted_embellishments
    : undefined;
  const prepared = visible.map((entry) => ({
    ...entry,
    configuration: resolveDropConfiguration(entry.item, itemConfiguration),
  }));
  const table = {
    headerLabel: details.isRaid
      ? t('loot.allRaids')
      : (catalog.instances.find((instance) => String(instance.id) === details.source)?.name ??
        t('loot.allDungeons')),
    hasEmbellishmentColumn: embellishmentOptions !== undefined,
    embellishmentLimitReached,
    rows: prepared.map(({ item, slot, configuration }) =>
      buildLootItemRow(item, slot, {
        configuration,
        equippedGear: character.equippedGear,
        spec: character.specName ?? '',
        locale,
        selected: selection.selected,
        embellishmentOptions,
        embellishmentPicks,
      })
    ),
  };
  const dropItems = prepared
    .filter((entry) => selection.selected.has(entry.uid))
    .map(({ item, configuration }) => {
      const candidate = {
        ...item,
        ...(details.isCrafted && embellishmentPicks[item.item_id] !== undefined
          ? { embellishment_id: embellishmentPicks[item.item_id] }
          : {}),
      };
      return dropPayload(candidate, configuration);
    });
  const submission: LootSubmission | null = dropItems.length
    ? {
        drop_items: dropItems,
        ...(preferredPair ? { preferred_crafted_stats: preferredPair } : {}),
      }
    : null;
  const trackName = details.difficulties.find(
    (diff) => diff.key === configuration.difficulty
  )?.track;
  const trackLevels = trackName ? catalog.upgradeTracks[trackName] : undefined;
  const currentTrackInfo =
    !details.isCrafted && trackLevels ? { name: trackName!, levels: trackLevels } : null;
  const upgradeLevelOptions = currentTrackInfo
    ? [
        { key: 0, label: t('dropFinder.base') },
        ...currentTrackInfo.levels.map((level) => ({
          key: level.level,
          label: currentTrackInfo.name + ' ' + level.level + '/' + level.max_level,
          sublabel: String(level.ilvl),
        })),
      ]
    : [];
  function toggleSpec(spec: string) {
    if (!character.specs.includes(spec)) return;
    setActiveSpecs((previous) => {
      const next = new Set(previous);
      if (next.has(spec)) {
        if (next.size > 1) next.delete(spec);
      } else next.add(spec);
      return next;
    });
  }
  return {
    configuration,
    details,
    usesPreferredStats,
    query,
    drops,
    selection,
    table,
    submission,
    activeSpecs,
    toggleSpec,
    availableSlots: Object.keys(availableBySlot).sort(compareSlots),
    currentTrackInfo,
    upgradeLevelOptions,
    preferredStats,
    setPreferredStats,
    includeVoidForge,
    setIncludeVoidForge,
    includeCatalyst,
    setIncludeCatalyst,
    selectCategory: (category: string) => setConfiguration(selectLootCategory(catalog, category)),
    selectDifficulty: (key: string) => {
      const difficulty = details.difficulties.find((diff) => diff.key === key);
      if (difficulty) setConfiguration((previous) => selectLootDifficulty(previous, difficulty));
    },
    selectUpgrade: (level: number) => {
      if (upgradeLevelOptions.some((option) => option.key === level))
        setConfiguration((previous) => ({ ...previous, upgradeLevel: level }));
    },
    selectPool: (pool: Set<string>) => setConfiguration((previous) => ({ ...previous, pool })),
    changeEmbellishment: (itemId: number, id: number | null) =>
      setEmbellishmentPicks((previous) => {
        const next = { ...previous };
        if (id === null) delete next[itemId];
        else next[itemId] = id;
        return next;
      }),
  };
}
