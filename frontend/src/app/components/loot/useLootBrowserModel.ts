import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { useItemNames } from '../../lib/useItemInfo';
import {
  categoryDetails,
  effectiveDifficultyKeys,
  rankTrackName,
  selectBonusRollTier,
  selectLootCategory,
  selectLootDifficulty,
  type LootCatalog,
  type parseLootCharacter,
} from './lootConfiguration';
import { useDropFinderData } from './useDropFinderData';
import { useLootSelection } from './useLootSelection';
import { dropUid, effectiveUpgradeLevel, getTrackInfo, resolveUpgrade } from './dropUtils';
import { bossKey, poolSources } from './lootSources';
import {
  parseDropFinderPrefs,
  readDropFinderPrefs,
  restoreConfiguration,
  writeDropFinderPrefs,
  type DropFinderPrefs,
} from './dropFinderPrefs';
import { clearPageEdit, peekPageEdit } from '../../lib/share/editShared';
import { isAlreadyOwned, type OwnedItem } from './ownedDrops';
import { compareSlots } from './slotOrder';
import { embellishmentCapReached } from './lootTableModel';
import { buildLootItemRow } from './lootItemRowModel';
import { dropPayload, resolveDropConfiguration } from './dropConfiguration';
import type { DropItemPayload } from './types';
import { DEFAULT_PREFERRED_STATS } from './PreferredStatsSelect';
import { VOID_FORGE_ENABLED } from '../../lib/featureFlags';
/** The browser setup behind a run, so a shared Drop Finder sim reopens as it was. */
export interface DropFinderEditor {
  prefs: DropFinderPrefs;
  selected: string[];
  specs: string[];
  embellishments: Record<number, number>;
}

function sharedEditor(): DropFinderEditor | null {
  const editor = peekPageEdit(['droptimizer'])?.editor as Partial<DropFinderEditor> | undefined;
  const prefs = editor && parseDropFinderPrefs({ ...editor.prefs, v: 1 });
  if (!editor || !prefs) return null;
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const picks: Record<number, number> = {};
  for (const [id, pick] of Object.entries(editor.embellishments ?? {}))
    if (typeof pick === 'number') picks[Number(id)] = pick;
  return {
    prefs,
    selected: strings(editor.selected),
    specs: strings(editor.specs),
    embellishments: picks,
  };
}

