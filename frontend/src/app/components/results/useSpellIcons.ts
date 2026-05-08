import { useEffect, useMemo, useState } from 'react';

const iconCache = new Map<number, string>();

export function useSpellIcons(spellIds: number[]) {
  const [icons, setIcons] = useState<Map<number, string>>(new Map());
  const depKey = useMemo(() => spellIds.join(','), [spellIds]);

  useEffect(() => {
    const ids = depKey ? depKey.split(',').map(Number) : [];
    const missing = ids.filter((id) => id > 0 && !iconCache.has(id));
    if (missing.length === 0) {
      setIcons((prev) => {
        // Only update if there are new entries the component doesn't have yet
        const needsUpdate = ids.some((id) => id > 0 && iconCache.has(id) && !prev.has(id));
        return needsUpdate || prev.size === 0 ? new Map(iconCache) : prev;
      });
      return;
    }

    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        try {
          const res = await fetch(
            `https://nether.wowhead.com/tooltip/spell/${id}?dataEnv=1&locale=0`
          );
          if (!res.ok) {
            return;
          }
          const data = await res.json();
          if (data.icon) {
            iconCache.set(id, data.icon);
          }
        } catch {
          // ignore
        }
      })
    ).then(() => {
      if (!cancelled) {
        setIcons(new Map(iconCache));
      }
    });

    return () => {
      cancelled = true;
    };
    // depKey is a stable string derived from spellIds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  return icons;
}
