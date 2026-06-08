import { useEffect } from 'react';

declare global {
  interface Window {
    $WowheadPower?: { refreshLinks: () => void };
  }
}

/** Produces a stable cache-busting key from the three info maps. When the key
 * changes, `useWowheadTooltips` fires a refreshLinks() call so newly-loaded
 * item/enchant/gem anchors pick up their tooltips. */
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

    // Debounce: deps often change in a burst (e.g. item-info streaming in one
    // entry at a time). refreshLinks() scans the whole DOM, so firing it per
    // change pegs the main thread on large results. Coalesce the burst into a
    // single refresh once deps settle.
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
