import { useEffect } from 'react';

declare global {
  interface Window {
    $WowheadPower?: { refreshLinks: () => void };
  }
}

/** Stable key from the three info maps; when it changes, useWowheadTooltips
 * fires refreshLinks() so newly-loaded item/enchant/gem anchors get tooltips. */
export function wowheadKeyFor(maps: {
  item: Record<number, unknown>;
  enchant: Record<number, unknown>;
  gem: Record<number, unknown>;
}): string {
  return [
    Object.keys(maps.item).sort().join(','),
    Object.keys(maps.enchant).sort().join(','),
    Object.keys(maps.gem).sort().join(','),
  ].join('|');
}

export function useWowheadTooltips(deps: unknown[] = []) {
  useEffect(() => {
    let cancelled = false;
    let loadInterval: ReturnType<typeof setInterval> | null = null;

    function refresh() {
      if (window.$WowheadPower) {
        window.$WowheadPower.refreshLinks();
        return true;
      }
      return false;
    }

    // Debounce: deps change in bursts (item-info streams one entry at a time) and
    // refreshLinks() scans the whole DOM, so per-change firing pegs the main thread
    // on large results. Coalesce the burst into one refresh once deps settle.
    const debounce = setTimeout(() => {
      if (cancelled || refresh()) return;
      // Script not loaded yet — retry until it is (up to 5s).
      let attempts = 0;
      loadInterval = setInterval(() => {
        if (cancelled || refresh() || ++attempts >= 25) {
          if (loadInterval) clearInterval(loadInterval);
        }
      }, 200);
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      if (loadInterval) clearInterval(loadInterval);
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
