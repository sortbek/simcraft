'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
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

export type RotationMode = 'default' | 'assisted_combat' | 'one_button';

interface SimContextType {
  simcInput: string;
  setSimcInput: (v: string) => void;
  /** Whether simcInput has enough content to be worth sending to the server. */
  hasInput: boolean;
  fightStyle: string;
  setFightStyle: (v: string) => void;
  /** `fightStyle === 'DungeonRoute'` — the mode the route control and the controls
   *  a route overrides are gated on. Derived; exposed so consumers don't re-derive. */
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
  /** The active dungeon route, held as data and materialized to SimC at sim
   *  time (see useSimSubmit). `null` when no route is loaded. */
  activeRoute: ActiveRoute | null;
  /** Load a route as the active route. Owns the coupled state: persists it,
   *  clears any queued scenarios (which can't coexist with a forced route), and
   *  sets the fight style (DungeonRoute, except a legacy `footer` snippet which
   *  may not be one). Use this instead of poking the pieces individually. */
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
}

const SimContext = createContext<SimContextType | null>(null);

function normalizeSimcBranch(value: string): string {
  if (value.startsWith('weekly-')) return 'weekly';
  if (value.startsWith('nightly-')) return 'nightly';
  return value;
}

export function useSimContext() {
  const ctx = useContext(SimContext);
  if (!ctx) throw new Error('useSimContext must be used within SimProvider');
  return ctx;
}

export const DEFAULT_RAID_BUFFS: Record<string, boolean> = {
  bloodlust: true,
  arcane_intellect: true,
  power_word_fortitude: true,
  battle_shout: true,
  mystic_touch: true,
  chaos_brand: true,
  skyfury: true,
  mark_of_the_wild: true,
  hunters_mark: true,
  bleeding: true,
};

export const DEFAULT_EXPANSION_OPTIONS: Record<string, boolean> = {
  'midnight.crucible_of_erratic_energies_violence': true,
  'midnight.crucible_of_erratic_energies_sustenance': true,
  'midnight.crucible_of_erratic_energies_predation': true,
};

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
      // Active route survives a reload (it's the live sim input, not just config).
      // Read through the never-throw helper so a corrupt value yields null instead
      // of aborting the restores that follow it in this shared try block. fightStyle
      // isn't persisted, so re-assert the route ⇒ DungeonRoute invariant the UI
      // gates on (footer snippets keep the default style — they aren't routes).
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
      _setRaidBuffs(readStoredJson('simhammer_raid_buffs', DEFAULT_RAID_BUFFS));
      _setConsumables(readStoredJson('simhammer_consumables', {}));
      _setExpansionOptions(
        readStoredJson('simhammer_expansion_options', DEFAULT_EXPANSION_OPTIONS)
      );
      const storedRotationMode = localStorage.getItem('simhammer_rotation_mode');
      if (
        storedRotationMode === 'default' ||
        storedRotationMode === 'assisted_combat' ||
        storedRotationMode === 'one_button'
      ) {
        _setRotationMode(storedRotationMode);
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
  // so switching to any other style discards it — keeping "route ⇒ DungeonRoute" a
  // single invariant (with activateRoute/clearRoute) instead of each drawer
  // re-implementing the coupling.
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
      // Scenarios sweep fight styles, but the route's own fight_style=DungeonRoute
      // overrides them at sim time — so they'd silently all run the same route.
      setScenarios([]);
      // A footer snippet may be any SimC (not necessarily a DungeonRoute), so leave
      // the fight style at the default for it; real route kinds force DungeonRoute.
      // Raw setter: switching style here must not discard the route we just set.
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
      }}
    >
      {children}
    </SimContext.Provider>
  );
}
