'use client';

import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'simhammer_forever_sd';
const EVENT = 'simhammer-forever-sd';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Whether Forever characters are pictured with their SD (classic) model instead of HD.
 *  Kept per device; every picture of a Forever character follows it. */
export function useForeverSd(): [boolean, (sd: boolean) => void] {
  const sd = useSyncExternalStore(subscribe, read, () => false);
  const setSd = useCallback((next: boolean) => {
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      // Storage blocked: stay on HD.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [sd, setSd];
}
