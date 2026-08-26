'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { FightScenario } from '../../lib/types';
import type { ActiveRoute } from '../../lib/active-route';
import { API_URL } from '../../lib/api';
import {
  readSessionJson,
  readSessionString,
  readStoredJson,
  readStoredPositiveInt,
} from '../../lib/storage';
import {
  DEFAULT_EXPANSION_OPTIONS,
  DEFAULT_PROFILE_DATA,
  DEFAULT_RAID_BUFFS,
  normalizeSimcBranch,
  parseRotationMode,
  type RotationMode,
} from '../../lib/sim-config-defaults';
import {
  booleanRecord,
  isDefaultProfile,
  isProfileSupported,
  normalizeProfileData,
  parseFightSetup,
  parseStoredProfile,
  stringRecord,
  updateProfile,
  type FightSetup,
  type SimProfile,
  type SimProfileData,
} from '../../lib/sim-profiles';

export type { RotationMode };

/** How long the config must settle before the working draft is written and the
 *  dirty dot recomputed. Long enough that typing doesn't serialize per keystroke,
 *  short enough that the dot feels immediate. */
const DRAFT_DEBOUNCE_MS = 400;

/** JSON with object keys sorted recursively, so semantically equal configs
 *  compare equal regardless of key insertion order. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

interface SimContextType {
  simcInput: string;
  setSimcInput: (v: string) => void;
  /** Whether simcInput has enough content to be worth sending to the server. */
  hasInput: boolean;
  fightStyle: string;
  setFightStyle: (v: string) => void;
  /** `fightStyle === 'DungeonRoute'` — gates the route control and the controls a
   *  route overrides. Derived; exposed so consumers don't re-derive. */
  isDungeonRoute: boolean;
  threads: number;
  setThreads: (v: number) => void;
  selectedTalent: string;
  setSelectedTalent: (v: string) => void;
  targetCount: number;
  setTargetCount: (v: number) => void;
  fightLength: number;
  setFightLength: (v: number) => void;
  targetError: number;
  setTargetError: (v: number) => void;
  iterations: number;
  setIterations: (v: number) => void;
  customApl: string;
  setCustomApl: (v: string) => void;
  /** Active dungeon route, held as data and materialized to SimC at sim time
   *  (see useSimSubmit). `null` when no route is loaded. */
  activeRoute: ActiveRoute | null;
  /** Load a route as active. Owns the coupled state: persists it, clears queued
   *  scenarios (can't coexist with a forced route), and sets the fight style
   *  (DungeonRoute, except a legacy `footer` snippet). Use instead of poking the
   *  pieces individually. */
  activateRoute: (route: ActiveRoute) => void;
  /** Unload the active route and restore the fight setup it suspended. */
  clearRoute: () => void;
  rotationMode: RotationMode;
  setRotationMode: (v: RotationMode) => void;
  // Expert Mode injection points
  simcHeader: string;
  setSimcHeader: (v: string) => void;
  simcBasePlayer: string;
  setSimcBasePlayer: (v: string) => void;
  simcRaidActors: string;
  setSimcRaidActors: (v: string) => void;
  simcPostCombos: string;
  setSimcPostCombos: (v: string) => void;
  simcFooter: string;
  setSimcFooter: (v: string) => void;
  // Raid buffs, consumables, expansion options
  raidBuffs: Record<string, boolean>;
  setRaidBuffs: (v: Record<string, boolean>) => void;
  consumables: Record<string, string>;
  setConsumables: (v: Record<string, string>) => void;
  expansionOptions: Record<string, boolean>;
  setExpansionOptions: (v: Record<string, boolean>) => void;
  // SimC branch selection (desktop)
  simcBranch: string;
  setSimcBranch: (v: string) => void;
  // Multi-talent compare
  talentBuilds: { name: string; talentString: string }[];
  setTalentBuilds: (v: { name: string; talentString: string }[]) => void;
  // Multi-sim scenarios
  scenarios: FightScenario[];
  addScenario: () => void;
  removeScenario: (id: string) => void;
  clearScenarios: () => void;
  // Profileset parallelism toggle (for A/B testing the SimC perf flag).
  parallelProfilesets: boolean;
  setParallelProfilesets: (v: boolean) => void;
  // Streamed Top Gear Triage checkpoint size. Larger batches favor throughput over pause response.
  triageMaxBatchProfilesets: number;
  setTriageMaxBatchProfilesets: (v: number) => void;
  // Quick Sim: calculate stat weights (off by default — adds ~8× sim time).
  statWeights: boolean;
  setStatWeights: (v: boolean) => void;
  // Sim profiles (saved shared-config snapshots)
  /** Profile currently loaded into the shared config (`null` = none). */
  activeProfile: SimProfile | null;
  /** Load a saved profile into the shared config. No-op for newer-schema
   *  profiles. While a route is loaded the profile's fightStyle + scenarios go
   *  to the suspension and land when it's cleared; a stored 'DungeonRoute' style
   *  falls back to Patchwerk. */
  applyProfile: (profile: SimProfile) => void;
  /** Snapshot the shared config as profile data. Reports the suspended fight
   *  setup rather than a route's forced values, so it is what both a new profile
   *  stores and the dirty check compares. */
  captureProfileData: () => SimProfileData;
  /** Save the current config over the active profile. No-op without one. */
  saveActiveProfile: () => Promise<void>;
  /** Record which stored profile the config corresponds to (after save/rename),
   *  or clear it (after delete). */
  setActiveProfile: (p: SimProfile | null) => void;
  /** Whether the shared config has drifted from the active profile's data. */
  profileDirty: boolean;
}

