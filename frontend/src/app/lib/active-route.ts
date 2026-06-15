import { decodeMdt, serializeRoute, type CloneRef } from './api';
import { getRouteSimParams } from './route-sim-params';

/** The active dungeon route, held as *data* (not baked SimC) so it materializes
 *  at sim time against the chosen keystone level + HP share. `id`/`name` identify
 *  the saved row (absent for a freshly-imported, unsaved route). Variants:
 *   - `mdt`    — MDT import string, decoded at sim time.
 *   - `pulls`  — dungeon + pull assignment built/edited on the map.
 *   - `simc`   — pre-baked keystone.guru SimC DungeonRoute block, used verbatim.
 *   - `footer` — legacy raw SimC footer snippet, used verbatim; may not be a
 *                DungeonRoute, so it doesn't force the fight style. */
export type ActiveRoute =
  | { kind: 'mdt'; id?: string; name?: string; mdtString: string }
  | { kind: 'pulls'; id?: string; name?: string; dungeonIdx: number; pulls: CloneRef[][] }
  | { kind: 'simc'; id?: string; name?: string; simc: string }
  | { kind: 'footer'; id?: string; name?: string; simc: string };

/** Render the active route to its SimC `DungeonRoute` block at sim time, applying
 *  the current keystone level + HP share. The route stays level-agnostic, so one
 *  route sims at any level without re-importing. */
export async function materializeRoute(route: ActiveRoute): Promise<string> {
  switch (route.kind) {
    case 'mdt':
      return (await decodeMdt(route.mdtString, getRouteSimParams())).simc;
    case 'pulls':
      return (await serializeRoute(route.dungeonIdx, route.pulls, getRouteSimParams())).simc;
    case 'simc':
    case 'footer':
      return route.simc;
  }
}
