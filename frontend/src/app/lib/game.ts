'use client';

import { useEffect, useState } from 'react';

export type Game = 'retail' | 'forever';

export const GAME_STORAGE_KEY = 'simhammer_game';

/** Same rule as the backend: a 1.x client or a TOC below 20000 is WoW Forever. */
export function detectGame(simcInput: string): Game {
  // The MythicSim addon's JSON export only exists for Forever.
  if (/^\s*\{/.test(simcInput) && simcInput.includes('"mythicsim"')) return 'forever';
  const m = simcInput.match(/^#\s*WoW\s+(\d+)\.[^,\n]*,\s*TOC\s+(\d+)/m);
  if (!m) return 'retail';
  return Number(m[1]) === 1 || Number(m[2]) < 20000 ? 'forever' : 'retail';
}

const read = (): Game =>
  typeof document !== 'undefined' && document.documentElement.dataset.game === 'forever'
    ? 'forever'
    : 'retail';

/** The active game from `<html data-game>` (SimContext keeps it current), for components
 *  that may render outside SimProvider. */
export function useGame(): Game {
  const [game, setGame] = useState<Game>('retail');
  useEffect(() => {
    setGame(read());
    const observer = new MutationObserver(() => setGame(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-game'],
    });
    return () => observer.disconnect();
  }, []);
  return game;
}
