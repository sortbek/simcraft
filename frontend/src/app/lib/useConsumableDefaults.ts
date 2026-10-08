'use client';

import { useEffect, useState } from 'react';
import { useSimContext } from '../components/sim-config/SimContext';
import { apiUrl, fetchJsonOr } from './api';
import { specOverrideOf } from './useSharedSimPayload';

/** Consumable slot -> the SimC value Auto resolves to for this character;
 *  'disabled' where SimC uses none (e.g. a talent replaces the weapon oil). */
export type ConsumableDefaults = Record<string, string>;

// One request per export and talent build: the Sim settings pickers, their
// collapsed summary and Top Gear's Consumables tab all ask for the same one.
const cache = new Map<string, Promise<ConsumableDefaults | null>>();

/** What SimC picks for each Auto consumable slot for the selected talent build
 *  (its spec defaults, and the few talent-dependent weapon oils), or null until
 *  known or when the server can't tell (e.g. no local SimC). */
export function useConsumableDefaults(): ConsumableDefaults | null {
  const { simcInput, selectedTalent: talents } = useSimContext();
  const specOverride = specOverrideOf(talents);
  const [defaults, setDefaults] = useState<ConsumableDefaults | null>(null);
  useEffect(() => {
    setDefaults(null);
    if (!simcInput.trim()) return;
    let alive = true;
    const key = JSON.stringify([simcInput, talents, specOverride]);
    let request = cache.get(key);
    if (!request) {
      request = fetchJsonOr<{ defaults?: Record<string, string | null> } | null>(
        apiUrl('/api/consumables/defaults'),
        null,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            simc_input: simcInput,
            talents,
            spec_override: specOverride,
          }),
        }
      ).then((r) => {
        if (!r?.defaults) {
          cache.delete(key); // let a later mount retry
          return null;
        }
        return Object.fromEntries(
          Object.entries(r.defaults).map(([slot, value]) => [slot, value || 'disabled'])
        );
      });
      cache.set(key, request);
    }
    request.then((d) => alive && setDefaults(d));
    return () => {
      alive = false;
    };
  }, [simcInput, talents, specOverride]);
  return defaults;
}
