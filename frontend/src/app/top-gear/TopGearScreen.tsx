'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import TopGearItemSelector from '../components/gear/TopGearItemSelector';
import AddItemSearch from '../components/gear/AddItemSearch';
import EnchantSelector from '../components/gear/EnchantSelector';
import GemSelector from '../components/gear/GemSelector';
import TopGearToolbar, { type TopGearSection } from '../components/gear/TopGearToolbar';
import { GEAR_ROW_DENSITIES, type GearRowDensity } from '../components/gear/gearDensity';
import TopGearQuickSelectBar from '../components/gear/TopGearQuickSelectBar';
import { ENCHANT_SLOTS } from '../components/gear/itemOptions';
import ConfigFooter from '../components/sim-config/ConfigPanel';
import SimSettingsBlock from '../components/sim-config/SimSettingsBlock';
import SetupCell, { SetupToggle } from '../components/ui/SetupCell';
import CatalystChargesPicker from '../components/gear/CatalystChargesPicker';
import { useContentScale } from '../components/layout/ContentScaler';
import TalentPicker from '../components/talents/TalentPicker';
import ErrorAlert from '../components/ui/ErrorAlert';
import PageHeader from '../components/ui/PageHeader';
import Pill from '../components/ui/Pill';
import SimcDownloadBanner from '../components/ui/SimcDownloadBanner';
import { useSimContext } from '../components/sim-config/SimContext';
import { postJson } from '../lib/api';
import { useSimSubmit } from '../lib/useSimSubmit';
import { useSharedSimPayload } from '../lib/useSharedSimPayload';
import { useComboCount } from '../lib/useComboCount';
import { useCloudEstimate } from '../lib/useCloudEstimate';
import type { ResolveGearResponse, ResolvedItem } from '../lib/types';
import { useLanguage } from '../lib/i18n';
import { VOID_FORGE_ENABLED } from '../lib/featureFlags';
import { clearTopGearState, getTopGearState, storeTopGearState } from '../lib/topgear-state';
import { readStoredJson } from '../lib/storage';
import {
  appendLocalItems,
  buildSelectedUidsJson,
  serializeSelectionMap,
  toLocalItem,
} from './topGearPayload';
import type { TopGearLocalItem } from './topGearTypes';
import { useComputeChoice } from '../lib/useComputeChoice';
import { buildAlternativeKey } from '../components/gear/topGearIdentity';
import OmniumFolioPicker from '../components/omnium/OmniumFolioPicker';
import ConsumableAlternatives from '../components/gear/ConsumableAlternatives';
import { effectiveConsumableOptions, type ConsumableOptions } from '../lib/consumableOptions';
import { useConsumableDefaults } from '../lib/useConsumableDefaults';
import {
  extraSelectedCount,
  folioCombos,
  parseOmniumEntryIds,
  seedSelection,
} from '../components/omnium/omniumSelection';
import { useOmniumTree } from '../lib/useOmniumTree';
import {
  buildVisibleGroups,
  collectQuickSelectEntries,
  mergeAlternative,
  pickEquippedReplacements,
  selectAlternative,
  toggleQuickSelectGroup,
} from '../components/gear/topGearSelection';

// A local run works through every combo on this machine, so a six-figure
// count is hours of work. Warn past this line, never block.
const LARGE_LOCAL_SIM_THRESHOLD = 20_000;

type SectionKey = 'items' | 'enchants' | 'gems' | 'folio' | 'consumables';

const TAB_STORAGE_KEY = 'simhammer_topgear_tab';
const SECTION_KEYS: SectionKey[] = ['items', 'enchants', 'gems', 'folio', 'consumables'];
// The Add item panel's open state, kept from when it was a collapsible card.
const ADD_ITEM_OPEN_KEY = 'simhammer_topgear_additem_open';

const DENSITY_STORAGE_KEY = 'simhammer_topgear_density';

