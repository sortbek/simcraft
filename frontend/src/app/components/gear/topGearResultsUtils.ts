import { toGemIdList, type GemInfo, type ItemQuery } from '../../lib/useItemInfo';
import type { GearItem } from './GearOverview';
import type { GroupMode, ResultItem, TopGearResult } from './topGearResultsTypes';
import { blizzardRealmSlug } from '../../lib/character';

const GEAR_ORDER_LEFT = ['head', 'neck', 'shoulder', 'back', 'chest', 'wrist'];
const GEAR_ORDER_RIGHT = [
  'hands',
  'waist',
  'legs',
  'feet',
  'finger1',
  'finger2',
  'trinket1',
  'trinket2',
];
const GEAR_ORDER_BOTTOM = ['main_hand', 'off_hand'];
const ALL_SLOTS = [...GEAR_ORDER_LEFT, ...GEAR_ORDER_RIGHT, ...GEAR_ORDER_BOTTOM];

export function gemBadgeClass(name?: string): string {
  if (!name) return 'bg-gem/10 text-gem';
  const lower = name.toLowerCase();
  if (lower.includes('garnet')) return 'bg-negative/10 text-negative';
  if (lower.includes('amethyst')) return 'bg-quality-epic/10 text-quality-epic';
  if (lower.includes('peridot')) return 'bg-positive/10 text-positive';
  if (lower.includes('lapis')) return 'bg-quality-rare/10 text-quality-rare';
  if (lower.includes('diamond') || lower.includes('eversong')) {
    return 'bg-warning/10 text-warning';
  }
  return 'bg-gem/10 text-gem';
}

export function dedupeEncounterResults(
  results: TopGearResult[],
  hasEncounterData: boolean
): TopGearResult[] {
  if (!hasEncounterData) {
    return results;
  }

  const bestByItem = new Map<string, TopGearResult>();
  for (const result of results) {
    const item = result.items[0];
    if (!item) {
      continue;
    }

    // Keyed on every item the combo moves, not just the drop. Slot matters: a
    // ring/trinket is simmed in BOTH slots (finger1 vs finger2, trinket1 vs
    // trinket2) and each is a distinct result — they must NOT collapse into one
    // row, or the better slot's verdict hides the other's (matches the per-slot
    // breakdown shown by Raidbots). Same for the catalyst source: two sources
    // convert to the same tier piece but sim different secondaries. And the
    // swapped trinket pair lands the drop in the same slot as the plain combo
    // for that slot while also moving the partner, so the partner is what tells
    // those two gear sets apart.
    const key = [
      item.encounter || '',
      ...result.items.map(
        (moved) =>
          `${moved.item_id}_${moved.ilevel}_${moved.slot || ''}_${moved.source_item_id || ''}`
      ),
    ].join('|');
    const existing = bestByItem.get(key);
    if (!existing || result.dps > existing.dps) {
      bestByItem.set(key, result);
    }
  }

  return [...bestByItem.values()].sort((a, b) => b.delta - a.delta);
}

export function groupResults(
  activeResults: TopGearResult[],
  groupMode: GroupMode
): Array<[string, TopGearResult[]]> | null {
  if (groupMode === 'rank') {
    return null;
  }

  const groups: Record<string, TopGearResult[]> = {};
  for (const result of activeResults) {
    const key =
      groupMode === 'slot'
        ? result.items[0]?.slot || 'Unknown'
        : result.items[0]?.encounter || 'Unknown';
    groups[key] ??= [];
    groups[key].push(result);
  }

  return Object.entries(groups).sort(([, a], [, b]) => {
    const bestA = a[0]?.delta ?? 0;
    const bestB = b[0]?.delta ?? 0;
    return bestB - bestA;
  });
}

