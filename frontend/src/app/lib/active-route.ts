import { decodeMdt, serializeRoute, type CloneRef } from './api';
import { getRouteSimParams } from './route-sim-params';

/** The active dungeon route, held as *data* (not baked SimC) so it can be
 *  materialized at sim time against the currently-chosen keystone level + HP
 *  share. `id`/`name` identify the saved row it came from (absent for a
 *  freshly-imported, unsaved route). Variants:
 *   - `mdt`   — an MDT import string, decoded at sim time.
 *   - `pulls` — a dungeon + pull assignment built/edited on the map.
 *   - `simc`  — a pre-baked SimC block (legacy `simc` rows), used verbatim. */
export type ActiveRoute =
  | { kind: 'mdt'; id?: string; name?: string; mdtString: string }
  | { kind: 'pulls'; id?: string; name?: string; dungeonIdx: number; pulls: CloneRef[][] }
  | { kind: 'simc'; id?: string; name?: string; simc: string };

/** Render the active route to its SimC `DungeonRoute` block at sim time, applying
 *  the current keystone level + HP share (the route itself stays level-agnostic,
 *  so one route sims at any level without re-importing). */
export async function materializeRoute(route: ActiveRoute): Promise<string> {
  switch (route.kind) {
    case 'mdt':
      return (await decodeMdt(route.mdtString, getRouteSimParams())).simc;
    case 'pulls':
      return (await serializeRoute(route.dungeonIdx, route.pulls, getRouteSimParams())).simc;
    case 'simc':
      return route.simc;
  }
}