export default function TopGearScreen() {
  const {
    simcInput,
    talentBuilds,
    folioSelections,
    setFolioSelections,
    fightStyle,
    targetCount,
    fightLength,
    unsimmableSpec,
    consumables,
  } = useSimContext();
  const omniumTree = useOmniumTree();
  // The folio the character was exported with: the picker's starting point, the
  // baseline the count badge measures against, and what Clear restores.
  const folioSeed = useMemo(
    () => (omniumTree ? seedSelection(omniumTree, parseOmniumEntryIds(simcInput)) : {}),
    [omniumTree, simcInput]
  );
  const sharedSimPayload = useSharedSimPayload();
  const { t, locale } = useLanguage();
  const [compute, setCompute] = useComputeChoice('top_gear');
  const [resolved, setResolved] = useState<ResolveGearResponse | null>(null);
  const [selectedUids, setSelectedUids] = useState<Record<string, Set<string>>>({});
  const [excludedEquipped, setExcludedEquipped] = useState<Set<string>>(new Set());
  const [localItems, setLocalItems] = useState<TopGearLocalItem[]>([]);
  const [addedLootItems, setAddedLootItems] = useState<ResolvedItem[]>([]);
  const [maxUpgrade, setMaxUpgrade] = useState(false);
  const [copyEnchants, setCopyEnchants] = useState(true);
  const [catalyst, setCatalyst] = useState(false);
  const [catalystCharges, setCatalystCharges] = useState<number | null>(null);
  const [voidForge, _setVoidForge] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [enchantSelections, setEnchantSelections] = useState<Record<string, Set<number>>>({});
  const [gemSelections, setGemSelections] = useState<Set<number>>(new Set());
  const [replaceGems, setReplaceGems] = useState(false);
  const [diamondAlwaysUse, setDiamondAlwaysUse] = useState(false);
  const [maxColors, setMaxColors] = useState(false);
  const [consumableOptions, setConsumableOptions] = useState<ConsumableOptions>({});
  const [density, setDensity] = useState<GearRowDensity>('compact');
  const [activeSection, setActiveSection] = useState<SectionKey>('items');
  const [addItemOpen, setAddItemOpen] = useState(false);
  // Marks where the sticky toolbar sits in the flow. Switching tabs while
  // scrolled past it lands the new tab at its top, instead of letting the
  // browser clamp the scroll when the tab is shorter (which jolts the page).
  const toolbarAnchorRef = useRef<HTMLDivElement>(null);
  const { scale: contentScale } = useContentScale();
  const tabScrollPendingRef = useRef(false);
  const [promotedGroups, setPromotedGroups] = useState<Set<string>>(new Set());
  // Reported by the selectors once their fetches land: the structural gates
  // below only know the character has enchantable slots / sockets, not whether
  // the game data actually offers anything for them.
  const [enchantsEmpty, setEnchantsEmpty] = useState(false);
  const [gemsEmpty, setGemsEmpty] = useState(false);
  const prevInputRef = useRef('');
  const prevUpgradeRef = useRef(false);
  const prevCatalystRef = useRef(false);
  const prevVoidForgeRef = useRef(false);
  const restoringRef = useRef(false);
  const localItemsRef = useRef(localItems);
  localItemsRef.current = localItems;
  // The untouched resolve response. Reset restores it, which is what undoes the
  // mergeAlternative calls behind added items, upgraded copies and conversions.
  const baseResolvedRef = useRef<ResolveGearResponse | null>(null);

  useEffect(() => {
    const saved = getTopGearState();
    if (!saved) return;

    clearTopGearState();
    restoringRef.current = true;
    setMaxUpgrade(saved.maxUpgrade);
    setCopyEnchants(saved.copyEnchants);
    setCatalyst(saved.catalyst);
    setCatalystCharges(saved.catalystCharges);
    setReplaceGems(saved.replaceGems);
    setDiamondAlwaysUse(saved.diamondAlwaysUse);
    setMaxColors(saved.maxColors);
    setLocalItems(saved.localItems);

    const restoredUids: Record<string, Set<string>> = {};
    for (const [slot, values] of Object.entries(saved.selectedUids)) {
      restoredUids[slot] = new Set(values);
    }
    setSelectedUids(restoredUids);
    setExcludedEquipped(new Set(saved.excludedEquipped ?? []));

    const restoredEnchants: Record<string, Set<number>> = {};
    for (const [slot, values] of Object.entries(saved.enchantSelections)) {
      restoredEnchants[slot] = new Set(values);
    }
    setEnchantSelections(restoredEnchants);
    setGemSelections(new Set(saved.gemSelections));
    setAddedLootItems(saved.addedLootItems ?? []);
    setPromotedGroups(new Set(saved.promotedGroups ?? []));
    setConsumableOptions(saved.consumableOptions ?? {});
  }, []);

  // Restore view preferences after mount (avoids an SSR hydration mismatch).
  useEffect(() => {
    // Validated rather than trusted: an unknown stored value would otherwise
    // index the metric maps with undefined and blank every row class.
    const storedDensity = readStoredJson<GearRowDensity>(DENSITY_STORAGE_KEY, 'compact');
    setDensity(GEAR_ROW_DENSITIES.includes(storedDensity) ? storedDensity : 'compact');
    const storedTab = readStoredJson<SectionKey>(TAB_STORAGE_KEY, 'items');
    setActiveSection(SECTION_KEYS.includes(storedTab) ? storedTab : 'items');
    setAddItemOpen(readStoredJson<boolean>(ADD_ITEM_OPEN_KEY, false));
  }, []);

  useEffect(() => {
    // Skipped while Void Forge is hidden — otherwise a user who enabled it
    // previously would be stuck with it on and no control to turn it off.
    if (!VOID_FORGE_ENABLED) return;
    try {
      const storedVoidForge = localStorage.getItem('simhammer_void_forge');
      if (storedVoidForge === 'true') _setVoidForge(true);
    } catch {}
  }, []);

  useEffect(() => {
    const trimmed = simcInput.trim();
    const inputChanged = trimmed !== prevInputRef.current;
    const upgradeChanged = maxUpgrade !== prevUpgradeRef.current;
    const catalystChanged = catalyst !== prevCatalystRef.current;
    const voidForgeChanged = voidForge !== prevVoidForgeRef.current;

    if (!inputChanged && !upgradeChanged && !catalystChanged && !voidForgeChanged) return;

    if (trimmed.length < 10) {
      setResolved(null);
      setSelectedUids({});
      prevInputRef.current = trimmed;
      prevUpgradeRef.current = maxUpgrade;
      prevCatalystRef.current = catalyst;
      prevVoidForgeRef.current = voidForge;
      return;
    }

    const timer = setTimeout(
      async () => {
        prevInputRef.current = trimmed;
        prevUpgradeRef.current = maxUpgrade;
        prevCatalystRef.current = catalyst;
        prevVoidForgeRef.current = voidForge;
        setResolving(true);

        try {
          const resolveInput = appendLocalItems(simcInput, localItemsRef.current);
          const data = await postJson<ResolveGearResponse>('/api/gear/resolve', {
            simc_input: resolveInput,
            max_upgrade: maxUpgrade,
            catalyst,
            void_forge: voidForge,
          });
          setResolved(data);
          baseResolvedRef.current = data;

          if (inputChanged && data.catalyst_charges != null && !restoringRef.current) {
            setCatalystCharges(data.catalyst_charges);
          }

          if (inputChanged && !restoringRef.current) {
            setSelectedUids({});
            setLocalItems([]);
            setAddedLootItems([]);
            setEnchantSelections({});
            setGemSelections(new Set());
            setReplaceGems(false);
            setDiamondAlwaysUse(false);
            setMaxColors(false);
            setPromotedGroups(new Set());
          }
        } catch {
          setResolved(null);
          setSelectedUids({});
        } finally {
          restoringRef.current = false;
          setResolving(false);
        }
      },
      inputChanged ? 300 : 0
    );

    return () => clearTimeout(timer);
  }, [simcInput, maxUpgrade, catalyst, voidForge]);

  // Each unticked equipped piece is replaced by the first alternative ticked for
  // its slot, which becomes the baseline.
  const equippedReplacements = useMemo(
    () =>
      resolved
        ? pickEquippedReplacements(
            buildVisibleGroups(resolved),
            excludedEquipped,
            resolved,
            selectedUids
          )
        : {},
    [resolved, excludedEquipped, selectedUids]
  );
  // Every slot keeps an item: a slot left with nothing to replace its equipped
  // piece (its alternatives were deselected) is ticked again.
  const effectiveExcluded = useMemo(
    () => (resolved ? new Set(Object.keys(equippedReplacements)) : excludedEquipped),
    [resolved, equippedReplacements, excludedEquipped]
  );
  useEffect(() => {
    if (effectiveExcluded.size !== excludedEquipped.size) setExcludedEquipped(effectiveExcluded);
  }, [effectiveExcluded, excludedEquipped]);
  const excludedEquippedJson = useMemo(() => [...effectiveExcluded], [effectiveExcluded]);
  const equippedReplacementsJson = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(equippedReplacements).map(([slot, item]) => [slot, item.uid])
      ),
    [equippedReplacements]
  );

  const equippedSlots = useMemo<Record<string, ResolvedItem>>(() => {
    if (!resolved) return {};
    const entries = Object.entries(resolved.slots)
      .filter(([, slotResolution]) => slotResolution.equipped)
      .map(([slot, slotResolution]) => [slot, slotResolution.equipped as ResolvedItem]);
    return Object.fromEntries(entries);
  }, [resolved]);

  const enchantSelectionsArray = useMemo(
    () => serializeSelectionMap<number>(enchantSelections),
    [enchantSelections]
  );
  const gemOptionsArray = useMemo(() => Array.from(gemSelections), [gemSelections]);

  const onEnchantToggle = useCallback((slot: string, id: number) => {
    setEnchantSelections((previous) => {
      const next = new Set(previous[slot] || []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...previous, [slot]: next };
    });
  }, []);

  const onGemToggle = useCallback((_slot: string, id: number) => {
    setGemSelections((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onSelectAllEnchants = useCallback((slot: string, ids: number[]) => {
    setEnchantSelections((previous) => ({ ...previous, [slot]: new Set(ids) }));
  }, []);

  const onDeselectAllEnchants = useCallback((slot: string) => {
    setEnchantSelections((previous) => ({ ...previous, [slot]: new Set() }));
  }, []);

  const onSelectAllGems = useCallback((_slot: string, ids: number[]) => {
    setGemSelections((previous) => {
      const next = new Set(previous);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const onDeselectAllGems = useCallback((_slot: string, ids?: number[]) => {
    setGemSelections((previous) => {
      if (!ids || ids.length === 0) return new Set();
      const next = new Set(previous);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const changeDensity = useCallback((next: GearRowDensity) => {
    setDensity(next);
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  // CSS `top` is in unzoomed px; rects and scroll are in zoomed viewport px.
  const toolbarStickTop = useCallback(() => {
    const toolbar = toolbarAnchorRef.current?.nextElementSibling;
    return toolbar ? ((parseFloat(getComputedStyle(toolbar).top) || 0) * contentScale) / 100 : 0;
  }, [contentScale]);

  const selectSection = useCallback(
    (key: SectionKey) => {
      const anchor = toolbarAnchorRef.current;
      tabScrollPendingRef.current =
        !!anchor && anchor.getBoundingClientRect().top < toolbarStickTop();
      setActiveSection(key);
      try {
        localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(key));
      } catch {}
    },
    [toolbarStickTop]
  );

  useLayoutEffect(() => {
    if (!tabScrollPendingRef.current) return;
    tabScrollPendingRef.current = false;
    const anchor = toolbarAnchorRef.current;
    if (!anchor) return;
    window.scrollTo({
      top: anchor.getBoundingClientRect().top + window.scrollY - toolbarStickTop(),
    });
  }, [activeSection, toolbarStickTop]);

  const toggleAddItem = useCallback(() => {
    setAddItemOpen((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(ADD_ITEM_OPEN_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const promoteGroup = useCallback((label: string) => {
    setPromotedGroups((previous) => new Set(previous).add(label));
  }, []);

  // Without this a stray click in the unchanged strip would strand a slot as a
  // full card forever, with Reset all as the only way back.
  const demoteGroup = useCallback((label: string) => {
    setPromotedGroups((previous) => {
      const next = new Set(previous);
      next.delete(label);
      return next;
    });
  }, []);

  const clearItems = useCallback(() => setSelectedUids({}), []);
  const clearEnchants = useCallback(() => setEnchantSelections({}), []);
  const clearConsumables = useCallback(() => setConsumableOptions({}), []);
  // Clearing restores the imported folio rather than emptying the rows —
  // an empty folio would strip every rune from the sim.
  const clearFolio = useCallback(
    () => setFolioSelections(folioSeed),
    [folioSeed, setFolioSelections]
  );
  const clearGems = useCallback(() => {
    setGemSelections(new Set());
    // These only apply to selected gems, so leaving them on would silently
    // affect the next batch picked.
    setReplaceGems(false);
    setDiamondAlwaysUse(false);
    setMaxColors(false);
  }, []);

  const resetAll = useCallback(() => {
    clearItems();
    clearEnchants();
    clearGems();
    clearFolio();
    clearConsumables();
    setLocalItems([]);
    setAddedLootItems([]);
    setPromotedGroups(new Set());
    if (baseResolvedRef.current) setResolved(baseResolvedRef.current);
  }, [clearItems, clearEnchants, clearGems, clearFolio, clearConsumables]);

  const setVoidForge = useCallback((v: boolean) => {
    _setVoidForge(v);
    try {
      localStorage.setItem('simhammer_void_forge', String(v));
    } catch {}
  }, []);

  const folioCombinations = useMemo(
    () => (omniumTree ? folioCombos(omniumTree, folioSelections) : []),
    [omniumTree, folioSelections]
  );
  const folioExtraCount = useMemo(
    () => extraSelectedCount(folioSelections, folioSeed),
    [folioSelections, folioSeed]
  );
  const showFolioSection = (omniumTree?.nodes.length ?? 0) > 0;

  /** Store a row's new picks. A row the character has a rune in keeps at least
   *  one pick, so a stray click can't silently drop it from every combination.
   *  A row they have nothing in can go back to empty. */
  const onFolioChange = useCallback(
    (nodeId: number, entryIds: number[]) => {
      if (entryIds.length === 0 && (folioSeed[nodeId] ?? []).length > 0) return;
      setFolioSelections({ ...folioSelections, [nodeId]: entryIds });
    },
    [folioSelections, setFolioSelections, folioSeed]
  );

  const itemCount = useMemo(
    () => Object.values(selectedUids).reduce((sum, uids) => sum + uids.size, 0),
    [selectedUids]
  );
  const enchantCount = useMemo(
    () => Object.values(enchantSelections).reduce((sum, ids) => sum + ids.size, 0),
    [enchantSelections]
  );
  // The baseline each combo is compared against: the Sim settings picks, with
  // Auto slots resolved to what SimC will actually use.
  const consumableDefaults = useConsumableDefaults();
  const consumableBaseline = useMemo(
    () => ({
      ...consumableDefaults,
      ...Object.fromEntries(Object.entries(consumables).filter(([, value]) => value)),
    }),
    [consumableDefaults, consumables]
  );
  // Picks the baseline already uses drop out, so changing it never sims a
  // consumable against itself.
  const effectiveConsumables = useMemo(
    () => effectiveConsumableOptions(consumableOptions, consumableBaseline),
    [consumableOptions, consumableBaseline]
  );
  const consumableCount = Object.values(effectiveConsumables).reduce(
    (sum, values) => sum + values.length,
    0
  );
  const hasConsumableOptions = consumableCount > 0;
  const onConsumableChange = useCallback(
    (slot: string, values: string[]) =>
      setConsumableOptions((previous) => ({ ...previous, [slot]: values })),
    []
  );

  // Which sections exist at all. The structural half is decided here from the
  // character's gear; the data half (did /api/enchants and /api/gems actually
  // return anything?) is reported up by the selectors, because only they know
  // once their fetches resolve.
  const hasEnchantSlots = useMemo(
    () => ENCHANT_SLOTS.some((slot) => equippedSlots[slot]),
    [equippedSlots]
  );
  const hasSocketedSlots = useMemo(
    () => Object.values(equippedSlots).some((item) => item.sockets > 0),
    [equippedSlots]
  );
  const showEnchantSection = hasEnchantSlots && !enchantsEmpty;
  const showGemSection = hasSocketedSlots && !gemsEmpty;

  const quickSelectEntries = useMemo(
    () =>
      resolved
        ? collectQuickSelectEntries(resolved)
        : { vaultUids: [], lootUids: [], catalystUids: [] },
    [resolved]
  );

  const onToggleQuickGroup = useCallback((entries: { uid: string; slot: string }[]) => {
    setSelectedUids((previous) => toggleQuickSelectGroup(entries, previous));
  }, []);

  const sections = useMemo<TopGearSection[]>(() => {
    const list: TopGearSection[] = [
      {
        key: 'items',
        label: t('topGear.sectionItems'),
        count: itemCount,
        active: activeSection === 'items',
        onSelect: () => selectSection('items'),
        onClear: clearItems,
      },
    ];
    if (showEnchantSection) {
      list.push({
        key: 'enchants',
        label: t('topGear.sectionEnchants'),
        count: enchantCount,
        active: activeSection === 'enchants',
        onSelect: () => selectSection('enchants'),
        onClear: clearEnchants,
        tooltip: t('enchantGem.selectEnchantsTooltip'),
      });
    }
    if (showGemSection) {
      list.push({
        key: 'gems',
        label: t('topGear.sectionGems'),
        count: gemSelections.size,
        active: activeSection === 'gems',
        onSelect: () => selectSection('gems'),
        onClear: clearGems,
        tooltip: t('enchantGem.selectGemsTooltip'),
      });
    }
    if (showFolioSection) {
      list.push({
        key: 'folio',
        label: t('topGear.sectionFolio'),
        count: folioExtraCount,
        active: activeSection === 'folio',
        onSelect: () => selectSection('folio'),
        onClear: clearFolio,
        tooltip: t('omnium.sectionTooltip'),
      });
    }
    list.push({
      key: 'consumables',
      label: t('topGear.sectionConsumables'),
      count: consumableCount,
      active: activeSection === 'consumables',
      onSelect: () => selectSection('consumables'),
      onClear: clearConsumables,
      tooltip: t('consumables.sectionTooltip'),
    });
    // A remembered tab that this character doesn't have falls back to Items.
    if (!list.some((section) => section.active)) list[0].active = true;
    return list;
  }, [
    t,
    itemCount,
    enchantCount,
    gemSelections.size,
    folioExtraCount,
    consumableCount,
    activeSection,
    showEnchantSection,
    showGemSection,
    showFolioSection,
    selectSection,
    clearFolio,
    clearItems,
    clearEnchants,
    clearGems,
    clearConsumables,
  ]);
  const currentSection = (sections.find((section) => section.active)?.key ?? 'items') as SectionKey;

  const nothingToReset =
    itemCount === 0 &&
    enchantCount === 0 &&
    gemSelections.size === 0 &&
    consumableCount === 0 &&
    localItems.length === 0 &&
    addedLootItems.length === 0 &&
    promotedGroups.size === 0;

  const submitInput = useMemo(
    () => appendLocalItems(simcInput, localItems),
    [simcInput, localItems]
  );
  const selectedItemsJson = useMemo(() => buildSelectedUidsJson(selectedUids), [selectedUids]);
  const addedKeys = useMemo(
    () => new Set(addedLootItems.map((i) => buildAlternativeKey(i))),
    [addedLootItems]
  );
  const hasVoidForgeItems = useMemo(() => {
    if (!resolved?.slots) return false;
    return Object.values(resolved.slots).some(
      (slot) =>
        slot.equipped?.is_void_forge === true ||
        slot.alternatives.some((alt) => alt.is_void_forge === true)
    );
  }, [resolved]);

  // Shared gear body for the combo-count + cloud-estimate preflight POSTs.
  // Returns null when there's nothing to count (no selection / unresolved gear).
  const buildComboBody = useCallback(() => {
    const hasGearSelection = Object.values(selectedUids).some((v) => v.size > 0);
    const hasTalentCompare = talentBuilds.length > 1;
    const hasFolioCompare = folioCombinations.length > 1;
    const hasEnchantGem =
      Object.values(enchantSelectionsArray).some((v) => v.length > 0) || gemOptionsArray.length > 0;
    if (
      !resolved ||
      (!hasGearSelection &&
        !hasTalentCompare &&
        !hasFolioCompare &&
        !hasEnchantGem &&
        !hasConsumableOptions)
    )
      return null;
    return {
      simc_input: submitInput,
      selected_items: selectedItemsJson,
      equipped_replacements: equippedReplacementsJson,
      items_by_slot: null,
      max_upgrade: maxUpgrade,
      copy_enchants: copyEnchants,
      ...(talentBuilds.length > 1
        ? {
            talent_builds: talentBuilds.map((build) => ({
              name: build.name,
              talent_string: build.talentString,
            })),
          }
        : {}),
      ...(folioCombinations.length > 1 ? { omnium_builds: folioCombinations } : {}),
      // The count depends on the base actor's folio: it decides whether variant 0
      // is skipped as the baseline. Without this the preview counts a combo the
      // run skips. Taken from the shared payload so it is byte-identical to what
      // submit sends.
      ...(sharedSimPayload.omnium_talents
        ? { omnium_talents: sharedSimPayload.omnium_talents }
        : {}),
      catalyst,
      ...(catalystCharges != null ? { catalyst_charges: catalystCharges } : {}),
      enchant_selections: enchantSelectionsArray,
      gem_options: gemOptionsArray,
      replace_gems: replaceGems,
      diamond_always_use: diamondAlwaysUse,
      max_colors: maxColors,
      ...(hasConsumableOptions ? { consumable_options: effectiveConsumables } : {}),
      ...(voidForge || hasVoidForgeItems ? { void_forge: true } : {}),
    };
  }, [
    resolved,
    selectedUids,
    submitInput,
    selectedItemsJson,
    equippedReplacementsJson,
    maxUpgrade,
    copyEnchants,
    talentBuilds,
    folioCombinations,
    sharedSimPayload,
    catalyst,
    catalystCharges,
    enchantSelectionsArray,
    gemOptionsArray,
    replaceGems,
    diamondAlwaysUse,
    maxColors,
    hasConsumableOptions,
    effectiveConsumables,
    voidForge,
    hasVoidForgeItems,
  ]);

  const { comboCount, error: comboError } = useComboCount(
    '/api/top-gear/combo-count',
    buildComboBody,
    [buildComboBody],
    { enabled: true, debounceMs: 0, tooManyMessage: t('validation.tooManyCombinations') }
  );

  // Cloud-streaming preflight for remote providers: advisory credit/chunk
  // estimate only — submit is hard-gated server-side, so this never blocks it.
  const isCloudCompute = compute !== 'auto' && compute !== 'local';
  const { estimate: cloudEstimate } = useCloudEstimate(
    '/api/top-gear/cloud-estimate',
    () => {
      const body = buildComboBody();
      if (body === null) return null;
      // Must mirror EXACTLY what submit POSTs (see useSimSubmit) — page payload,
      // shared SimContext options, base fight params — so the credit estimate matches the run.
      return {
        ...body,
        ...sharedSimPayload,
        fight_style: fightStyle,
        desired_targets: targetCount,
        max_time: fightLength,
        compute_provider: compute,
      };
    },
    [buildComboBody, sharedSimPayload, fightStyle, targetCount, fightLength, compute],
    { enabled: isCloudCompute, computeChoice: compute }
  );

  const buildPayload = useCallback(
    () => ({
      simc_input: submitInput,
      selected_items: selectedItemsJson,
      equipped_replacements: equippedReplacementsJson,
      items_by_slot: null,
      max_upgrade: maxUpgrade,
      copy_enchants: copyEnchants,
      ...(talentBuilds.length > 1
        ? {
            talent_builds: talentBuilds.map((build) => ({
              name: build.name,
              talent_string: build.talentString,
            })),
          }
        : {}),
      catalyst,
      ...(catalystCharges != null ? { catalyst_charges: catalystCharges } : {}),
      enchant_selections: enchantSelectionsArray,
      gem_options: gemOptionsArray,
      replace_gems: replaceGems,
      diamond_always_use: diamondAlwaysUse,
      max_colors: maxColors,
      ...(folioCombinations.length > 1 ? { omnium_builds: folioCombinations } : {}),
      ...(hasConsumableOptions ? { consumable_options: effectiveConsumables } : {}),
      ...(voidForge || hasVoidForgeItems ? { void_forge: true } : {}),
      compute_provider: compute,
    }),
    [
      submitInput,
      selectedItemsJson,
      equippedReplacementsJson,
      maxUpgrade,
      copyEnchants,

      talentBuilds,
      folioCombinations,
      catalyst,
      catalystCharges,
      enchantSelectionsArray,
      gemOptionsArray,
      replaceGems,
      diamondAlwaysUse,
      maxColors,
      hasConsumableOptions,
      effectiveConsumables,
      voidForge,
      hasVoidForgeItems,
      compute,
    ]
  );

  const handleAddedItems = useCallback(
    (items: ResolvedItem[]) => {
      const dedupedItems = items.filter((item) => {
        const existing = resolved?.slots[item.slot]?.alternatives ?? [];
        const key = buildAlternativeKey(item);
        return !existing.some((alt) => buildAlternativeKey(alt) === key);
      });
      if (dedupedItems.length === 0) return;

      setResolved((prev) => {
        // Guard against `resolved` having been cleared (input changed / resolve
        // failed) while the resolve-drops request was in flight. Re-check
        // against the live `prev` so a rapid second add can't duplicate.
        if (!prev) return prev;
        let next = prev;
        for (const item of dedupedItems) {
          const existing = next.slots[item.slot]?.alternatives ?? [];
          const key = buildAlternativeKey(item);
          if (existing.some((alt) => buildAlternativeKey(alt) === key)) continue;
          next = mergeAlternative(next, item.slot, item);
        }
        return next;
      });
      setSelectedUids((prev) => {
        let next = prev;
        for (const item of dedupedItems) next = selectAlternative(next, item.slot, item.uid);
        return next;
      });
      setLocalItems((prev) => [
        ...prev,
        ...dedupedItems.map((i) => toLocalItem(i.slot, i.simc_string, 'bags')),
      ]);
      setAddedLootItems((prev) => [...prev, ...dedupedItems]);
    },
    [resolved]
  );

  const handleRemoveAdded = useCallback(
    (item: ResolvedItem) => {
      const clickedKey = buildAlternativeKey(item);
      const toRemove = addedLootItems.filter((li) => buildAlternativeKey(li) === clickedKey);
      if (toRemove.length === 0) return;

      setResolved((prevResolved) => {
        if (!prevResolved) return prevResolved;
        let next = prevResolved;
        for (const entry of toRemove) {
          const slotRes = next.slots[entry.slot];
          if (!slotRes) continue;
          next = {
            ...next,
            slots: {
              ...next.slots,
              [entry.slot]: {
                ...slotRes,
                alternatives: slotRes.alternatives.filter((alt) => alt.uid !== entry.uid),
              },
            },
          };
        }
        return next;
      });

      setSelectedUids((prevUids) => {
        let next = prevUids;
        for (const entry of toRemove) {
          const slotSet = next[entry.slot];
          if (!slotSet) continue;
          const nextSet = new Set(slotSet);
          nextSet.delete(entry.uid);
          next = { ...next, [entry.slot]: nextSet };
        }
        return next;
      });

      setLocalItems((prevLocal) =>
        prevLocal.filter(
          (li) =>
            !toRemove.some(
              (entry) => entry.slot === li.slot && entry.simc_string === li.simc_string
            )
        )
      );

      setAddedLootItems((prev) => prev.filter((li) => buildAlternativeKey(li) !== clickedKey));
    },
    [addedLootItems]
  );

  const validate = useCallback(() => {
    if (!resolved) return t('validation.noGearResolved');
    if (unsimmableSpec) return t('validation.unsupportedSpec', { spec: unsimmableSpec.label });
    return null;
  }, [resolved, unsimmableSpec, t]);

  const saveState = useCallback(() => {
    storeTopGearState({
      selectedUids: buildSelectedUidsJson(selectedUids),
      excludedEquipped: excludedEquippedJson,
      localItems,
      enchantSelections: serializeSelectionMap<number>(enchantSelections),
      gemSelections: [...gemSelections],
      maxUpgrade,
      copyEnchants,
      catalyst,
      catalystCharges,
      replaceGems,
      diamondAlwaysUse,
      maxColors,
      addedLootItems,
      promotedGroups: [...promotedGroups],
      consumableOptions,
    });
  }, [
    selectedUids,
    excludedEquippedJson,
    localItems,
    enchantSelections,
    gemSelections,
    maxUpgrade,
    copyEnchants,
    catalyst,
    catalystCharges,
    replaceGems,
    diamondAlwaysUse,
    maxColors,
    addedLootItems,
    promotedGroups,
    consumableOptions,
  ]);

  const { submit, submitting, error, buttonLabel } = useSimSubmit({
    endpoint: '/api/top-gear/sim',
    buildPayload,
    validate,
    onBeforeNavigate: saveState,
  });

  const bcp47 = locale.replace(/_/g, '-');

  // Cloud cost estimate shown as the Run-button subline. Same gate as the
  // former inline row: only for streaming-sized cloud jobs.
  let creditsSubLabel: ReactNode;
  if (isCloudCompute && cloudEstimate && cloudEstimate.would_stream && cloudEstimate.combos > 0) {
    const credits = cloudEstimate.est_credits.toLocaleString(bcp47);
    const text =
      cloudEstimate.available_credits !== null
        ? t('topGear.runCreditsAvailable', {
            credits,
            available: cloudEstimate.available_credits.toLocaleString(bcp47),
          })
        : t('topGear.runCreditsOnly', { credits });
    creditsSubLabel = (
      <span className="flex items-center gap-1.5">
        <span>{text}</span>
        {!cloudEstimate.affordable && (
          <Pill variant="negative" size="sm">
            {t('topGear.insufficientCredits')}
          </Pill>
        )}
      </span>
    );
  }

  const largeLocalSim = !isCloudCompute && comboCount >= LARGE_LOCAL_SIM_THRESHOLD;

  return (
    <div className={`space-y-6 ${largeLocalSim ? 'pb-36' : 'pb-20'}`}>
      <PageHeader
        eyebrow={t('nav.simTools')}
        title={t('nav.topGear')}
        subtitle={t('page.topGearSubtitle')}
      />

      <TalentPicker
        options={
          <SetupCell label={t('topGear.options')}>
            <SetupToggle
              checked={maxUpgrade}
              onChange={setMaxUpgrade}
              text={t('topGear.maxUpgrades')}
              tooltip={t('topGear.simHighestUpgradeTooltip')}
            />
            <SetupToggle
              checked={copyEnchants}
              onChange={setCopyEnchants}
              text={t('topGear.copyEnchants')}
              tooltip={t('topGear.copyEnchantsTooltip')}
            />
            {catalystCharges != null && catalystCharges > 0 && (
              <SetupToggle
                checked={catalyst}
                onChange={setCatalyst}
                text={t('topGear.catalyst')}
                tooltip={t('topGear.revivalCatalystTooltip')}
              >
                <CatalystChargesPicker
                  charges={catalystCharges}
                  active={catalyst}
                  onChange={setCatalystCharges}
                />
              </SetupToggle>
            )}
            {VOID_FORGE_ENABLED && (
              <SetupToggle
                checked={voidForge}
                onChange={setVoidForge}
                text={t('topGear.voidForgeShort')}
                tooltip={t('topGear.voidForge')}
              />
            )}
          </SetupCell>
        }
      />

      <SimSettingsBlock />

      {!resolved ? (
        <p className="py-6 text-center text-sm text-outline">
          {resolving ? t('topGear.resolvingGear') : t('topGear.pasteExport')}
        </p>
      ) : (
        <>
          <div ref={toolbarAnchorRef} />
          <TopGearToolbar
            sections={sections}
            density={density}
            onDensityChange={changeDensity}
            addItemOpen={addItemOpen}
            onAddItemToggle={toggleAddItem}
            quickSelect={
              currentSection === 'items' && (
                <TopGearQuickSelectBar
                  vaultUids={quickSelectEntries.vaultUids}
                  lootUids={quickSelectEntries.lootUids}
                  catalystUids={quickSelectEntries.catalystUids}
                  selectedUids={selectedUids}
                  onToggleGroup={onToggleQuickGroup}
                  t={t}
                />
              )
            }
            onResetAll={resetAll}
            resetDisabled={nothingToReset}
            t={t}
          />

          <AddItemSearch
            simcInput={submitInput}
            onItemsResolved={handleAddedItems}
            open={addItemOpen}
            onClose={toggleAddItem}
          />

          <div>
            <div role="tabpanel" hidden={currentSection !== 'items'}>
              <TopGearItemSelector
                resolved={resolved}
                selectedUids={selectedUids}
                onSelectionChange={setSelectedUids}
                excludedEquipped={effectiveExcluded}
                equippedReplacements={equippedReplacements}
                onExcludedEquippedChange={setExcludedEquipped}
                onResolvedChange={setResolved}
                onItemAdded={(slot, simcString, origin) =>
                  setLocalItems((previous) => [...previous, toLocalItem(slot, simcString, origin)])
                }
                onManualItemAdded={(item) => {
                  setLocalItems((previous) => [
                    ...previous,
                    toLocalItem(item.slot, item.simc_string, 'bags', true),
                  ]);
                  setAddedLootItems((previous) => [...previous, item]);
                }}
                addedKeys={addedKeys}
                onRemoveAdded={handleRemoveAdded}
                density={density}
                promotedGroups={promotedGroups}
                onPromoteGroup={promoteGroup}
                onDemoteGroup={demoteGroup}
              />
            </div>

            {showEnchantSection && (
              <div role="tabpanel" hidden={currentSection !== 'enchants'}>
                <EnchantSelector
                  equippedSlots={equippedSlots}
                  enchantSelections={enchantSelections}
                  onEnchantToggle={onEnchantToggle}
                  onSelectAllEnchants={onSelectAllEnchants}
                  onDeselectAllEnchants={onDeselectAllEnchants}
                  density={density}
                  onEmptyChange={setEnchantsEmpty}
                />
              </div>
            )}

            {showGemSection && (
              <div role="tabpanel" hidden={currentSection !== 'gems'}>
                <GemSelector
                  equippedSlots={equippedSlots}
                  gemSelections={gemSelections}
                  onGemToggle={onGemToggle}
                  onSelectAllGems={onSelectAllGems}
                  onDeselectAllGems={onDeselectAllGems}
                  onClearAllGems={clearGems}
                  replaceGems={replaceGems}
                  onReplaceGemsChange={setReplaceGems}
                  diamondAlwaysUse={diamondAlwaysUse}
                  onDiamondAlwaysUseChange={setDiamondAlwaysUse}
                  maxColors={maxColors}
                  onMaxColorsChange={setMaxColors}
                  density={density}
                  onEmptyChange={setGemsEmpty}
                />
              </div>
            )}

            {showFolioSection && (
              <div role="tabpanel" hidden={currentSection !== 'folio'}>
                <OmniumFolioPicker
                  selections={folioSelections}
                  onChange={onFolioChange}
                  density={density}
                />
              </div>
            )}

            <div role="tabpanel" hidden={currentSection !== 'consumables'}>
              <ConsumableAlternatives
                options={consumableOptions}
                baseline={consumableBaseline}
                onChange={onConsumableChange}
                density={density}
              />
            </div>
          </div>
        </>
      )}

      <SimcDownloadBanner />
      <ErrorAlert message={error} />

      <ConfigFooter
        onSubmit={submit}
        submitting={submitting}
        buttonLabel={buttonLabel(t('button.findTopGear'))}
        disabled={!resolved}
        compute={compute}
        onComputeChange={setCompute}
        subLabel={creditsSubLabel}
        notice={
          largeLocalSim ? (
            <div className="border-t border-gold/35 bg-popover/95 backdrop-blur-xl">
              <p className="mx-auto max-w-screen-2xl px-8 py-3 text-sm text-on-surface-variant">
                <span className="font-bold text-gold">{t('topGear.largeLocalSimTitle')}</span>{' '}
                <span className="opacity-50">·</span>{' '}
                {t('topGear.largeLocalSimBody', { count: comboCount.toLocaleString(bcp47) })}
              </p>
            </div>
          ) : undefined
        }
        status={
          resolved ? (
            <div className="flex shrink-0 flex-col items-end gap-1.5 px-1">
              <span className="lbl config-footer-hide-sm">{t('topGear.combinations')}</span>
              <b
                className={`font-headline text-xl font-extrabold tabular-nums leading-none ${
                  comboError ? 'text-negative' : comboCount > 0 ? 'text-on-surface' : 'text-outline'
                }`}
              >
                {comboCount.toLocaleString()}
              </b>
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
