import type { SavedRoute } from './saved-routes';
import type { ActiveRoute } from './active-route';
import type { DungeonSummary } from './api';

/** How a saved route is materialized + grouped. `footer` is a legacy pre-MDT
 *  raw SimC footer snippet (mdt_string not starting with `!`). */
export type RouteKind = 'mdt' | 'pulls' | 'simc' | 'footer';

export function classifyRoute(r: SavedRoute): RouteKind {
  if (r.dungeon_idx != null && r.pulls) return 'pulls';
  if (r.simc) return 'simc';
  if (r.mdt_string.startsWith('!')) return 'mdt';
  return 'footer';
}

/** Map a saved route to the in-memory ActiveRoute. Returns null for a legacy
 *  footer route (handled via simcFooter, not activeRoute) or unparseable pulls. */
export function routeToActiveRoute(r: SavedRoute): ActiveRoute | null {
  switch (classifyRoute(r)) {
    case 'pulls':
      try {
        return {
          kind: 'pulls',
          id: r.id,
          name: r.name,
          dungeonIdx: r.dungeon_idx!,
          pulls: JSON.parse(r.pulls!),
        };
      } catch {
        return null;
      }
    case 'simc':
      return { kind: 'simc', id: r.id, name: r.name, simc: r.simc! };
    case 'mdt':
      return { kind: 'mdt', id: r.id, name: r.name, mdtString: r.mdt_string };
    case 'footer':
      return null;
  }
}

/** keystone.guru-style slug: lowercase, non-alphanumeric runs → single `-`. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Read the `enemy="…"` title from a KSG SimC block and match its slug to a
 *  known dungeon. Returns the dungeon idx, or null (→ "Other") when the title is
 *  absent or user-renamed. */
export function detectDungeonFromSimc(
  simc: string,
  dungeons: DungeonSummary[]
): number | null {
  const m = simc.match(/^enemy="([^"]*)"/m);
  if (!m) return null;
  const titleSlug = slugify(m[1]);
  if (!titleSlug) return null;
  const hit = dungeons.find((d) => slugify(d.name) === titleSlug);
  return hit ? hit.idx : null;
}
