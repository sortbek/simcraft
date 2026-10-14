'use client';

import { useCallback, useSyncExternalStore } from 'react';

let picked: { input: string; key: string } | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The spec picked for this paste, shared by the pages and the top bar; the derived
 *  spec until one is picked, and again once the paste changes. */
export function useForeverSpec(
  simcInput: string,
  derived: string | null
): [string | null, (key: string) => void] {
  const pick = useSyncExternalStore(
    subscribe,
    () => picked,
    () => null
  );
  const setSpecKey = useCallback(
    (key: string) => {
      picked = { input: simcInput, key };
      listeners.forEach((l) => l());
    },
    [simcInput]
  );
  return [pick && pick.input === simcInput ? pick.key : derived, setSpecKey];
}
