'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import TopGearItemSelector from '../components/gear/TopGearItemSelector';
import AddItemSearch from '../components/gear/AddItemSearch';
import EnchantSelector from '../components/gear/EnchantSelector';
import GemSelector from '../components/gear/GemSelector';
import TopGearToolbar, { type TopGearSection } from '../components/gear/TopGearToolbar';
import { GEAR_ROW_DENSITIES, type GearRowDensity } from '../components/gear/gearDensity';
import TopGearQuickSelectBar from '../components/gear/TopGearQuickSelectBar';
import TopGearSectionPanel from '../components/gear/TopGearSectionPanel';
import { ENCHANT_SLOTS } from '../components/gear/itemOptions';
import ConfigFooter from '../components/sim-config/ConfigPanel';
import TalentPicker from '../components/talents/TalentPicker';
import ErrorAlert from '../components/ui/ErrorAlert';
import InfoIcon from '../components/ui/InfoIcon';
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
import {
  collectQuickSelectEntries,
  mergeAlternative,
  selectAlternative,
  toggleQuickSelectGroup,
} from '../components/gear/topGearSelection';

// A local run works through every combo on this machine, so a six-figure
// count is hours of work. Warn past this line, never block.
const LARGE_LOCAL_SIM_THRESHOLD = 20_000;

type SectionKey = 'items' | 'enchants' | 'gems';

// One key for all three, deliberately new: the old per-section keys
// (simhammer_topgear_{enchants,gems}_open) already hold `false` for anyone who
// used the page before, which would shadow the open-by-default below.
const SECTIONS_STORAGE_KEY = 'simhammer_topgear_sections_open';

const DEFAULT_SECTIONS_OPEN: Record<SectionKey, boolean> = {
  items: true,
  enchants: true,
  gems: true,
};

const DENSITY_STORAGE_KEY = 'simhammer_topgear_density';

/** Compact option chip. The switch itself is an inner button so that anything
 *  else in the chip — the catalyst charges input, the info badge — is a sibling
 *  rather than a descendant: no keystroke can reach the toggle by bubbling, and
 *  no interactive element ends up nested inside a `role="switch"`. */
