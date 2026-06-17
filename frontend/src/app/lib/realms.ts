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
