'use client';

import { useCallback, useEffect, useState } from 'react';

export interface TalentBuild {
  name: string;
  talents_string: string;
}

interface Edits {
  /** Talents edited in the calculator; null runs the export's. */
  edited: string | null;
  /** Builds picked for a compare, besides the export's. */
  builds: TalentBuild[];
}

/** Per pasted export for this session, so Quick Sim and Top Gear share the edits. */
const store = new Map<string, Edits>();
const EMPTY: Edits = { edited: null, builds: [] };

export function useForeverTalents(simcInput: string) {
  const [edits, setEdits] = useState<Edits>(EMPTY);
  useEffect(() => setEdits(store.get(simcInput) ?? EMPTY), [simcInput]);
  const change = useCallback(
    (next: Edits) => {
      store.set(simcInput, next);
      setEdits(next);
    },
    [simcInput]
  );
  return {
    edited: edits.edited,
    builds: edits.builds,
    setEdited: (edited: string | null) => change({ ...edits, edited }),
    addBuild: (build: TalentBuild) =>
      change({
        ...edits,
        builds: [...edits.builds.filter((b) => b.talents_string !== build.talents_string), build],
      }),
    removeBuild: (talents: string) =>
      change({ ...edits, builds: edits.builds.filter((b) => b.talents_string !== talents) }),
  };
}

export type ForeverTalents = ReturnType<typeof useForeverTalents>;
