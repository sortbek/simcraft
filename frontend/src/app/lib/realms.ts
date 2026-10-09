import { useEffect, useMemo, useState } from 'react';
import { blizzardRealmSlug } from './character';

/** A WoW realm as published by the simhammer.com Blizzard proxy. `slug` is the
 *  canonical Blizzard slug (apostrophes dropped, spaces hyphenated) — send it
 *  verbatim as the armory `realm` so the backend doesn't re-slugify a name. */
export interface RealmInfo {
  id: number;
  name: string;
  slug: string;
}

interface RealmsFile {
  regions: Record<string, RealmInfo[]>;
}

/** Realms grouped by region (us/eu/kr/tw). The list is bundled at build time
 *  (`realms.json`, refreshed by `npm run generate:realms`) and lazily code-split,
 *  so the app never calls the realm API at launch. Cached after first access. */
let realmsCache: Promise<Record<string, RealmInfo[]>> | undefined;

export function loadRealms(): Promise<Record<string, RealmInfo[]>> {
  if (!realmsCache) {
    realmsCache = import('./realms.json').then((m) => (m.default as RealmsFile).regions);
  }
  return realmsCache;
}

const compactRealm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Blizzard slug for a SimC `server=` value, which may be compacted
 *  (`twistingnether`) as well as underscored (`grim_batol`). */
export function resolveRealmSlug(realm: string, regions: Record<string, RealmInfo[]>): string {
  const compact = compactRealm(realm);
  for (const list of Object.values(regions)) {
    const hit = list.find((info) => compactRealm(info.slug) === compact);
    if (hit) return hit.slug;
  }
  return blizzardRealmSlug(realm);
}

/** `resolveRealmSlug` once the bundled list has loaded, the plain conversion until then. */
export function useRealmSlug(realm: string | null | undefined): string | undefined {
  const [regions, setRegions] = useState<Record<string, RealmInfo[]> | null>(null);
  useEffect(() => {
    if (!realm) return;
    let cancelled = false;
    loadRealms()
      .then((loaded) => !cancelled && setRegions(loaded))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [realm]);
  return useMemo(() => {
    if (!realm) return undefined;
    return regions ? resolveRealmSlug(realm, regions) : blizzardRealmSlug(realm);
  }, [realm, regions]);
}
