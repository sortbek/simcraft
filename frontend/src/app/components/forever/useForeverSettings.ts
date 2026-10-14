'use client';

import { useEffect, useState } from 'react';

const KEY = 'simhammer_forever_settings';
export const FIGHT_LENGTHS = [60, 120, 180, 300];
export const ITERATIONS = [5000, 12500, 25000, 50000];

/** Forever's own fight length and iterations (the engine site's defaults), kept apart from
 *  the retail sim profile. */
export function useForeverSettings() {
  const [fightLength, setFightLength] = useState(120);
  const [iterations, setIterations] = useState(12500);
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      if (FIGHT_LENGTHS.includes(s.fightLength)) setFightLength(s.fightLength);
      if (ITERATIONS.includes(s.iterations)) setIterations(s.iterations);
    } catch {
      // defaults
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ fightLength, iterations }));
    } catch {
      // storage blocked
    }
  }, [fightLength, iterations]);
  return { fightLength, setFightLength, iterations, setIterations };
}
