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
import { TRIAGE_BATCH_DEFAULT } from '../../lib/triageBatch';
import {
  DEFAULT_EXPANSION_OPTIONS,
  DEFAULT_RAID_BUFFS,
  normalizeSimcBranch,
} from '../../lib/sim-config-defaults';
import {
  booleanRecord,
  normalizeProfileData,
  PROFILE_SCHEMA_VERSION,
  stringRecord,
  type SimProfile,
  type SimProfileData,
} from '../../lib/sim-profiles';

export { DEFAULT_EXPANSION_OPTIONS, DEFAULT_RAID_BUFFS };

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

export type RotationMode = 'default' | 'assisted_combat' | 'one_button';

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
  /** Unload the active route and restore the default fight style. */
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
   *  profiles. A loaded non-footer route keeps fightStyle + scenarios; a
   *  stored 'DungeonRoute' style falls back to Patchwerk. */
  applyProfile: (profile: SimProfile) => void;
  /** Whether a loaded route owns fightStyle + scenarios (non-footer route).
   *  Derived; NOT the same as isDungeonRoute — the DungeonRoute style can be
   *  selected manually without a route, and then the profile owns the style. */
  routeOwnsFight: boolean;
  /** Snapshot the shared config as profile data. */
  captureProfileData: () => SimProfileData;
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
  const [simcInput, _setSimcInput] = useState('');
  const [fightStyle, _setFightStyle] = useState('Patchwerk');
  const [threads, _setThreads] = useState(0);
  const [selectedTalent, setSelectedTalent] = useState('');
  const [targetCount, setTargetCount] = useState(1);
  const [fightLength, setFightLength] = useState(300);
  const [targetError, _setTargetError] = useState(0.1);
  const [iterations, _setIterations] = useState(100000);
  const [customApl, setCustomApl] = useState('');
  const [activeRoute, _setActiveRoute] = useState<ActiveRoute | null>(null);
  const [rotationMode, _setRotationMode] = useState<RotationMode>('default');
  const [simcHeader, setSimcHeader] = useState('');
  const [simcBasePlayer, setSimcBasePlayer] = useState('');
  const [simcRaidActors, setSimcRaidActors] = useState('');
  const [simcPostCombos, setSimcPostCombos] = useState('');
  const [simcFooter, setSimcFooter] = useState('');
  const [raidBuffs, _setRaidBuffs] = useState<Record<string, boolean>>(DEFAULT_RAID_BUFFS);
  const [consumables, _setConsumables] = useState<Record<string, string>>({});
  const [expansionOptions, _setExpansionOptions] =
    useState<Record<string, boolean>>(DEFAULT_EXPANSION_OPTIONS);
  const [simcBranch, _setSimcBranch] = useState('');
  const [talentBuilds, setTalentBuilds] = useState<{ name: string; talentString: string }[]>([]);
  const [scenarios, setScenarios] = useState<FightScenario[]>([]);
  const [parallelProfilesets, setParallelProfilesets] = useState(true);
  const [triageMaxBatchProfilesets, _setTriageMaxBatchProfilesets] = useState(TRIAGE_BATCH_DEFAULT);
  const [statWeights, _setStatWeights] = useState(false);
  const [activeProfile, _setActiveProfile] = useState<SimProfile | null>(null);

  useEffect(() => {
    try {
      _setSimcInput(readSessionString('simhammer_simc_input', ''));
      _setThreads(readStoredPositiveInt('simhammer_threads', 0));
      const storedError = localStorage.getItem('simhammer_target_error');
      if (storedError != null) {
        const n = parseFloat(storedError);
        if (Number.isFinite(n) && n > 0) _setTargetError(n);
      }
      _setIterations(readStoredPositiveInt('simhammer_iterations', 100000));
      _setStatWeights(localStorage.getItem('simhammer_stat_weights') === 'true');
      // Active route survives reload (it's live sim input). Never-throw helper so a
      // corrupt value yields null instead of aborting the other restores. fightStyle
      // isn't persisted, so re-assert route ⇒ DungeonRoute (footer snippets aren't routes).
      const restoredRoute = readSessionJson<ActiveRoute | null>('simhammer_active_route', null);
      _setActiveRoute(restoredRoute);
      if (restoredRoute && restoredRoute.kind !== 'footer') _setFightStyle('DungeonRoute');
      _setTriageMaxBatchProfilesets(
        readStoredPositiveInt('simhammer_triage_max_batch_profilesets', TRIAGE_BATCH_DEFAULT)
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
      const storedRotationMode = localStorage.getItem('simhammer_rotation_mode');
      if (
        storedRotationMode === 'default' ||
        storedRotationMode === 'assisted_combat' ||
        storedRotationMode === 'one_button'
      ) {
        _setRotationMode(storedRotationMode);
      }
      // Re-seed the fields that aren't individually persisted from the active
      // profile, so a reload doesn't revert them to defaults (which would also
      // arm Save to write those defaults back over the profile). Individually
      // persisted fields (restored above) win — unsaved tweaks to them survive
      // reload. Route-owned fields follow the route restore: only a real
      // dungeon route (not a footer snippet) owns fightStyle + scenarios.
      // localStorage is an unchecked boundary — readStoredJson's type argument
      // is an assertion, not validation — so shape-check and normalize before
      // any of it reaches typed state (profileDirty renders from `data`).
      const rawProfile = readStoredJson<Partial<SimProfile> | null>(
        'simhammer_active_profile',
        null
      );
      const storedProfile: SimProfile | null =
        rawProfile &&
        typeof rawProfile.id === 'string' &&
        typeof rawProfile.name === 'string' &&
        typeof rawProfile.version === 'number' &&
        typeof rawProfile.updated_at === 'string'
          ? {
              id: rawProfile.id,
              name: rawProfile.name,
              version: rawProfile.version,
              updated_at: rawProfile.updated_at,
              data: normalizeProfileData(rawProfile.data),
            }
          : null;
      _setActiveProfile(storedProfile);
      if (storedProfile && storedProfile.version <= PROFILE_SCHEMA_VERSION) {
        const d = storedProfile.data;
        if (!restoredRoute || restoredRoute.kind === 'footer') {
          _setFightStyle(d.fightStyle);
          setScenarios(d.scenarios);
        }
        setFightLength(d.fightLength);
        setTargetCount(d.targetCount);
        setCustomApl(d.customApl);
        setSimcHeader(d.simcHeader);
        setSimcBasePlayer(d.simcBasePlayer);
        setSimcRaidActors(d.simcRaidActors);
        setSimcPostCombos(d.simcPostCombos);
        setSimcFooter(d.simcFooter);
        setParallelProfilesets(d.parallelProfilesets);
      }
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

  // A loaded non-footer route owns fightStyle + scenarios. Not isDungeonRoute:
  // that style can be picked manually without a route, and a footer-kind
  // snippet doesn't own the style either way.
  const routeOwnsFight = activeRoute !== null && activeRoute.kind !== 'footer';

  const setRaidBuffs = useCallback((v: Record<string, boolean>) => {
    _setRaidBuffs(v);
    try {
      localStorage.setItem('simhammer_raid_buffs', JSON.stringify(v));
    } catch {}
  }, []);

  const setConsumables = useCallback((v: Record<string, string>) => {
    _setConsumables(v);
    try {
      localStorage.setItem('simhammer_consumables', JSON.stringify(v));
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

  // Exposed fight-style setter. A loaded route only applies in Dungeon Route mode,
  // so switching to any other style discards it — keeping "route ⇒ DungeonRoute" one
  // invariant (with activateRoute/clearRoute) instead of each drawer re-coupling it.
  const setFightStyle = useCallback(
    (v: string) => {
      _setFightStyle(v);
      if (v !== 'DungeonRoute') persistActiveRoute(null);
    },
    [persistActiveRoute]
  );

  const activateRoute = useCallback(
    (route: ActiveRoute) => {
      persistActiveRoute(route);
      // Scenarios sweep fight styles, but the route's fight_style=DungeonRoute would
      // override them at sim time — so they'd all silently run the same route.
      setScenarios([]);
      // Footer snippets may be any SimC, so keep the default style for them; real route
      // kinds force DungeonRoute. Raw setter: don't discard the route we just set.
      _setFightStyle(route.kind === 'footer' ? 'Patchwerk' : 'DungeonRoute');
    },
    [persistActiveRoute]
  );

  const clearRoute = useCallback(() => {
    persistActiveRoute(null);
    _setFightStyle('Patchwerk');
  }, [persistActiveRoute]);

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

  const captureProfileData = useCallback(
    (): SimProfileData => ({
      // Blobs never store 'DungeonRoute': without a route the style is
      // meaningless, and with one the route owns it (apply skips it, save-over
      // masks it) — storing it would only leave profiles permanently dirty.
      fightStyle: fightStyle === 'DungeonRoute' ? 'Patchwerk' : fightStyle,
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
    }),
    [
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
    ]
  );

  const applyProfile = useCallback(
    (profile: SimProfile) => {
      // Newer-schema profiles can't be applied faithfully; the picker shows
      // them disabled — this is the seam's backstop.
      if (profile.version > PROFILE_SCHEMA_VERSION) return;
      const d = profile.data;
      // A loaded non-footer route owns fightStyle + scenarios, and a stored
      // DungeonRoute style can't be honored without one. The public setter is
      // intentional for the non-owned path: like a manual fight-style change,
      // applying a profile discards a loaded footer snippet.
      if (!routeOwnsFight) {
        setFightStyle(d.fightStyle === 'DungeonRoute' ? 'Patchwerk' : d.fightStyle);
        setScenarios(d.scenarios);
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
      routeOwnsFight,
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

  // Route-owned fields are masked while a route owns them — the config being
  // forced to DungeonRoute under a route is not profile drift. Key-sorted
  // stringify so record key order (buffs, consumables) can never false-dirty.
  const profileDirty = useMemo(() => {
    if (!activeProfile) return false;
    const saved = activeProfile.data;
    const current = captureProfileData();
    const masked = routeOwnsFight
      ? { ...current, fightStyle: saved.fightStyle, scenarios: saved.scenarios }
      : current;
    return stableStringify(masked) !== stableStringify(saved);
  }, [activeProfile, routeOwnsFight, captureProfileData]);

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
        setActiveProfile,
        profileDirty,
        routeOwnsFight,
      }}
    >
      {children}
    </SimContext.Provider>
  );
}
