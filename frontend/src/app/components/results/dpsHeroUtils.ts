import { useEffect, useState } from 'react';

export const FACTION_ICONS: Record<string, string> = {
  alliance: '/api/data/static/faction-alliance.png',
  horde: '/api/data/static/faction-horde.png',
};

export const FACTION_BGS: Record<string, string> = {
  alliance: '/api/data/static/faction-bg-alliance.jpg',
  horde: '/api/data/static/faction-bg-horde.jpg',
};

export function useFaction(realm?: string, name?: string, region = 'eu'): string | null {
  const [faction, setFaction] = useState<string | null>(null);

  useEffect(() => {
    if (!realm || !name) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `https://simhammer.com/api/blizzard/character/${region}/${encodeURIComponent(
            realm.toLowerCase()
          )}/${encodeURIComponent(name.toLowerCase())}/profile`
        );
        if (!res.ok || cancelled) {
          return;
        }
        const data = await res.json();
        if (!cancelled && data.faction) {
          setFaction(data.faction);
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [realm, name, region]);

  return faction;
}

export function getCharacterMediaUrl(
  realm: string | undefined,
  name: string | undefined,
  type: 'inset' | 'render',
  region = 'eu'
): string | null {
  if (!realm || !name) {
    return null;
  }

  return `https://simhammer.com/api/blizzard/character/${region}/${encodeURIComponent(
    realm.toLowerCase()
  )}/${encodeURIComponent(name.toLowerCase())}/media/${type}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const min = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, '0');
  return `${min}:${sec}`;
}

export function formatElapsed(seconds: number): string {
  if (seconds >= 60) {
    return formatDuration(seconds);
  }
  return `${seconds.toFixed(1)}s`;
}
