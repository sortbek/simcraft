import { useEffect, useRef } from 'react';
import type React from 'react';

/**
 * Run `poll` immediately then repeatedly, only while the tab is visible.
 * `poll` returns the delay (ms) until the next run, or null/undefined to STOP
 * (e.g. terminal state). Hidden tab stops rescheduling; on visibilitychange
 * back to visible it fires again. `enabled=false` disables; `deps` restart it.
 */
export function usePollWhileVisible(
  poll: () => Promise<number | null | undefined> | number | null | undefined,
  enabled: boolean,
  deps: React.DependencyList
) {
  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (!active) return;
      const next = await pollRef.current();
      if (!active || next == null || document.hidden) return;
      timer = setTimeout(tick, next);
    };
    const onVisibility = () => {
      if (active && !document.hidden) tick();
    };

    tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
