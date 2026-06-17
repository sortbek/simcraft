/**
 * Frontend route literals. Use these instead of inline path strings so renames
 * stay grep-able. Keep in sync with the Next.js `app/` directory layout.
 */
export const ROUTES = {
  quickSim: '/quick-sim',
  topGear: '/top-gear',
  dropFinder: '/drop-finder',
  dungeonRoute: '/route',
  routesManager: '/routes',
  upgradeCompare: '/upgrade-compare',
  raidRoster: '/raid-roster',
  advanced: '/advanced',
  sims: '/sims',
  settings: '/settings',
  /** Legacy alias; redirects to `sims`. */
  history: '/history',
} as const;

/** sessionStorage key the routes manager uses to hand a serialized `ActiveRoute`
 *  to the `/route` map viewer. Lives here because Next.js page files may not have
 *  extra exports (breaks the `next build` page type check). */
export const MDT_ROUTE_SESSION_KEY = 'simhammer_mdt_route';

/** Result page for a single sim run. */
export function simResultRoute(id: string): string {
  return `/sim/${id}`;
}

/** Prefix used by `matchPaths` to match any `/sim/...` deep link. */
export const SIM_RESULT_PREFIX = '/sim';

/** Is the user currently on any of `paths` (exact match or `path/*` subpage)? */
export function isRouteActive(pathname: string, paths: readonly string[]): boolean {
  return paths.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
