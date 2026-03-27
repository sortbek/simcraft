import { useEffect } from 'react';

declare global {
  interface Window {
    $WowheadPower?: { refreshLinks: () => void };
  }
}

export function useWowheadTooltips(deps: unknown[] = []) {
  useEffect(() => {
    function refresh() {
      if (window.$WowheadPower) {
        window.$WowheadPower.refreshLinks();
        return true;
      }
      return false;
    }

    // Try immediately, then retry until the script loads (up to 5s)
    if (refresh()) return;
    let attempts = 0;
    const interval = setInterval(() => {
      if (refresh() || ++attempts >= 25) {
        clearInterval(interval);
      }
    }, 200);
    return () => clearInterval(interval);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
