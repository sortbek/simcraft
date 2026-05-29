/**
 * Frontend route literals. Use the constants here instead of inline string
 * paths so renames and "what pages exist" stay grep-able. Keep paths in sync
 * with the Next.js `app/` directory layout.
 */
export const ROUTES = {
  quickSim: '/quick-sim',
  topGear: '/top-gear',
  dropFinder: '/drop-finder',
  upgradeCompare: '/upgrade-compare',
  advanced: '/advanced',
  sims: '/sims',
  settings: '/settings',
  /** Legacy alias; redirects to `sims`. */
  history: '/history',
} as const;

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
