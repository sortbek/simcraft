'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { FightScenario } from '../../lib/types';
import { API_URL } from '../../lib/api';

interface SimContextType {
  simcInput: string;
  setSimcInput: (v: string) => void;
  /** Whether simcInput has enough content to be worth sending to the server. */
  hasInput: boolean;
  fightStyle: string;
  setFightStyle: (v: string) => void;
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
  customApl: string;
  setCustomApl: (v: string) => void;
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

function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function readStored(key: string, fallback: number): number {
  const v = localStorage.getItem(key);
  if (v == null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readSessionString(key: string, fallback: string): string {
  return sessionStorage.getItem(key) ?? fallback;
}

export function SimProvider({ children }: { children: ReactNode }) {
  const [simcInput, _setSimcInput] = useState('');
  const [fightStyle, setFightStyle] = useState('Patchwerk');
  const [threads, _setThreads] = useState(0);
  const [selectedTalent, setSelectedTalent] = useState('');
  const [targetCount, setTargetCount] = useState(1);
  const [fightLength, setFightLength] = useState(300);
  const [targetError, _setTargetError] = useState(0.1);
  const [customApl, setCustomApl] = useState('');
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

  useEffect(() => {
    try {
      _setSimcInput(readSessionString('simhammer_simc_input', ''));
      _setThreads(readStored('simhammer_threads', 0));
      const storedError = localStorage.getItem('simhammer_target_error');
      if (storedError != null) {
        const n = parseFloat(storedError);
        if (Number.isFinite(n) && n > 0) _setTargetError(n);
      }
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

  return (
    <SimContext.Provider
      value={{
        simcInput,
        setSimcInput,
        hasInput,
        fightStyle,
        setFightStyle,
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
        customApl,
        setCustomApl,
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
      }}
    >
      {children}
    </SimContext.Provider>
  );
}