export function buildBestGearSet(
  equippedGear: Record<string, ResultItem> | undefined,
  selectedResult: TopGearResult | null
): Record<string, GearItem> {
  if (!equippedGear) {
    return {};
  }

  const gearSet: Record<string, GearItem> = {};
  for (const slot of ALL_SLOTS) {
    if (equippedGear[slot]) {
      gearSet[slot] = { ...equippedGear[slot] };
    }
  }

  if (!selectedResult) {
    return gearSet;
  }

  // SimC's gear report omits stat-less items (`gear_to_json` skips !has_stats),
  // so a worn pure-effect trinket never reaches `equippedGear`; the combo's kept
  // row still carries it.
  for (const item of selectedResult.items) {
    if (!item.type && item.is_kept && item.slot && item.item_id > 0 && !gearSet[item.slot]) {
      gearSet[item.slot] = { ...item };
    }
  }

  for (const item of selectedResult.items) {
    if (item.type) {
      continue;
    }
    if (!item.is_kept && item.slot === 'off_hand' && item.item_id === 0) {
      delete gearSet.off_hand;
      continue;
    }
    if (!item.is_kept && item.item_id > 0) {
      gearSet[item.slot] = { ...item };
    }
  }

  // Multi-socket items emit one `type:gem` per socket; collect per slot so consumers
  // render every gem, not just the last assigned.
  const gemsBySlot: Record<string, number[]> = {};
  for (const item of selectedResult.items) {
    if (item.type === 'gem' && item.gem_id && item.slot && gearSet[item.slot]) {
      (gemsBySlot[item.slot] ??= []).push(item.gem_id);
    }
  }
  for (const [slot, gemIds] of Object.entries(gemsBySlot)) {
    gearSet[slot] = { ...gearSet[slot], gem_id: gemIds[0], gem_ids: gemIds };
  }

  // Enchant overrides: combos emit a `type:enchant` delta per changed slot; apply like gems
  // so the overview reflects the selected row's enchant.
  for (const item of selectedResult.items) {
    if (item.type === 'enchant' && item.enchant_id && item.slot && gearSet[item.slot]) {
      gearSet[item.slot] = { ...gearSet[item.slot], enchant_id: item.enchant_id };
    }
  }

  return gearSet;
}

/** Slots whose materialized items differ between two gear sets (item, level, bonuses, gems, or enchant). */
export function diffGearSets(
  a: Record<string, GearItem>,
  b: Record<string, GearItem>
): Set<string> {
  const itemKey = (item?: GearItem) =>
    item
      ? [
          item.item_id,
          item.ilevel,
          item.enchant_id ?? 0,
          toGemIdList(item).join(':'),
          [...(item.bonus_ids ?? [])].sort((x, y) => x - y).join(':'),
          // Catalyst source and missives change the simmed stats without
          // changing the item id — same-looking slots can still differ.
          item.source_item_id ?? 0,
          (item.crafted_stats ?? []).join(':'),
          item.embellishment?.id ?? 0,
        ].join('|')
      : '';

  const slots = new Set<string>();
  for (const slot of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (itemKey(a[slot]) !== itemKey(b[slot])) {
      slots.add(slot);
    }
  }
  return slots;
}

function collectChangedSlots(
  result: TopGearResult | null,
  include: (delta: number) => boolean
): Set<string> {
  const slots = new Set<string>();
  if (!result || !include(result.delta)) {
    return slots;
  }

  for (const item of result.items) {
    if (!item.is_kept && item.item_id > 0) {
      slots.add(item.slot);
    }
    if ((item.type === 'gem' || item.type === 'enchant') && item.slot) {
      slots.add(item.slot);
    }
  }

  return slots;
}

export function collectUpgradeSlots(result: TopGearResult | null): Set<string> {
  return collectChangedSlots(result, (delta) => delta > 0);
}

export function collectDowngradeSlots(result: TopGearResult | null): Set<string> {
  return collectChangedSlots(result, (delta) => delta < 0);
}

