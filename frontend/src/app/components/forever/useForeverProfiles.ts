'use client';

import { useCallback, useEffect, useState } from 'react';

/** A named set of Forever sim settings. Buffs are toggle ids, so a profile fits every build. */
export interface ForeverProfile {
  name: string;
  fightLength: number;
  iterations: number;
  buffs: string[];
  consumables: boolean;
}

const KEY = 'simhammer_forever_profiles';

function read(): ForeverProfile[] {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((p) => typeof p?.name === 'string') : [];
  } catch {
    return [];
  }
}

/** Forever's own profiles, kept in this browser apart from the retail sim profiles. */
export function useForeverProfiles() {
  const [profiles, setProfiles] = useState<ForeverProfile[]>([]);
  useEffect(() => setProfiles(read()), []);
  const write = useCallback((next: ForeverProfile[]) => {
    setProfiles(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // storage blocked: the profiles last for this visit
    }
  }, []);
  return {
    profiles,
    save: (profile: ForeverProfile) =>
      write(
        [...profiles.filter((p) => p.name !== profile.name), profile].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      ),
    remove: (name: string) => write(profiles.filter((p) => p.name !== name)),
  };
}
