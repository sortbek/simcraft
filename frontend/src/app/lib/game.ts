'use client';

import { useEffect, useState } from 'react';

export type Game = 'retail' | 'forever';

export const GAME_STORAGE_KEY = 'simhammer_game';

/** The realm under which simhammer.com's character API finds a Forever character, by name and
 *  surname (Forever has no realms). */
export const FOREVER_REALM = 'forever';

export type ForeverRuleset = 'normal' | 'pvp' | 'roleplay' | 'roleplayPvp';

/** A Forever realm's ruleset, from the words in its server slug (`camwow_eu5_realm_6_pvp`). */
export function foreverRuleset(server: string): ForeverRuleset {
  const words = server.toLowerCase().split(/[_\s-]+/);
  const pvp = words.includes('pvp') || words.includes('rppvp');
  const rp = words.some((w) => w === 'rp' || w === 'roleplay' || w === 'rppvp');
  return rp ? (pvp ? 'roleplayPvp' : 'roleplay') : pvp ? 'pvp' : 'normal';
}

/** Same rule as the backend's `detect_game`: a `# WoW` header in the first 20 lines with a 1.x
 *  client, or a TOC below 20000, is WoW Forever. */
export function detectGame(simcInput: string): Game {
  // The MythicSim addon's JSON export only exists for Forever.
  if (/^\s*\{/.test(simcInput) && simcInput.includes('"mythicsim"')) return 'forever';
  const header = simcInput
    .split(/\r?\n/, 20)
    .map((line) => line.trim())
    .find((line) => line.startsWith('# WoW '));
  if (!header) return 'retail';
  const rest = header.slice('# WoW '.length);
  const number = (part: string | undefined) =>
    part !== undefined && /^\d+$/.test(part.trim()) ? Number(part.trim()) : null;
  const toc = number(rest.split('TOC')[1]);
  return number(rest.split('.')[0]) === 1 || (toc !== null && toc < 20000) ? 'forever' : 'retail';
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
