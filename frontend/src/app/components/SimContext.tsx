'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { FightScenario } from '../lib/types';

interface SimContextType {
  simcInput: string;
  setSimcInput: (v: string) => void;
  fightStyle: string;
  setFightStyle: (v: string) => void;
  threads: number;
  setThreads: (v: number) => void;
  maxCombinations: number | undefined;
  setMaxCombinations: (v: number | undefined) => void;
  selectedTalent: string;
  setSelectedTalent: (v: string) => void;
  targetCount: number;
  setTargetCount: (v: number) => void;
  fightLength: number;
  setFightLength: (v: number) => void;
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
  // Multi-sim scenarios
  scenarios: FightScenario[];
  addScenario: () => void;
  removeScenario: (id: string) => void;
  clearScenarios: () => void;
}

const SimContext = createContext<SimContextType | null>(null);

export function useSimContext() {
  const ctx = useContext(SimContext);
  if (!ctx) throw new Error('useSimContext must be used within SimProvider');
  return ctx;
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
  const [maxCombinations, _setMaxCombinations] = useState<number | undefined>(undefined);
  const [selectedTalent, setSelectedTalent] = useState('');
  const [targetCount, setTargetCount] = useState(1);
  const [fightLength, setFightLength] = useState(300);
  const [customApl, setCustomApl] = useState('');
  const [simcHeader, setSimcHeader] = useState('');
  const [simcBasePlayer, setSimcBasePlayer] = useState('');
  const [simcRaidActors, setSimcRaidActors] = useState('');
  const [simcPostCombos, setSimcPostCombos] = useState('');
  const [simcFooter, setSimcFooter] = useState('');
  const [scenarios, setScenarios] = useState<FightScenario[]>([]);

  useEffect(() => {
    try {
      _setSimcInput(readSessionString('simhammer_simc_input', ''));
      _setThreads(readStored('simhammer_threads', 0));
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

  const setThreads = useCallback((v: number) => {
    _setThreads(v);
    try {
      localStorage.setItem('simhammer_threads', String(v));
    } catch {}
  }, []);

  const setMaxCombinations = useCallback((v: number | undefined) => {
    _setMaxCombinations(v);
    try {
      if (v == null) {
        localStorage.removeItem('simhammer_max_combinations');
      } else {
        localStorage.setItem('simhammer_max_combinations', String(v));
      }
    } catch {}
  }, []);

  return (
    <SimContext.Provider
      value={{
        simcInput,
        setSimcInput,
        fightStyle,
        setFightStyle,
        threads,
        setThreads,
        maxCombinations,
        setMaxCombinations,
        selectedTalent,
        setSelectedTalent,
        targetCount,
        setTargetCount,
        fightLength,
        setFightLength,
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
