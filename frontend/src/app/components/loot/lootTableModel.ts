import type { LootItemRowModel } from './lootItemRowModel';
import { compareSlots } from './slotOrder';
export interface LootTableModel {
  rows: LootItemRowModel[];
  headerLabel: string;
  hasEmbellishmentColumn: boolean;
  /** Table-level: the player already wears the maximum embellished pieces. */
  embellishmentLimitReached: boolean;
}
/** The 2-piece Embellished cap counts equipped pieces PLUS drops already picked
 *  in this run. An equipped-only count misses "wear 1, select 2". */
export function embellishmentCapReached(
  equippedEmbellishedCount: number,
  selectedEmbellishedCount: number
): boolean {
  return equippedEmbellishedCount + selectedEmbellishedCount >= 2;
}

export function groupLootRows(
  rows: LootItemRowModel[],
  search: string,
  groupBy: 'slot' | 'dungeon'
) {
  const filter = search.trim().toLocaleLowerCase();
  const groups = new Map<string, { key: string; group: string; rows: LootItemRowModel[] }>();
  for (const row of rows) {
    if (
      filter &&
      !row.name.toLocaleLowerCase().includes(filter) &&
      !String(row.itemId).includes(filter)
    )
      continue;
    const key = groupBy === 'slot' ? row.slot : String(row.sourceId ?? row.sourceName);
    const group = groupBy === 'slot' ? row.slot : row.sourceName;
    if (!groups.has(key)) groups.set(key, { key, group, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  return [...groups.values()].sort((a, b) =>
    groupBy === 'slot' ? compareSlots(a.group, b.group) : a.group.localeCompare(b.group)
  );
}