const SimContext = createContext<SimContextType | null>(null);

export function useSimContext() {
  const ctx = useContext(SimContext);
  if (!ctx) throw new Error('useSimContext must be used within SimProvider');
  return ctx;
}

export function SimProvider({ children }: { children: ReactNode }) {
  // Profile-captured fields start at the shared defaults, so an untouched config
  // matches a normalized blob exactly (a mismatch reads as a phantom dirty dot).
  const [simcInput, _setSimcInput] = useState('');
  const [fightStyle, _setFightStyle] = useState(DEFAULT_PROFILE_DATA.fightStyle);
  const [threads, _setThreads] = useState(DEFAULT_PROFILE_DATA.threads);
  const [selectedTalent, setSelectedTalent] = useState('');
  const [targetCount, setTargetCount] = useState(DEFAULT_PROFILE_DATA.targetCount);
  const [fightLength, setFightLength] = useState(DEFAULT_PROFILE_DATA.fightLength);
  const [targetError, _setTargetError] = useState(DEFAULT_PROFILE_DATA.targetError);
  const [iterations, _setIterations] = useState(DEFAULT_PROFILE_DATA.iterations);
  const [customApl, setCustomApl] = useState(DEFAULT_PROFILE_DATA.customApl);
  const [activeRoute, _setActiveRoute] = useState<ActiveRoute | null>(null);
  const [rotationMode, _setRotationMode] = useState<RotationMode>(
    DEFAULT_PROFILE_DATA.rotationMode
  );
  const [simcHeader, setSimcHeader] = useState(DEFAULT_PROFILE_DATA.simcHeader);
  const [simcBasePlayer, setSimcBasePlayer] = useState(DEFAULT_PROFILE_DATA.simcBasePlayer);
  const [simcRaidActors, setSimcRaidActors] = useState(DEFAULT_PROFILE_DATA.simcRaidActors);
  const [simcPostCombos, setSimcPostCombos] = useState(DEFAULT_PROFILE_DATA.simcPostCombos);
  const [simcFooter, setSimcFooter] = useState(DEFAULT_PROFILE_DATA.simcFooter);
  const [raidBuffs, _setRaidBuffs] = useState<Record<string, boolean>>(
    DEFAULT_PROFILE_DATA.raidBuffs
  );
  const [consumables, _setConsumables] = useState<Record<string, string>>(
    DEFAULT_PROFILE_DATA.consumables
  );
  const [expansionOptions, _setExpansionOptions] = useState<Record<string, boolean>>(
    DEFAULT_PROFILE_DATA.expansionOptions
  );
  const [simcBranch, _setSimcBranch] = useState(DEFAULT_PROFILE_DATA.simcBranch);
  const [talentBuilds, setTalentBuilds] = useState<{ name: string; talentString: string }[]>([]);
  const [scenarios, setScenarios] = useState<FightScenario[]>(DEFAULT_PROFILE_DATA.scenarios);
  const [parallelProfilesets, setParallelProfilesets] = useState(
    DEFAULT_PROFILE_DATA.parallelProfilesets
  );
  const [triageMaxBatchProfilesets, _setTriageMaxBatchProfilesets] = useState(
    DEFAULT_PROFILE_DATA.triageMaxBatchProfilesets
  );
  const [statWeights, _setStatWeights] = useState(DEFAULT_PROFILE_DATA.statWeights);
  const [activeProfile, _setActiveProfile] = useState<SimProfile | null>(null);
  // The config's own fightStyle + scenarios while a route forces those fields.
  // Restored when the route is cleared; see `activateRoute`.
  const [suspendedFight, _setSuspendedFight] = useState<FightSetup | null>(null);

  useEffect(() => {
    try {
      _setSimcInput(readSessionString('simhammer_simc_input', ''));

      // ---- 1. The working config -------------------------------------------
      // localStorage is an unchecked boundary — readStoredJson's type argument
      // is an assertion, not validation — so everything here is shape-checked
      // and normalized through the storage seam's own parsers.
      const storedProfile = parseStoredProfile(
        readStoredJson<unknown>('simhammer_active_profile', null)
      );
      // Only adopt a profile this build understands. A newer-schema blob is left
      // in storage untouched and NOT made active: adopting it would enable Save
      // and Rename, which rewrite it at the current version and destroy every
      // field this build can't model.
      const supported = storedProfile !== null && isProfileSupported(storedProfile);
      if (supported) _setActiveProfile(storedProfile);
      // The draft is the live config including unsaved edits. It wins over the
      // profile's saved data so a reload doesn't silently revert those edits
      // (which also cleared the dirty dot, hiding the loss).
      const draft = readStoredJson<unknown>('simhammer_profile_draft', null);
      const working =
        draft !== null ? normalizeProfileData(draft) : supported ? storedProfile.data : null;

      // ---- 2. Route and the fight setup it suspends -------------------------
      // Both are session-scoped: the route is live sim input, and the values it
      // displaces have to come back with it.
      const restoredRoute = readSessionJson<ActiveRoute | null>('simhammer_active_route', null);
      _setActiveRoute(restoredRoute);
      const restoredSuspension = restoredRoute
        ? (parseFightSetup(readSessionJson<unknown>('simhammer_suspended_fight', null)) ??
          (working ? { fightStyle: working.fightStyle, scenarios: working.scenarios } : null))
        : null;
      _setSuspendedFight(restoredSuspension);

      // Seed every profile-captured field at once. Raw setters: this is a
      // restore, not an edit, so it must not re-persist what it just read.
      if (working) {
        // Under a route those two fields are the route's; the config's own live
        // in the suspension and land when it's cleared.
        if (!restoredSuspension) {
          _setFightStyle(working.fightStyle);
          setScenarios(working.scenarios);
        }
        setFightLength(working.fightLength);
        setTargetCount(working.targetCount);
        _setTargetError(working.targetError);
        _setIterations(working.iterations);
        _setThreads(working.threads);
        _setRotationMode(working.rotationMode);
        setCustomApl(working.customApl);
        _setRaidBuffs(working.raidBuffs);
        _setConsumables(working.consumables);
        _setExpansionOptions(working.expansionOptions);
        _setSimcBranch(working.simcBranch);
        setSimcHeader(working.simcHeader);
        setSimcBasePlayer(working.simcBasePlayer);
        setSimcRaidActors(working.simcRaidActors);
        setSimcPostCombos(working.simcPostCombos);
        setSimcFooter(working.simcFooter);
        setParallelProfilesets(working.parallelProfilesets);
        _setTriageMaxBatchProfilesets(working.triageMaxBatchProfilesets);
        _setStatWeights(working.statWeights);
      }
      // fightStyle isn't persisted on its own, so re-assert route ⇒ DungeonRoute
      // (footer snippets aren't routes and keep the default style).
      if (restoredRoute && restoredRoute.kind !== 'footer') _setFightStyle('DungeonRoute');

      // ---- 3. Individually persisted fields win -----------------------------
      // These have their own keys, written synchronously on every change, while
      // the draft above is debounced — so a change made just before reload is in
      // the key but not yet in the draft.
      _setThreads(readStoredPositiveInt('simhammer_threads', DEFAULT_PROFILE_DATA.threads));
      const storedError = localStorage.getItem('simhammer_target_error');
      if (storedError != null) {
        const n = parseFloat(storedError);
        if (Number.isFinite(n) && n > 0) _setTargetError(n);
      }
      _setIterations(
        readStoredPositiveInt('simhammer_iterations', DEFAULT_PROFILE_DATA.iterations)
      );
      _setStatWeights(localStorage.getItem('simhammer_stat_weights') === 'true');
      _setTriageMaxBatchProfilesets(
        readStoredPositiveInt(
          'simhammer_triage_max_batch_profilesets',
          DEFAULT_PROFILE_DATA.triageMaxBatchProfilesets
        )
      );
      const storedBranch = normalizeSimcBranch(localStorage.getItem('simhammer_simc_branch') ?? '');
      _setSimcBranch(storedBranch);
      if (storedBranch) {
        localStorage.setItem('simhammer_simc_branch', storedBranch);
      }
      // Merge defaults per-key via the same helpers normalizeProfileData uses —
      // live state and profile blobs must agree on merging, and newly added
      // default buffs surface as enabled instead of staying silently absent.
      _setRaidBuffs(booleanRecord(readStoredJson('simhammer_raid_buffs', {}), DEFAULT_RAID_BUFFS));
      _setConsumables(stringRecord(readStoredJson('simhammer_consumables', {})));
      _setExpansionOptions(
        booleanRecord(readStoredJson('simhammer_expansion_options', {}), DEFAULT_EXPANSION_OPTIONS)
      );
      _setRotationMode(parseRotationMode(localStorage.getItem('simhammer_rotation_mode')));
    } catch {}
  }, []);

  const addScenario = useCallback(() => {
    setScenarios((prev) => [
      ...prev,
      { id: crypto.randomUUID(), fightStyle, targetCount, fightLength },
    ]);
  }, [fightStyle, targetCount, fightLength]);

  const removeScenario = useCallback((id: string) => {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const clearScenarios = useCallback(() => {
    setScenarios([]);
  }, []);

  const setSimcInput = useCallback((v: string) => {
    _setSimcInput(v);
    try {
      sessionStorage.setItem('simhammer_simc_input', v);
    } catch {}
  }, []);

  const hasInput = simcInput.trim().length >= 50;

  // Dungeon Route mode: gates the route control and the controls a route overrides.
  const isDungeonRoute = fightStyle === 'DungeonRoute';

  const setRaidBuffs = useCallback((v: Record<string, boolean>) => {
    _setRaidBuffs(v);
    try {
      localStorage.setItem('simhammer_raid_buffs', JSON.stringify(v));
    } catch {}
  }, []);

  const setConsumables = useCallback((v: Record<string, string>) => {
    // An empty value means "SimC default", which is what an absent key means —
    // compact here so live state can't differ from a normalized blob by a key
    // that carries no setting, which would light the dirty dot for nothing.
    const compact = stringRecord(v);
    _setConsumables(compact);
    try {
      localStorage.setItem('simhammer_consumables', JSON.stringify(compact));
    } catch {}
  }, []);

  const setExpansionOptions = useCallback((v: Record<string, boolean>) => {
    _setExpansionOptions(v);
    try {
      localStorage.setItem('simhammer_expansion_options', JSON.stringify(v));
    } catch {}
  }, []);

  const setThreads = useCallback((v: number) => {
    _setThreads(v);
    try {
      localStorage.setItem('simhammer_threads', String(v));
    } catch {}
  }, []);

  const setSimcBranch = useCallback((v: string) => {
    const normalized = normalizeSimcBranch(v);
    _setSimcBranch(normalized);
    try {
      localStorage.setItem('simhammer_simc_branch', normalized);
    } catch {}
  }, []);

  const setTargetError = useCallback((v: number) => {
    _setTargetError(v);
    try {
      localStorage.setItem('simhammer_target_error', String(v));
    } catch {}
  }, []);

  const setIterations = useCallback((v: number) => {
    _setIterations(v);
    try {
      localStorage.setItem('simhammer_iterations', String(v));
    } catch {}
  }, []);

  const setRotationMode = useCallback((v: RotationMode) => {
    _setRotationMode(v);
    try {
      localStorage.setItem('simhammer_rotation_mode', v);
    } catch {}
  }, []);

  // Internal: set + persist the active route (the live sim input survives reload).
  const persistActiveRoute = useCallback((v: ActiveRoute | null) => {
    _setActiveRoute(v);
    try {
      if (v) sessionStorage.setItem('simhammer_active_route', JSON.stringify(v));
      else sessionStorage.removeItem('simhammer_active_route');
    } catch {}
  }, []);

  // Internal: set + persist the fight setup a route is displacing. Session-scoped
  // like the route itself — they have to come back together.
  const persistSuspendedFight = useCallback((v: FightSetup | null) => {
    _setSuspendedFight(v);
    try {
      if (v) sessionStorage.setItem('simhammer_suspended_fight', JSON.stringify(v));
      else sessionStorage.removeItem('simhammer_suspended_fight');
    } catch {}
  }, []);

  // Exposed fight-style setter. A loaded route only applies in Dungeon Route mode,
  // so switching to any other style discards it — keeping "route ⇒ DungeonRoute" one
  // invariant (with activateRoute/clearRoute) instead of each drawer re-coupling it.
  const setFightStyle = useCallback(
    (v: string) => {
      _setFightStyle(v);
      if (v !== 'DungeonRoute') {
        persistActiveRoute(null);
        // The style the user just picked wins over the suspended one, but they
        // never asked to lose their scenarios — hand those back.
        if (suspendedFight) {
          setScenarios(suspendedFight.scenarios);
          persistSuspendedFight(null);
        }
      }
    },
    [persistActiveRoute, persistSuspendedFight, suspendedFight]
  );

  const activateRoute = useCallback(
    (route: ActiveRoute) => {
      // Suspend the config's own fight setup, on the first route only — a
      // route-to-route switch would otherwise capture the forced values and
      // there'd be nothing left to restore.
      if (!suspendedFight) persistSuspendedFight({ fightStyle, scenarios });
      persistActiveRoute(route);
      // Scenarios sweep fight styles, but the route's fight_style=DungeonRoute would
      // override them at sim time — so they'd all silently run the same route.
      setScenarios([]);
      // Footer snippets may be any SimC, so keep the default style for them; real route
      // kinds force DungeonRoute. Raw setter: don't discard the route we just set.
      _setFightStyle(route.kind === 'footer' ? 'Patchwerk' : 'DungeonRoute');
    },
    [persistActiveRoute, persistSuspendedFight, suspendedFight, fightStyle, scenarios]
  );

  const clearRoute = useCallback(() => {
    persistActiveRoute(null);
    _setFightStyle(suspendedFight ? suspendedFight.fightStyle : 'Patchwerk');
    if (suspendedFight) {
      setScenarios(suspendedFight.scenarios);
      persistSuspendedFight(null);
    }
  }, [persistActiveRoute, persistSuspendedFight, suspendedFight]);

  const setStatWeights = useCallback((v: boolean) => {
    _setStatWeights(v);
    try {
      localStorage.setItem('simhammer_stat_weights', String(v));
    } catch {}
  }, []);

  const setTriageMaxBatchProfilesets = useCallback((v: number) => {
    _setTriageMaxBatchProfilesets(v);
    try {
      localStorage.setItem('simhammer_triage_max_batch_profilesets', String(v));
    } catch {}
  }, []);

  const setActiveProfile = useCallback((p: SimProfile | null) => {
    _setActiveProfile(p);
    try {
      if (p) localStorage.setItem('simhammer_active_profile', JSON.stringify(p));
      else localStorage.removeItem('simhammer_active_profile');
    } catch {}
  }, []);

  const captureProfileData = useCallback((): SimProfileData => {
    // While a route is loaded it forces fightStyle + scenarios, so the config's
    // own values (held in the suspension) are what a profile stores and what the
    // dirty check compares. Blobs never store 'DungeonRoute': without a route the
    // style is meaningless, so it would only leave profiles permanently dirty.
    const fight = suspendedFight ?? { fightStyle, scenarios };
    return {
      fightStyle: fight.fightStyle === 'DungeonRoute' ? 'Patchwerk' : fight.fightStyle,
      scenarios: fight.scenarios,
      fightLength,
      targetCount,
      iterations,
      targetError,
      threads,
      rotationMode,
      customApl,
      raidBuffs,
      consumables,
      expansionOptions,
      simcBranch,
      simcHeader,
      simcBasePlayer,
      simcRaidActors,
      simcPostCombos,
      simcFooter,
      parallelProfilesets,
      triageMaxBatchProfilesets,
      statWeights,
    };
  }, [
    suspendedFight,
    fightStyle,
    fightLength,
    targetCount,
    scenarios,
    iterations,
    targetError,
    threads,
    rotationMode,
    customApl,
    raidBuffs,
    consumables,
    expansionOptions,
    simcBranch,
    simcHeader,
    simcBasePlayer,
    simcRaidActors,
    simcPostCombos,
    simcFooter,
    parallelProfilesets,
    triageMaxBatchProfilesets,
    statWeights,
  ]);

  const applyProfile = useCallback(
    (profile: SimProfile) => {
      // Newer-schema profiles can't be applied faithfully; the picker shows
      // them disabled — this is the seam's backstop.
      if (!isProfileSupported(profile)) return;
      const d = profile.data;
      // A stored DungeonRoute style can't be honored without a route. While one
      // is loaded it forces these two fields, so the profile's own go into the
      // suspension and land when the route is cleared: writing them to live state
      // would just be overwritten, and dropping them would let a later Save write
      // the route's forced values over the profile.
      const fight: FightSetup = {
        fightStyle: d.fightStyle === 'DungeonRoute' ? 'Patchwerk' : d.fightStyle,
        scenarios: d.scenarios,
      };
      if (suspendedFight) {
        persistSuspendedFight(fight);
      } else {
        setFightStyle(fight.fightStyle);
        setScenarios(fight.scenarios);
      }
      setTargetCount(d.targetCount);
      setFightLength(d.fightLength);
      setTargetError(d.targetError);
      setIterations(d.iterations);
      setThreads(d.threads);
      setRotationMode(d.rotationMode);
      setCustomApl(d.customApl);
      setRaidBuffs(d.raidBuffs);
      setConsumables(d.consumables);
      setExpansionOptions(d.expansionOptions);
      setSimcBranch(d.simcBranch);
      setSimcHeader(d.simcHeader);
      setSimcBasePlayer(d.simcBasePlayer);
      setSimcRaidActors(d.simcRaidActors);
      setSimcPostCombos(d.simcPostCombos);
      setSimcFooter(d.simcFooter);
      setParallelProfilesets(d.parallelProfilesets);
      setTriageMaxBatchProfilesets(d.triageMaxBatchProfilesets);
      setStatWeights(d.statWeights);
      setActiveProfile(profile);
    },
    [
      suspendedFight,
      persistSuspendedFight,
      setFightStyle,
      setActiveProfile,
      setThreads,
      setTargetError,
      setIterations,
      setRotationMode,
      setRaidBuffs,
      setConsumables,
      setExpansionOptions,
      setSimcBranch,
      setTriageMaxBatchProfilesets,
      setStatWeights,
    ]
  );

  const saveActiveProfile = useCallback(async () => {
    // The built-in Default is not a stored row; the drawer disables Save for
    // it, and this is the seam's backstop.
    if (!activeProfile || isDefaultProfile(activeProfile)) return;
    setActiveProfile(await updateProfile({ ...activeProfile, data: captureProfileData() }));
  }, [activeProfile, captureProfileData, setActiveProfile]);

  // Persist the working config so a reload restores unsaved edits instead of
  // reverting them (which also cleared the dirty dot, hiding the loss). Debounced:
  // the expert text fields write to state on every keystroke, and this is the one
  // place that serializes the whole config — including multi-KB SimC blobs.
  const [draftKey, setDraftKey] = useState<string | null>(null);
  useEffect(() => {
    const writeDraft = () => {
      const data = captureProfileData();
      setDraftKey(stableStringify(data));
      try {
        localStorage.setItem('simhammer_profile_draft', JSON.stringify(data));
      } catch {}
    };
    const id = setTimeout(writeDraft, DRAFT_DEBOUNCE_MS);
    // Flush on the way out, or an edit made inside the debounce window is the
    // one thing the draft was added to stop losing. `pagehide` rather than
    // `beforeunload`: it also covers the Electron window closing.
    const flush = () => {
      clearTimeout(id);
      writeDraft();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      clearTimeout(id);
      window.removeEventListener('pagehide', flush);
    };
  }, [captureProfileData]);

  // Key-sorted stringify so record key order (buffs, consumables) can never
  // false-dirty. Both sides are keyed on their own input, so neither is rebuilt
  // for a change to the other.
  const savedProfileKey = useMemo(
    () => (activeProfile ? stableStringify(activeProfile.data) : null),
    [activeProfile]
  );
  const profileDirty =
    savedProfileKey !== null && draftKey !== null && draftKey !== savedProfileKey;

  return (
    <SimContext.Provider
      value={{
        simcInput,
        setSimcInput,
        hasInput,
        fightStyle,
        setFightStyle,
        isDungeonRoute,
        threads,
        setThreads,
        selectedTalent,
        setSelectedTalent,
        targetCount,
        setTargetCount,
        fightLength,
        setFightLength,
        targetError,
        setTargetError,
        iterations,
        setIterations,
        customApl,
        setCustomApl,
        activeRoute,
        activateRoute,
        clearRoute,
        rotationMode,
        setRotationMode,
        simcHeader,
        setSimcHeader,
        simcBasePlayer,
        setSimcBasePlayer,
        simcRaidActors,
        setSimcRaidActors,
        simcPostCombos,
        setSimcPostCombos,
        simcFooter,
        setSimcFooter,
        raidBuffs,
        setRaidBuffs,
        consumables,
        setConsumables,
        expansionOptions,
        setExpansionOptions,
        simcBranch,
        setSimcBranch,
        talentBuilds,
        setTalentBuilds,
        scenarios,
        addScenario,
        removeScenario,
        clearScenarios,
        parallelProfilesets,
        setParallelProfilesets,
        triageMaxBatchProfilesets,
        setTriageMaxBatchProfilesets,
        statWeights,
        setStatWeights,
        activeProfile,
        applyProfile,
        captureProfileData,
        saveActiveProfile,
        setActiveProfile,
        profileDirty,
      }}
    >
      {children}
    </SimContext.Provider>
  );
}
