import { readStoredPositiveInt } from './storage';

/** Params for materializing a DungeonRoute into SimC: keystone level the enemy
 *  health scales to, and the player's share of enemy HP (fraction the actor must
 *  kill). Persisted so the choice carries across importing/loading saved routes.
 *  Defaults match keystone.guru (level 10, hp 27 = "your % of group damage"). */
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
