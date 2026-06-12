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

/** Display stats for a route card. `pulls`/`enemies` are derived where free —
 *  built routes from their pull JSON, KSG routes by parsing the SimC — and left
 *  null for MDT imports (which would need a decode). `source` labels the origin. */
export function routeStats(r: SavedRoute): {
  source: string;
  pulls: number | null;
  enemies: number | null;
} {
  const kind = classifyRoute(r);
  if (kind === 'pulls') {
    try {
      const pulls = JSON.parse(r.pulls!) as unknown[][];
      return {
        source: 'MDT',
        pulls: pulls.length,
        enemies: pulls.reduce((s: number, p: unknown[]) => s + p.length, 0),
      };
    } catch {
      return { source: 'MDT', pulls: null, enemies: null };
    }
  }
  if (kind === 'simc') {
    const lines = r.simc!.split('\n').filter((l) => l.startsWith('raid_events+=/pull'));
    const enemies = lines.reduce((s, l) => {
      const m = l.match(/enemies=(.*)$/);
      return s + (m ? m[1].split('|').length : 0);
    }, 0);
    return { source: 'keystone.guru', pulls: lines.length || null, enemies: enemies || null };
  }
  return { source: kind === 'mdt' ? 'MDT' : 'SimC', pulls: null, enemies: null };
}

/** Stable non-negative integer seed from a route id, so a card's deterministic
 *  thumbnail looks the same across renders. */
export function seedFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 2147483647 || 1;
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