export type LootSubmission = {
  drop_items: DropItemPayload[];
  preferred_crafted_stats?: [number, number];
  /** Raise equipped gear to this rank on its own track before comparing. */
  upgrade_equipped_to?: number;
  /** Gem for sockets the equipped item in that slot does not already cover. */
  preferred_gem_id?: number;
  add_vault_socket?: boolean;
  /** Sim every combo at the selected precision instead of pruning to the top few. */
  force_single_pass?: boolean;
  /** Not read by the backend; kept on the stored request for shared sims. */
  editor: DropFinderEditor;
};
export function useLootBrowserModel(
  catalog: LootCatalog,
  character: ReturnType<typeof parseLootCharacter>,
  owned: Map<string, OwnedItem> = new Map()
) {
  const { t, locale } = useLanguage();
  useItemNames(); // Name arrival re-prepares rows before the table filters them.
  const [configuration, setConfiguration] = useState(() => selectLootCategory(catalog, 'mplus'));
  const [activeSpecs, setActiveSpecs] = useState(
    new Set(character.specName ? [character.specName] : [])
  );
  const [includeVoidForge, setIncludeVoidForge] = useState(false);
  const [includeCatalyst, setIncludeCatalyst] = useState(false);
  const [upgradeEquipped, setUpgradeEquipped] = useState(false);
  const [preferredGemId, setPreferredGemId] = useState<number | null>(null);
  const [addVaultSocket, setAddVaultSocket] = useState(false);
  const [forceSinglePass, setForceSinglePass] = useState(true);
  const [preferredStats, setPreferredStats] = useState<[number, number]>(DEFAULT_PREFERRED_STATS);
  const [embellishmentPicks, setEmbellishmentPicks] = useState<Record<number, number>>({});
  // The setup outlives the session it was made in. Reading storage during render
  // would break hydration, so defaults mount first and the saved setup lands in
  // the effect below — which is also what makes pasting a character harmless:
  // the remount that follows re-reads it.
  const [hydrated, setHydrated] = useState(false);
  const details = useMemo(
    () => categoryDetails(catalog, configuration.category),
    [catalog, configuration.category]
  );
  const query = useDropFinderData({
    sources: details.sources,
    className: character.className,
    specs: [...activeSpecs].sort((a, b) =>
      a === character.specName ? -1 : b === character.specName ? 1 : a.localeCompare(b)
    ),
    voidForge: VOID_FORGE_ENABLED && includeVoidForge,
    catalyst: !details.isCrafted && includeCatalyst,
  });
  const drops = query.status === 'success' ? query.data : null;
  // Raids and dungeons index different maps; only Bonus Rolls selects both.
  const { raidDiff, dungeonDiff } = effectiveDifficultyKeys(configuration, details);
  const filtered = Object.entries(drops ?? {}).flatMap(([slot, items]) =>
    items
      .filter(
        (item) =>
          // Bonus Rolls spans two pools, so it has no single instance pool to
          // narrow against; the tier filter below is what bounds it.
          details.isBonusRoll ||
          details.poolOnly ||
          (configuration.pool.size > 0 &&
            (configuration.pool.has(String(item.instance_id)) ||
              item.instance_id === Number(details.source)))
      )
      .filter((item) =>
        // For Bonus Rolls, carrying an entry for a selected tier IS eligibility:
        // it drops the half whose tier is None, raid trash (which cannot be
        // rolled on), and anything the season's ladders do not price.
        details.isBonusRoll
          ? getTrackInfo(item, raidDiff, dungeonDiff) !== null
          : !item.is_void_forge || getTrackInfo(item, raidDiff, dungeonDiff) !== null
      )
      .map((item) => ({ item, slot, uid: dropUid(item) }))
  );
  const availableBySlot: Record<string, string[]> = {};
  for (const entry of filtered) (availableBySlot[entry.slot] ??= []).push(entry.uid);
  // Gear the character has nothing to gain from: still listed, but left out of
  // the run unless it is ticked back on.
  const ownedUids = filtered
    .filter(({ item }) => {
      const track = getTrackInfo(item, raidDiff, dungeonDiff);
      return isAlreadyOwned(
        item,
        track?.track,
        resolveUpgrade(
          item,
          raidDiff,
          dungeonDiff,
          configuration.upgradeLevel,
          catalog.upgradeTracks
        ).ilvl,
        owned
      );
    })
    .map((entry) => entry.uid);
  const ownedSet = new Set(ownedUids);
  // Which boss each row comes from, so a source can be switched off without the
  // selection having to know what a boss is.
  const sourceByUid: Record<string, string> = {};
  for (const entry of filtered) sourceByUid[entry.uid] = bossKey(entry.item);
  const selection = useLootSelection(
    query.datasetId + (query.status === 'success' ? ':ready' : ':pending'),
    availableBySlot,
    ownedUids,
    sourceByUid
  );
  const visible = filtered.filter(
    (entry) =>
      !selection.excludedSlots.has(entry.slot) &&
      !selection.excludedSources.has(sourceByUid[entry.uid])
  );
  const restoreFilters = selection.restoreFilters;
  // A shared sim being edited: its item picks land once its pool has loaded.
  const sharedSelectionRef = useRef<{ category: string; selected: string[] } | null>(null);
  // Read once and taken out of session storage at once, so a later visit (or an
  // effect re-run) never applies the sharer's setup again.
  const sharedRef = useRef<DropFinderEditor | null | undefined>(undefined);
  useEffect(() => {
    if (sharedRef.current === undefined) {
      sharedRef.current = sharedEditor();
      // Only our own stash; another page's may still be waiting for its mount.
      if (sharedRef.current) clearPageEdit();
    }
    const shared = sharedRef.current;
    const saved = shared?.prefs ?? readDropFinderPrefs();
    setHydrated(true);
    if (shared) {
      sharedSelectionRef.current = { category: shared.prefs.category, selected: shared.selected };
      const specs = shared.specs.filter((spec) => character.specs.includes(spec));
      if (specs.length) setActiveSpecs(new Set(specs));
      setEmbellishmentPicks(shared.embellishments);
    }
    if (!saved) return;
    const restored = restoreConfiguration(catalog, saved);
    if (restored) setConfiguration(restored);
    setIncludeVoidForge(saved.includeVoidForge);
    setIncludeCatalyst(saved.includeCatalyst);
    setUpgradeEquipped(saved.upgradeEquipped);
    setAddVaultSocket(saved.addVaultSocket);
    setForceSinglePass(saved.forceSinglePass);
    setPreferredGemId(saved.preferredGemId);
    if (saved.preferredStats) setPreferredStats(saved.preferredStats);
    restoreFilters(saved.excludedSlots, saved.excludedSources);
    // Mount only: a later write must not read itself back in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const availabilityKey = JSON.stringify(availableBySlot);
  useEffect(() => {
    const shared = sharedSelectionRef.current;
    if (!shared || !hydrated || query.status !== 'success') return;
    if (configuration.category !== shared.category) return;
    sharedSelectionRef.current = null;
    const wanted = new Set(shared.selected);
    const all = Object.values(availableBySlot).flat();
    selection.clearItems(all.filter((uid) => !wanted.has(uid)));
    selection.selectItems(all.filter((uid) => wanted.has(uid)));
    // `availabilityKey` stands in for the rebuilt-every-render map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, query.status, configuration.category, availabilityKey]);
  const savedSetup = JSON.stringify({
    category: configuration.category,
    difficulty: configuration.difficulty,
    dungeonDifficulty: configuration.dungeonDifficulty,
    upgradeLevel: configuration.upgradeLevel,
    pool: [...configuration.pool],
    includeVoidForge,
    includeCatalyst,
    upgradeEquipped,
    addVaultSocket,
    forceSinglePass,
    preferredGemId,
    preferredStats,
    excludedSlots: [...selection.excludedSlots],
    excludedSources: [...selection.excludedSources],
  });
  useEffect(() => {
    // Not before the saved setup has been read, or the defaults this mount
    // started with would overwrite it.
    if (!hydrated) return;
    writeDropFinderPrefs(JSON.parse(savedSetup));
  }, [hydrated, savedSetup]);
  // Eligibility is per item (backend `accepts_preferred_stats`), not per category:
  // Rare and PVP profession pools carry flexible-stat gear too, so a raid/crafted
  // whitelist would silently drop the pair for them.
  const usesPreferredStats = filtered.some((entry) => entry.item.accepts_preferred_stats);
  const preferredPair = usesPreferredStats ? preferredStats : undefined;
  const itemConfiguration = {
    difficulty: raidDiff,
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
        owned: ownedSet.has(dropUid(item)),
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
  // The rank the run actually tests its candidates at, which is what the equipped
  // baseline has to be raised to. The control's own value is 0 ("Base") for raids
  // and bonus rolls, and sending that raised nothing at all; each candidate's own
  // drop rank is the floor, and the highest of them is the shared baseline.
  const testedUpgradeRank = Math.max(
    0,
    ...dropItems.map((item) =>
      effectiveUpgradeLevel(
        item,
        raidDiff,
        dungeonDiff,
        configuration.upgradeLevel,
        catalog.upgradeTracks
      )
    )
  );
  const submission: LootSubmission | null = dropItems.length
    ? {
        drop_items: dropItems,
        ...(preferredPair ? { preferred_crafted_stats: preferredPair } : {}),
        ...(upgradeEquipped ? { upgrade_equipped_to: testedUpgradeRank } : {}),
        ...(preferredGemId ? { preferred_gem_id: preferredGemId } : {}),
        ...(addVaultSocket ? { add_vault_socket: true } : {}),
        force_single_pass: forceSinglePass,
        editor: {
          prefs: JSON.parse(savedSetup),
          selected: [...selection.selected],
          specs: [...activeSpecs],
          embellishments: embellishmentPicks,
        },
      }
    : null;
  const trackName = rankTrackName(configuration, details) ?? undefined;
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
    // Only Bonus Rolls draws on more than one instance, so only it offers the
    // filter; every other category is one raid or one dungeon already.
    sources: details.isBonusRoll ? poolSources(filtered.map((entry) => entry.item)) : [],
    currentTrackInfo,
    upgradeLevelOptions,
    preferredStats,
    setPreferredStats,
    includeVoidForge,
    setIncludeVoidForge,
    includeCatalyst,
    setIncludeCatalyst,
    upgradeEquipped,
    setUpgradeEquipped,
    preferredGemId,
    setPreferredGemId,
    addVaultSocket,
    setAddVaultSocket,
    forceSinglePass,
    setForceSinglePass,
    selectCategory: (category: string) => setConfiguration(selectLootCategory(catalog, category)),
    selectDifficulty: (key: string) => {
      const difficulty = details.difficulties.find((diff) => diff.key === key);
      if (difficulty) setConfiguration((previous) => selectLootDifficulty(previous, difficulty));
    },
    selectBonusRollTier: (side: 'raid' | 'dungeon', key: string) =>
      setConfiguration((previous) => selectBonusRollTier(previous, side, key)),
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
