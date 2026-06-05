'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import TopGearItemSelector from '../components/gear/TopGearItemSelector';
import EnchantGemSelector from '../components/gear/EnchantGemSelector';
import ConfigFooter from '../components/sim-config/ConfigPanel';
import TalentPicker from '../components/talents/TalentPicker';
import ErrorAlert from '../components/ui/ErrorAlert';
import SimcDownloadBanner from '../components/ui/SimcDownloadBanner';
import { useSimContext } from '../components/sim-config/SimContext';
import { postJson } from '../lib/api';
import { useSimSubmit } from '../lib/useSimSubmit';
import { useSharedSimPayload } from '../lib/useSharedSimPayload';
import { useComboCount } from '../lib/useComboCount';
import { useCloudEstimate } from '../lib/useCloudEstimate';
import type { ResolveGearResponse, ResolvedItem } from '../lib/types';
import { useLanguage } from '../lib/i18n';
import { clearTopGearState, getTopGearState, storeTopGearState } from '../lib/topgear-state';
import {
  appendLocalItems,
  buildSelectedUidsJson,
  serializeSelectionMap,
  toLocalItem,
} from './topGearPayload';
import type { TopGearLocalItem } from './topGearTypes';
import { useComputeChoice } from '../lib/useComputeChoice';

function InfoIcon({ tooltip }: { tooltip: string }) {
  return (
    <span
      onClick={(event) => event.stopPropagation()}
      className="group/tip relative inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-on-surface-variant/10 text-on-surface-variant/50 transition-colors hover:bg-on-surface-variant/20 hover:text-on-surface-variant"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="currentColor"
        className="h-2.5 w-2.5"
      >
        <path
          fillRule="evenodd"
          d="M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0Zm-6 3.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM7.293 5.293a1 1 0 1 1 .99 1.667c-.15.09-.293.21-.293.443V8a.75.75 0 1 0 1.5 0v-.297a2.5 2.5 0 1 0-3.447-2.66.75.75 0 0 0 1.5 0 1 1 0 0 1-.25-.75Z"
          clipRule="evenodd"
        />
      </svg>
      <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-56 -translate-x-1/2 whitespace-normal rounded-lg border border-outline-variant/20 bg-surface-container-highest px-3 py-2 text-center text-xs font-normal normal-case tracking-normal text-on-surface opacity-0 shadow-xl transition-opacity group-hover/tip:opacity-100">
        {tooltip}
      </span>
    </span>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  tooltip,
  color = 'bg-primary',
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  tooltip?: string;
  color?: string;
}) {
  return (
    <div
      className="group flex cursor-pointer items-center gap-2.5"
      onClick={() => onChange(!checked)}
    >
      <div
        className={`relative h-5 w-9 shrink-0 rounded-full p-1 transition-colors ${
          checked ? color : 'bg-surface-container-highest'
        }`}
      >
        <div
          className={`absolute h-3 w-3 rounded-full transition-all ${
            checked ? 'right-1 bg-on-surface' : 'left-1 bg-on-surface-variant'
          }`}
        />
      </div>
      <span className="font-headline text-sm font-bold text-on-surface-variant transition-colors group-hover:text-primary">
        {label}
      </span>
      {tooltip && <InfoIcon tooltip={tooltip} />}
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
  const prevInputRef = useRef('');
  const prevUpgradeRef = useRef(false);
  const prevCatalystRef = useRef(false);
  const prevVoidForgeRef = useRef(false);
  const restoringRef = useRef(false);
  const localItemsRef = useRef(localItems);
  localItemsRef.current = localItems;

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
  }, []);

  useEffect(() => {
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

          if (inputChanged && data.catalyst_charges != null && !restoringRef.current) {
            setCatalystCharges(data.catalyst_charges);
          }

          if (inputChanged && !restoringRef.current) {
            setSelectedUids({});
            setLocalItems([]);
            setEnchantSelections({});
            setGemSelections(new Set());
            setReplaceGems(false);
            setDiamondAlwaysUse(false);
            setMaxColors(false);
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

  const setVoidForge = useCallback((v: boolean) => {
    _setVoidForge(v);
    try {
      localStorage.setItem('simhammer_void_forge', String(v));
    } catch {}
  }, []);

  const submitInput = useMemo(
    () => appendLocalItems(simcInput, localItems),
    [simcInput, localItems]
  );
  const selectedItemsJson = useMemo(() => buildSelectedUidsJson(selectedUids), [selectedUids]);
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
      Object.values(enchantSelectionsArray).some((v) => v.length > 0) ||
      gemOptionsArray.length > 0;
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

  // Cloud-streaming preflight: when a remote (non-local) provider is selected,
  // fetch an advisory credit/chunk estimate. Advisory only — submit is hard-gated
  // server-side, so this never blocks submission.
  const isCloudCompute = compute !== 'auto' && compute !== 'local';
  const { estimate: cloudEstimate } = useCloudEstimate(
    '/api/top-gear/cloud-estimate',
    () => {
      const body = buildComboBody();
      if (body === null) return null;
      // Mirror EXACTLY what a single submit config POSTs (see useSimSubmit): the
      // page payload, the shared SimContext options, and the base fight params
      // (added per-scenario in submit). target_error etc. must match so the
      // backend's credit estimate matches the eventual run.
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
  ]);

  const { submit, submitting, error, buttonLabel } = useSimSubmit({
    endpoint: '/api/top-gear/sim',
    buildPayload,
    validate,
    onBeforeNavigate: saveState,
  });

  // Cloud cost estimate shown as the Run-button subline. Same gate as the
  // former inline row: only for streaming-sized cloud jobs.
  let creditsSubLabel: ReactNode;
  if (isCloudCompute && cloudEstimate && cloudEstimate.would_stream && cloudEstimate.combos > 0) {
    const bcp47 = locale.replace(/_/g, '-');
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

  return (
    <div className="space-y-6 pb-20">
      <div>
        <h1 className="mb-2 font-headline text-4xl font-black uppercase tracking-tighter text-on-surface">
          Top Gear
        </h1>
        <p className="max-w-2xl text-sm text-on-surface-variant">
          Find the optimal gear combination from your bags. Compare enchants, gems, and talent
          builds.
        </p>
      </div>

      <TalentPicker />

      <div className="flex flex-wrap items-center gap-6 rounded-xl border border-outline-variant/10 bg-surface-container-low px-6 py-4">
        <Toggle
          checked={copyEnchants}
          onChange={setCopyEnchants}
          label={t('topGear.copyEnchants')}
          tooltip={t('topGear.copyEnchantsTooltip')}
        />
        <span className="h-5 w-px bg-outline-variant/20" />
        <Toggle
          checked={maxUpgrade}
          onChange={setMaxUpgrade}
          label={t('topGear.simHighestUpgrade')}
          tooltip={t('topGear.simHighestUpgradeTooltip')}
        />
        {catalystCharges != null && catalystCharges > 0 && (
          <>
            <span className="h-5 w-px bg-outline-variant/20" />
            <div className="flex items-center gap-2.5">
              <Toggle
                checked={catalyst}
                onChange={setCatalyst}
                label={t('topGear.revivalCatalyst')}
                tooltip={t('topGear.revivalCatalystTooltip')}
                color="bg-purple-500"
              />
              <div className="ml-1 flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={catalystCharges}
                  onChange={(event) => {
                    const value = parseInt(event.target.value, 10);
                    if (!Number.isNaN(value) && value >= 0) setCatalystCharges(value);
                  }}
                  className="input-field !w-12 !px-1.5 !py-0.5 text-center !text-[13px]"
                />
                <span className="text-[11px] text-on-surface-variant/60">
                  {t('topGear.charges')}
                </span>
                <InfoIcon tooltip={t('topGear.chargesTooltip')} />
              </div>
            </div>
          </>
        )}
        <span className="h-5 w-px bg-outline-variant/20" />
        <Toggle checked={voidForge} onChange={setVoidForge} label={t('topGear.voidForge')} />
      </div>

      {!resolved ? (
        <p className="py-6 text-center text-sm text-muted">
          {resolving ? t('topGear.resolvingGear') : t('topGear.pasteExport')}
        </p>
      ) : (
        <>
          <TopGearItemSelector
            resolved={resolved}
            selectedUids={selectedUids}
            onSelectionChange={setSelectedUids}
            onResolvedChange={setResolved}
            onItemAdded={(slot, simcString, origin) =>
              setLocalItems((previous) => [...previous, toLocalItem(slot, simcString, origin)])
            }
            comboCount={comboCount}
            comboError={comboError}
          />
          <EnchantGemSelector
            equippedSlots={equippedSlots}
            enchantSelections={enchantSelections}
            gemSelections={gemSelections}
            onEnchantToggle={onEnchantToggle}
            onGemToggle={onGemToggle}
            onSelectAllEnchants={onSelectAllEnchants}
            onDeselectAllEnchants={onDeselectAllEnchants}
            onSelectAllGems={onSelectAllGems}
            onDeselectAllGems={onDeselectAllGems}
            replaceGems={replaceGems}
            onReplaceGemsChange={setReplaceGems}
            diamondAlwaysUse={diamondAlwaysUse}
            onDiamondAlwaysUseChange={setDiamondAlwaysUse}
            maxColors={maxColors}
            onMaxColorsChange={setMaxColors}
          />
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
      />
    </div>
  );
}
