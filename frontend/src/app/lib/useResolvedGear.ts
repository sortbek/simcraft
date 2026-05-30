import { useEffect, useState } from 'react';
import { postJson } from './api';
import type { ResolveGearResponse, ResolvedItem } from './types';
import type { GearItem } from '../components/gear/gearOverviewTypes';

interface ResolveOptions {
  /** Minimum trimmed input length before resolving (page-specific). */
  minLength?: number;
  /** Debounce in ms (default 300). */
  debounceMs?: number;
  /** Extra request flags forwarded to POST /api/gear/resolve. */
  maxUpgrade?: boolean;
  catalyst?: boolean;
  voidForge?: boolean;
}

/**
 * Debounced POST /api/gear/resolve. Extracted from the near-identical effects in
 * quick-sim, enchant-gem, and top-gear. Returns the full response (callers map
 * to whatever subset they need) plus a `resolving` flag. Errors resolve to
 * `null` (the gear preview is non-critical) — no silent swallow of unexpected
 * throws beyond that.
 */
export function useResolvedGear(
  simcInput: string,
  options: ResolveOptions = {}
): { resolved: ResolveGearResponse | null; resolving: boolean } {
  const {
    minLength = 10,
    debounceMs = 300,
    maxUpgrade = false,
    catalyst = false,
    voidForge,
  } = options;
  const [resolved, setResolved] = useState<ResolveGearResponse | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (simcInput.trim().length < minLength) {
      setResolved(null);
      setResolving(false);
      return;
    }
    setResolving(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await postJson<ResolveGearResponse>('/api/gear/resolve', {
          simc_input: simcInput,
          max_upgrade: maxUpgrade,
          catalyst,
          ...(voidForge !== undefined ? { void_forge: voidForge } : {}),
        });
        if (!cancelled) setResolved(data);
      } catch {
        if (!cancelled) setResolved(null);
      } finally {
        if (!cancelled) setResolving(false);
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [simcInput, minLength, debounceMs, maxUpgrade, catalyst, voidForge]);

  return { resolved, resolving };
}

/** Map a resolve response to equipped-only ResolvedItem per slot (enchant-gem). */
export function equippedSlots(
  resolved: ResolveGearResponse | null
): Record<string, ResolvedItem> | null {
  if (!resolved) return null;
  const map: Record<string, ResolvedItem> = {};
  for (const [slot, resolution] of Object.entries(resolved.slots)) {
    if (resolution.equipped) map[slot] = resolution.equipped;
  }
  return Object.keys(map).length > 0 ? map : null;
}

/** Map a resolve response to a GearItem map for GearOverview (quick-sim). */
export function equippedGearItems(
  resolved: ResolveGearResponse | null
): Record<string, GearItem> | null {
  if (!resolved) return null;
  const map: Record<string, GearItem> = {};
  for (const [slot, resolution] of Object.entries(resolved.slots)) {
    const eq = resolution.equipped;
    if (eq) {
      map[slot] = {
        slot: eq.slot,
        item_id: eq.item_id,
        ilevel: eq.ilevel,
        name: eq.name,
        bonus_ids: eq.bonus_ids,
        enchant_id: eq.enchant_id || undefined,
        gem_id: eq.gem_id || undefined,
      };
    }
  }
  return Object.keys(map).length > 0 ? map : null;
}