export function collectItemQueries(
  results: TopGearResult[],
  equippedGear?: Record<string, ResultItem>
): ItemQuery[] {
  const seen = new Set<string>();
  const queries: ItemQuery[] = [];

  const addItem = (item: { item_id: number; bonus_ids?: number[] }) => {
    if (item.item_id <= 0) {
      return;
    }

    const bonusIds = [...(item.bonus_ids || [])].sort((a, b) => a - b);
    const key = `${item.item_id}:${bonusIds.join(':')}`;
    if (!seen.has(key)) {
      seen.add(key);
      queries.push({ item_id: item.item_id, bonus_ids: item.bonus_ids });
    }
  };

  for (const result of results) {
    for (const item of result.items) {
      addItem(item);
      // A catalyst row names the drop it came from, so that item needs info too
      // even though nothing is simmed under its id. Bonus ids are the tier
      // piece's, not the source's — name and icon are all this lookup is for.
      // Only a catalyst has an origin: a Void Forged row points the same field
      // at itself, and a bare duplicate of its own id would come back without
      // the forged bonuses and overwrite it in a map keyed by item id.
      if (item.is_catalyst && item.source_item_id) addItem({ item_id: item.source_item_id });
    }
  }

  if (equippedGear) {
    for (const item of Object.values(equippedGear)) {
      addItem(item);
    }
  }

  return queries;
}

function collectIds(
  results: TopGearResult[],
  equippedGear: Record<string, ResultItem> | undefined,
  pick: (item: ResultItem) => number | number[] | undefined
): number[] {
  const ids = new Set<number>();

  const addId = (picked?: number | number[]) => {
    for (const id of Array.isArray(picked) ? picked : [picked]) {
      if (id && id > 0) {
        ids.add(id);
      }
    }
  };

  for (const result of results) {
    for (const item of result.items) {
      addId(pick(item));
    }
  }

  if (equippedGear) {
    for (const item of Object.values(equippedGear)) {
      addId(pick(item));
    }
  }

  return [...ids];
}

export function collectEnchantIds(
  results: TopGearResult[],
  equippedGear?: Record<string, ResultItem>
): number[] {
  return collectIds(results, equippedGear, (item) => item.enchant_id);
}

/** Gems a drop is simmed with — `gem_ids` when present (necks and crafted gear
 *  hold more than one), else the single `gem_id`. Ids whose info has not arrived
 *  yet are dropped rather than drawn as blanks. */
export function appliedGems(
  item: Pick<ResultItem, 'gem_id' | 'gem_ids'>,
  gemInfoMap: Record<number, GemInfo>
): GemInfo[] {
  return toGemIdList(item)
    .map((id) => gemInfoMap[id])
    .filter((gem): gem is GemInfo => !!gem);
}

export function collectGemIds(
  results: TopGearResult[],
  equippedGear?: Record<string, ResultItem>
): number[] {
  // A row draws one chip per socket, so every gem needs its info — `gem_id`
  // alone only ever covers the first.
  return collectIds(results, equippedGear, toGemIdList);
}

export function getCharacterRenderUrl(
  playerRealm?: string,
  playerName?: string,
  playerRegion = 'eu'
): string | null {
  if (!playerRealm || !playerName) {
    return null;
  }

  return `https://simhammer.com/api/blizzard/character/${playerRegion}/${encodeURIComponent(
    blizzardRealmSlug(playerRealm)
  )}/${encodeURIComponent(playerName.toLowerCase())}/media/render`;
}

/** Blizzard's small face portrait of a character. */
export function getCharacterAvatarUrl(
  playerRealm?: string | null,
  playerName?: string | null,
  playerRegion = 'eu'
): string | null {
  const render = getCharacterRenderUrl(
    playerRealm ?? undefined,
    playerName ?? undefined,
    playerRegion
  );
  return render && render.replace(/\/render$/, '/avatar');
}

/** What one source (boss, dungeon, vendor) is worth across everything it drops. */
export interface EncounterSummaryRow {
  encounter: string;
  /** Raid or dungeon the encounter sits in. Absent on results simmed before the
   *  droptimizer started carrying it. */
  instance?: string;
  results: TopGearResult[];
  /** Every combination simmed for this source, best first — what the row shows
   *  when expanded, as opposed to the per-item strip in `results`. */
  combos: TopGearResult[];
  /** What an unknown drop from here is worth: the mean over the items that can
   *  drop, each valued at the best it can become. A downgrade contributes
   *  nothing rather than dragging the average negative, because nobody is
   *  forced to equip it. */
  expected: number;
  best: number;
  /** Sources too close to separate share a number. */
  priority: number;
}

