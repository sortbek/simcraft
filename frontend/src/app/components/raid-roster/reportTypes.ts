import type { ReportItem, ReportItemResult, ReportPlayer } from '../../lib/rosters';

export type ReportViewMode = 'item' | 'matrix';

export interface ReportFilters {
  hideDowngrades: boolean;
  players: string[]; // member_ids to include; empty = all
  slots: string[];   // slot names to include; empty = all
}

export const EMPTY_FILTERS: ReportFilters = { hideDowngrades: false, players: [], slots: [] };

/** member_id -> ReportPlayer for name/class lookup. */
export function playerMap(players: ReportPlayer[]): Map<string, ReportPlayer> {
  return new Map(players.map((p) => [p.member_id, p]));
}

/** Apply player/slot/hideDowngrades filters; drop items whose results all get
 *  filtered out. Returns a NEW array (no mutation of inputs). */
export function filterItems(items: ReportItem[], f: ReportFilters): ReportItem[] {
  const playerSet = new Set(f.players);
  const slotSet = new Set(f.slots);
  const out: ReportItem[] = [];
  for (const item of items) {
    if (slotSet.size > 0 && !slotSet.has(item.slot)) continue;
    let results = item.results;
    if (playerSet.size > 0) results = results.filter((r) => playerSet.has(r.member_id));
    if (f.hideDowngrades) results = results.filter((r) => !r.is_downgrade);
    if (results.length === 0) continue;
    out.push({ ...item, results });
  }
  return out;
}

/** Best (max) upgrade_pct among an item's results (for sorting items). */
export function bestUpgrade(item: ReportItem): number {
  return item.results.reduce((m, r) => Math.max(m, r.upgrade_pct), -Infinity);
}

/** Sort a filtered item list by best upgrade desc. Returns a new array. */
export function sortItemsByBest(items: ReportItem[]): ReportItem[] {
  return [...items].sort((a, b) => bestUpgrade(b) - bestUpgrade(a));
}

/** uid -> (member_id -> result) lookup for the matrix view. Keyed by uid (not
 *  item_id) so a Void Forged variant doesn't collide with its base item. */
export function resultLookup(items: ReportItem[]): Map<string, Map<string, ReportItemResult>> {
  const m = new Map<string, Map<string, ReportItemResult>>();
  for (const item of items) {
    const inner = new Map<string, ReportItemResult>();
    for (const r of item.results) inner.set(r.member_id, r);
    m.set(item.uid, inner);
  }
  return m;
}

/** Tailwind classes for a heat cell given an upgrade %.
 *  big upgrade → strong green … ~0 → neutral … downgrade → red.
 *  `undefined` = item not eligible for that player (blank/muted cell). */
export function heatClasses(pct: number | undefined): string {
  if (pct === undefined) return 'bg-surface-container text-on-surface-variant/40';
  if (pct >= 3) return 'bg-green-500/30 text-green-300';
  if (pct >= 1) return 'bg-green-500/15 text-green-300';
  if (pct > 0) return 'bg-green-500/5 text-green-400/80';
  if (pct === 0) return 'bg-surface-container text-on-surface-variant/60';
  return 'bg-red-500/15 text-red-300';
}
