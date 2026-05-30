import { useEffect, useState } from 'react';

const KEY = (simType: string) => `simhammer.compute_choice.${simType}`;

/** Provider id, plus the two special values `"auto"` (let backend decide) and
 *  `"local"`. Any registered remote provider id is also valid; the `RunButton`
 *  menu enumerates them from `useProviders()`. */
export type ComputeChoice = 'auto' | 'local' | string;

export function useComputeChoice(simType: string): [ComputeChoice, (v: ComputeChoice) => void] {
  const [v, setV] = useState<ComputeChoice>('auto');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(KEY(simType));
    if (stored) setV(stored);
  }, [simType]);
  return [
    v,
    (next) => {
      setV(next);
      if (typeof window !== 'undefined') window.localStorage.setItem(KEY(simType), next);
    },
  ];
}
