import { useEffect, useMemo, useState } from 'react';

const iconCache = new Map<number, string>();

export function useSpellIcons(spellIds: number[]) {
  const [icons, setIcons] = useState<Map<number, string>>(new Map());
  const depKey = useMemo(() => spellIds.join(','), [spellIds]);

  useEffect(() => {
    const missing = spellIds.filter((id) => id > 0 && !iconCache.has(id));
    if (missing.length === 0) {
      setIcons(new Map(iconCache));
      return;
    }

    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        try {
          const res = await fetch(`https://nether.wowhead.com/tooltip/spell/${id}?dataEnv=1&locale=0`);
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
      }),
    ).then(() => {
      if (!cancelled) {
        setIcons(new Map(iconCache));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [depKey, spellIds]);

  return icons;
}
