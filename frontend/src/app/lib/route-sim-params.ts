import { readStoredPositiveInt } from './storage';

/** Parameters for materializing a DungeonRoute into a SimC string. These belong
 *  to the route-generation concern (not the general sim config): the keystone
 *  level the enemy health scales to, and the player's share of enemy HP — the
 *  fraction the simmed actor must kill. They're persisted so the choice carries
 *  across importing and loading saved routes. Defaults match keystone.guru
 *  (level 10, hp 27 — "your % of the group's damage"). */
const LEVEL_KEY = 'simhammer_route_keystone_level';
const HP_KEY = 'simhammer_route_hp_percent';

export interface RouteSimParams {
  keystoneLevel: number;
  hpPercent: number;
}

export function getRouteSimParams(): RouteSimParams {
  if (typeof window === 'undefined') return { keystoneLevel: 10, hpPercent: 27 };
  return {
    keystoneLevel: readStoredPositiveInt(LEVEL_KEY, 10),
    hpPercent: readStoredPositiveInt(HP_KEY, 27),
  };
}

export function setRouteSimParams(p: Partial<RouteSimParams>): void {
  try {
    if (p.keystoneLevel != null) localStorage.setItem(LEVEL_KEY, String(p.keystoneLevel));
    if (p.hpPercent != null) localStorage.setItem(HP_KEY, String(p.hpPercent));
  } catch {}
}
