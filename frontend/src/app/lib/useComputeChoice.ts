import { useEffect, useState } from 'react';

const KEY = (simType: string) => `simhammer.compute_choice.${simType}`;

export type ComputeChoice = 'auto' | 'local' | 'simmit';

export function useComputeChoice(simType: string): [ComputeChoice, (v: ComputeChoice) => void] {
  const [v, setV] = useState<ComputeChoice>('auto');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(KEY(simType)) as ComputeChoice | null;
    if (stored === 'auto' || stored === 'local' || stored === 'simmit') setV(stored);
  }, [simType]);
  return [
    v,
    (next) => {
      setV(next);
      if (typeof window !== 'undefined') window.localStorage.setItem(KEY(simType), next);
    },
  ];
}