function Chip({
  checked,
  onChange,
  label,
  tooltip,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  tooltip?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`group flex shrink-0 select-none items-center gap-2 rounded-full border px-3 py-1 text-[12px] transition-colors ${
        checked
          ? 'border-gold/40 bg-gold/10 font-semibold text-on-surface'
          : 'border-outline-variant/25 bg-surface-container font-medium text-on-surface-variant hover:border-outline-variant/40 hover:bg-surface-container-high'
      }`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="flex min-w-0 items-center gap-2 text-left"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
            checked ? 'bg-gold' : 'bg-on-surface-variant/40'
          }`}
        />
        <span className="truncate">{label}</span>
      </button>
      {children}
      {tooltip && (
        <span
          className={`shrink-0 transition-opacity ${
            checked ? 'opacity-90' : 'opacity-40 group-hover:opacity-90'
          }`}
        >
          <InfoIcon tooltip={tooltip} />
        </span>
      )}
    </div>
  );
}

export default function TopGearScreen() {
  const { simcInput, talentBuilds, fightStyle, targetCount, fightLength } = useSimContext();
  const sharedSimPayload = useSharedSimPayload();
  const { t, locale } = useLanguage();
  const [compute, setCompute] = useComputeChoice('top_gear');
  const [resolved, setResolved] = useState<ResolveGearResponse | null>(null);
  const [selectedUids, setSelectedUids] = useState<Record<string, Set<string>>>({});
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
  const [density, setDensity] = useState<GearRowDensity>('compact');
  const [sectionsOpen, setSectionsOpen] =
    useState<Record<SectionKey, boolean>>(DEFAULT_SECTIONS_OPEN);
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
  const sectionRefs = useRef<Record<SectionKey, HTMLElement | null>>({
    items: null,
    enchants: null,
    gems: null,
  });
  const pendingScrollRef = useRef<SectionKey | null>(null);

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

    const restoredEnchants: Record<string, Set<number>> = {};
    for (const [slot, values] of Object.entries(saved.enchantSelections)) {
      restoredEnchants[slot] = new Set(values);
    }
    setEnchantSelections(restoredEnchants);
    setGemSelections(new Set(saved.gemSelections));
    setAddedLootItems(saved.addedLootItems ?? []);
    setPromotedGroups(new Set(saved.promotedGroups ?? []));
  }, []);

  // Restore view preferences after mount (avoids an SSR hydration mismatch).
  useEffect(() => {
    // Validated rather than trusted: an unknown stored value would otherwise
    // index the metric maps with undefined and blank every row class.
    const storedDensity = readStoredJson<GearRowDensity>(DENSITY_STORAGE_KEY, 'compact');
    setDensity(GEAR_ROW_DENSITIES.includes(storedDensity) ? storedDensity : 'compact');
    // Spread over the defaults so a partial or stale blob can't leave a section
    // stuck closed with no way to tell why.
    setSectionsOpen({
      ...DEFAULT_SECTIONS_OPEN,
      ...readStoredJson<Partial<Record<SectionKey, boolean>>>(SECTIONS_STORAGE_KEY, {}),
    });
  }, []);

  // Runs once the section has actually opened or closed, so the scroll lands on
  // the final layout instead of racing it.
  useEffect(() => {
    const key = pendingScrollRef.current;
    if (!key) return;
    pendingScrollRef.current = null;
    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [sectionsOpen]);

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

  // Toolbar navigation: scroll only. Expanding and collapsing belongs to the
  // section's own header, so this never touches open state.
  const scrollToSection = useCallback((key: SectionKey) => {
    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const toggleSection = useCallback(
    (key: SectionKey) => {
      // Computed and persisted outside the updater: React requires updaters to
      // be pure and invokes them twice under StrictMode.
      const next = { ...sectionsOpen, [key]: !sectionsOpen[key] };
      setSectionsOpen(next);
      try {
        localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      // Collapsing shortens the page, and the browser would otherwise clamp the
      // scroll position to wherever it lands. Land on the section either way.
      pendingScrollRef.current = key;
    },
    [sectionsOpen]
  );

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
    setLocalItems([]);
    setAddedLootItems([]);
    setPromotedGroups(new Set());
    if (baseResolvedRef.current) setResolved(baseResolvedRef.current);
  }, [clearItems, clearEnchants, clearGems]);

  const setVoidForge = useCallback((v: boolean) => {
    _setVoidForge(v);
    try {
      localStorage.setItem('simhammer_void_forge', String(v));
    } catch {}
  }, []);

  const itemCount = useMemo(
    () => Object.values(selectedUids).reduce((sum, uids) => sum + uids.size, 0),
    [selectedUids]
  );
  const enchantCount = useMemo(
    () => Object.values(enchantSelections).reduce((sum, ids) => sum + ids.size, 0),
    [enchantSelections]
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
        open: sectionsOpen.items,
        onNavigate: () => scrollToSection('items'),
        onClear: clearItems,
      },
    ];
    if (showEnchantSection) {
      list.push({
        key: 'enchants',
        label: t('topGear.sectionEnchants'),
        count: enchantCount,
        open: sectionsOpen.enchants,
        onNavigate: () => scrollToSection('enchants'),
        onClear: clearEnchants,
      });
    }
    if (showGemSection) {
      list.push({
        key: 'gems',
        label: t('topGear.sectionGems'),
        count: gemSelections.size,
        open: sectionsOpen.gems,
        onNavigate: () => scrollToSection('gems'),
        onClear: clearGems,
      });
    }
    return list;
  }, [
    t,
    itemCount,
    enchantCount,
    gemSelections.size,
    sectionsOpen,
    showEnchantSection,
    showGemSection,
    scrollToSection,
    clearItems,
    clearEnchants,
    clearGems,
  ]);

  const nothingToReset =
    itemCount === 0 &&
    enchantCount === 0 &&
    gemSelections.size === 0 &&
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
    const hasEnchantGem =
      Object.values(enchantSelectionsArray).some((v) => v.length > 0) || gemOptionsArray.length > 0;
    if (!resolved || (!hasGearSelection && !hasTalentCompare && !hasEnchantGem)) return null;
    return {
      simc_input: submitInput,
      selected_items: selectedItemsJson,
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
      ...(voidForge || hasVoidForgeItems ? { void_forge: true } : {}),
    };
  }, [
    resolved,
    selectedUids,
    submitInput,
    selectedItemsJson,
    maxUpgrade,
    copyEnchants,
    talentBuilds,
    catalyst,
    catalystCharges,
    enchantSelectionsArray,
    gemOptionsArray,
    replaceGems,
    diamondAlwaysUse,
    maxColors,
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
      ...(voidForge || hasVoidForgeItems ? { void_forge: true } : {}),
      compute_provider: compute,
    }),
    [
      submitInput,
      selectedItemsJson,
      maxUpgrade,
      copyEnchants,

      talentBuilds,
      catalyst,
      catalystCharges,
      enchantSelectionsArray,
      gemOptionsArray,
      replaceGems,
      diamondAlwaysUse,
      maxColors,
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
    return null;
  }, [resolved, t]);

  const saveState = useCallback(() => {
    storeTopGearState({
      selectedUids: buildSelectedUidsJson(selectedUids),
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
    });
  }, [
    selectedUids,
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
          <span className="rounded bg-red-950/80 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-red-100">
            {t('topGear.insufficientCredits')}
          </span>
        )}
      </span>
    );
  }

  const largeLocalSim = !isCloudCompute && comboCount >= LARGE_LOCAL_SIM_THRESHOLD;

  return (
    <div className={`space-y-6 ${largeLocalSim ? 'pb-36' : 'pb-20'}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-headline text-xl font-black uppercase tracking-tight text-on-surface">
          {t('nav.topGear')}
        </h1>
        <p className="text-xs text-on-surface-variant/70">{t('page.topGearSubtitle')}</p>
      </div>

      <TalentPicker />

      <div className="flex flex-wrap items-center gap-2">
        <Chip
          checked={copyEnchants}
          onChange={setCopyEnchants}
          label={t('topGear.copyEnchants')}
          tooltip={t('topGear.copyEnchantsTooltip')}
        />
        <Chip
          checked={maxUpgrade}
          onChange={setMaxUpgrade}
          label={t('topGear.simHighestUpgrade')}
          tooltip={t('topGear.simHighestUpgradeTooltip')}
        />
        {catalystCharges != null && catalystCharges > 0 && (
          <Chip
            checked={catalyst}
            onChange={setCatalyst}
            label={t('topGear.revivalCatalyst')}
            tooltip={t('topGear.revivalCatalystTooltip')}
          >
            <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={10}
                value={catalystCharges}
                onChange={(event) => {
                  const value = parseInt(event.target.value, 10);
                  if (!Number.isNaN(value) && value >= 0) setCatalystCharges(value);
                }}
                className="w-8 rounded border border-outline-variant/30 bg-surface-container px-0.5 py-px text-center text-[12px] font-bold tabular-nums text-on-surface outline-none focus:border-gold/40"
              />
              <span className="text-[11px] text-on-surface-variant/60">{t('topGear.charges')}</span>
            </span>
          </Chip>
        )}
        {VOID_FORGE_ENABLED && (
          <Chip checked={voidForge} onChange={setVoidForge} label={t('topGear.voidForge')} />
        )}
      </div>

      {!resolved ? (
        <p className="py-6 text-center text-sm text-muted">
          {resolving ? t('topGear.resolvingGear') : t('topGear.pasteExport')}
        </p>
      ) : (
        <>
          <AddItemSearch simcInput={submitInput} onItemsResolved={handleAddedItems} />

          <TopGearToolbar
            sections={sections}
            density={density}
            onDensityChange={changeDensity}
            quickSelect={
              <TopGearQuickSelectBar
                vaultUids={quickSelectEntries.vaultUids}
                lootUids={quickSelectEntries.lootUids}
                catalystUids={quickSelectEntries.catalystUids}
                selectedUids={selectedUids}
                onToggleGroup={onToggleQuickGroup}
                t={t}
              />
            }
            onResetAll={resetAll}
            resetDisabled={nothingToReset}
            t={t}
          />

          <div className="space-y-6">
            <TopGearSectionPanel
              label={t('topGear.sectionItems')}
              count={itemCount}
              open={sectionsOpen.items}
              onToggle={() => toggleSection('items')}
              onClear={clearItems}
              clearTitle={t('topGear.clearSection', { section: t('topGear.sectionItems') })}
              clearLabel={t('common.clear')}
              sectionRef={(el) => {
                sectionRefs.current.items = el;
              }}
            >
              <TopGearItemSelector
                resolved={resolved}
                selectedUids={selectedUids}
                onSelectionChange={setSelectedUids}
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
            </TopGearSectionPanel>

            {showEnchantSection && (
              <TopGearSectionPanel
                label={t('topGear.sectionEnchants')}
                count={enchantCount}
                tooltip={t('enchantGem.selectEnchantsTooltip')}
                open={sectionsOpen.enchants}
                onToggle={() => toggleSection('enchants')}
                onClear={clearEnchants}
                clearTitle={t('topGear.clearSection', { section: t('topGear.sectionEnchants') })}
                clearLabel={t('common.clear')}
                sectionRef={(el) => {
                  sectionRefs.current.enchants = el;
                }}
              >
                <EnchantSelector
                  equippedSlots={equippedSlots}
                  enchantSelections={enchantSelections}
                  onEnchantToggle={onEnchantToggle}
                  onSelectAllEnchants={onSelectAllEnchants}
                  onDeselectAllEnchants={onDeselectAllEnchants}
                  density={density}
                  onEmptyChange={setEnchantsEmpty}
                />
              </TopGearSectionPanel>
            )}

            {showGemSection && (
              <TopGearSectionPanel
                label={t('topGear.sectionGems')}
                count={gemSelections.size}
                tooltip={t('enchantGem.selectGemsTooltip')}
                open={sectionsOpen.gems}
                onToggle={() => toggleSection('gems')}
                onClear={clearGems}
                clearTitle={t('topGear.clearSection', { section: t('topGear.sectionGems') })}
                clearLabel={t('common.clear')}
                sectionRef={(el) => {
                  sectionRefs.current.gems = el;
                }}
              >
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
              </TopGearSectionPanel>
            )}
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
            <div className="border-t border-amber-500/30 bg-amber-950/95 backdrop-blur-xl">
              <p className="mx-auto max-w-screen-2xl px-8 py-3 text-sm text-amber-100">
                <span className="font-bold text-amber-300">{t('topGear.largeLocalSimTitle')}</span>{' '}
                <span className="opacity-50">·</span>{' '}
                {t('topGear.largeLocalSimBody', { count: comboCount.toLocaleString(bcp47) })}
              </p>
            </div>
          ) : undefined
        }
        status={
          resolved ? (
            <div
              className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 ${
                comboError
                  ? 'border-red-500/30 bg-red-500/10'
                  : 'border-outline-variant/20 bg-surface-container-high'
              }`}
            >
              <span
                className={`font-mono text-base font-bold tabular-nums ${
                  comboError
                    ? 'text-red-400'
                    : comboCount > 0
                      ? 'text-on-surface'
                      : 'text-on-surface-variant'
                }`}
              >
                {comboCount.toLocaleString()}
              </span>
              <span className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
                {comboCount === 1 ? 'combo' : 'combos'}
              </span>
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