export type SummarySort = 'expected' | 'best';

/** One row per item, keeping the slot it is worth most in. A ring or trinket is
 *  simmed in both of its slots, but only one of those is ever equipped — so the
 *  worse slot must not count as a second outcome when averaging a source. Keyed
 *  like `dedupeEncounterResults` minus the slot, so catalyst and Void Forge
 *  variants stay distinct items rather than collapsing into their base. */
export function bestPerItem(results: TopGearResult[]): TopGearResult[] {
  const best = new Map<string, TopGearResult>();
  for (const result of results) {
    const item = result.items[0];
    if (!item) continue;
    const key = `${item.item_id}_${item.ilevel}_${item.encounter || ''}_${item.source_item_id || ''}`;
    const existing = best.get(key);
    if (!existing || result.delta > existing.delta) best.set(key, result);
  }
  return [...best.values()].sort((a, b) => b.delta - a.delta);
}

/** What one unknown drop from a source is worth. Variant rows (catalyst, Void
 *  Forge) are alternative uses of a drop already counted, not extra chances at
 *  one, so they fold onto it and the best outcome stands. */
export function expectedDelta(results: TopGearResult[]): number {
  const perDrop = new Map<string, number>();
  for (const result of results) {
    const item = result.items[0];
    if (!item) continue;
    const key = `${item.source_item_id || item.item_id}_${item.encounter || ''}`;
    perDrop.set(key, Math.max(perDrop.get(key) ?? 0, result.delta, 0));
  }
  if (!perDrop.size) return 0;
  return [...perDrop.values()].reduce((sum, delta) => sum + delta, 0) / perDrop.size;
}

export function bestDelta(results: TopGearResult[]): number {
  return results.length ? Math.max(...results.map((result) => result.delta)) : 0;
}

/** The DPS band inside which two sources cannot be told apart, taken from the
 *  loosest confidence interval among the rows being compared. Without precision
 *  data the band is zero, so every row gets its own priority. */
function indistinguishableBand(rows: EncounterSummaryRow[], baseDps: number): number {
  const worst = rows.flatMap((row) => row.results.map((result) => result.precision_pct ?? 0));
  return (Math.max(0, ...worst) / 100) * baseDps;
}

export function summarizeByEncounter(
  results: TopGearResult[],
  sort: SummarySort,
  baseDps: number
): EncounterSummaryRow[] {
  const groups: Record<string, TopGearResult[]> = {};
  for (const result of results) {
    const key = result.items[0]?.encounter;
    if (!key) continue;
    (groups[key] ??= []).push(result);
  }

  const rows = Object.entries(groups).map(([encounter, group]) => {
    // Collapse per-slot rows first: everything below counts each item once.
    const items = bestPerItem(group);
    return {
      encounter,
      instance: group.find((result) => result.items[0]?.instance)?.items[0]?.instance,
      results: items,
      combos: [...group].sort((a, b) => b.delta - a.delta),
      expected: expectedDelta(items),
      best: bestDelta(items),
      priority: 0,
    };
  });

  const metric = (row: EncounterSummaryRow) => (sort === 'best' ? row.best : row.expected);
  rows.sort((a, b) => metric(b) - metric(a));

  // Banded against the leader of the current priority, not the row above: a
  // chain of individually-indistinguishable gaps would otherwise carry one
  // priority all the way down a list whose ends the sim can plainly separate.
  let priority = 0;
  let leader: EncounterSummaryRow | undefined;
  for (const row of rows) {
    if (!leader || metric(leader) - metric(row) > indistinguishableBand([leader, row], baseDps)) {
      priority += 1;
      leader = row;
    }
    row.priority = priority;
  }
  return rows;
}
