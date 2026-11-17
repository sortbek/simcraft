'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ForeverSimOptions } from './types';

interface Choice {
  on: string[];
  consumables: boolean;
}

/** Choices per build for this session, so Quick Sim and Top Gear show the same ones. */
const chosen = new Map<string, Choice>();

function defaultsOf(options: ForeverSimOptions): Choice {
  return {
    on: options.toggles.filter((t) => t.on).map((t) => t.id),
    consumables: options.consumables,
  };
}

/** Which buffs and debuffs a Forever sim runs with; starts at the build's own set. */
export function useForeverBuffs(options: ForeverSimOptions | null) {
  const [choice, setChoice] = useState<Choice | null>(null);
  useEffect(() => {
    setChoice(options ? (chosen.get(options.build) ?? defaultsOf(options)) : null);
  }, [options]);

  const change = useCallback(
    (next: Choice) => {
      if (!options) return;
      chosen.set(options.build, next);
      setChoice(next);
    },
    [options]
  );

  return useMemo(() => {
    if (!options || !choice) return null;
    const on = new Set(choice.on);
    const defaults = defaultsOf(options);
    const isDefault =
      choice.consumables === defaults.consumables &&
      on.size === defaults.on.length &&
      defaults.on.every((id) => on.has(id));
    return {
      toggles: options.toggles,
      on,
      consumables: choice.consumables,
      isDefault,
      toggle: (id: string) =>
        change({
          ...choice,
          on: on.has(id) ? choice.on.filter((x) => x !== id) : [...choice.on, id],
        }),
      setAll: (all: boolean) =>
        change({ ...choice, on: all ? options.toggles.map((t) => t.id) : [] }),
      setConsumables: (consumables: boolean) => change({ ...choice, consumables }),
      reset: () => change(defaults),
      /** A saved profile's set; ids this build does not list are dropped. */
      apply: (ids: string[], consumables: boolean) =>
        change({
          on: options.toggles.map((t) => t.id).filter((id) => ids.includes(id)),
          consumables,
        }),
      /** What the sim request carries. */
      payload: { buffs: choice.on, consumables: choice.consumables },
    };
  }, [options, choice, change]);
}

export type ForeverBuffs = NonNullable<ReturnType<typeof useForeverBuffs>>;
