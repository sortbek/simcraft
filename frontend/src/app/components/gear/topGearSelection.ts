import type { ResolveGearResponse, ResolvedItem } from '../../lib/types';
import { buildAlternativeKey } from './topGearIdentity';

export interface DisplayGroup {
  label: string;
  slots: string[];
}

export interface VisibleGroup {
  group: DisplayGroup;
  equipped: ResolvedItem[];
  alternatives: ResolvedItem[];
}

export interface QuickSelectEntry {
  uid: string;
  slot: string;
}

export const DISPLAY_GROUPS: DisplayGroup[] = [
  { label: 'slot.head', slots: ['head'] },
  { label: 'slot.neck', slots: ['neck'] },
  { label: 'slot.shoulder', slots: ['shoulder'] },
  { label: 'slot.back', slots: ['back'] },
  { label: 'slot.chest', slots: ['chest'] },
  { label: 'slot.wrist', slots: ['wrist'] },
  { label: 'slot.hands', slots: ['hands'] },
  { label: 'slot.waist', slots: ['waist'] },
  { label: 'slot.legs', slots: ['legs'] },
  { label: 'slot.feet', slots: ['feet'] },
  { label: 'slot.rings', slots: ['finger1', 'finger2'] },
  { label: 'slot.trinkets', slots: ['trinket1', 'trinket2'] },
  { label: 'slot.mainHand', slots: ['main_hand'] },
  { label: 'slot.offHand', slots: ['off_hand'] },
];

export function cloneSelectedUids(
  selectedUids: Record<string, Set<string>>
): Record<string, Set<string>> {
  return Object.fromEntries(
    Object.entries(selectedUids).map(([slot, values]) => [slot, new Set(values)])
  );
}

export function isItemSelected(
  item: ResolvedItem,
  group: DisplayGroup,
  resolved: ResolveGearResponse,
  selectedUids: Record<string, Set<string>>
): boolean {
  if (group.slots.length === 1) {
    return selectedUids[item.slot]?.has(item.uid) ?? false;
  }

  return group.slots.some((slot) => {
    const slotRes = resolved.slots[slot];
    if (!slotRes) return false;
    const matching = slotRes.alternatives.find((alternative) => alternative.uid === item.uid);
    return matching ? (selectedUids[slot]?.has(matching.uid) ?? false) : false;
  });
}

export function toggleItemSelection(
  item: ResolvedItem,
  group: DisplayGroup,
  resolved: ResolveGearResponse,
  selectedUids: Record<string, Set<string>>
): Record<string, Set<string>> {
  const updated = cloneSelectedUids(selectedUids);

  if (group.slots.length === 1) {
    const slot = item.slot;
    if (!updated[slot]) updated[slot] = new Set();
    if (updated[slot].has(item.uid)) updated[slot].delete(item.uid);
    else updated[slot].add(item.uid);
    return updated;
  }

  const currentlySelected = isItemSelected(item, group, resolved, selectedUids);
  for (const slot of group.slots) {
    const slotRes = resolved.slots[slot];
    if (!slotRes) continue;
    const matching = slotRes.alternatives.find((alternative) => alternative.uid === item.uid);
    if (!matching) continue;
    if (!updated[slot]) updated[slot] = new Set();
    if (currentlySelected) updated[slot].delete(matching.uid);
    else updated[slot].add(matching.uid);
  }

  return updated;
}

export function buildVisibleGroups(resolved: ResolveGearResponse): VisibleGroup[] {
  const result: VisibleGroup[] = [];

  for (const group of DISPLAY_GROUPS) {
    const equipped: ResolvedItem[] = [];
    const alternatives: ResolvedItem[] = [];
    const seenAltKeys = new Set<string>();

    for (const slot of group.slots) {
      const slotRes = resolved.slots[slot];
      if (!slotRes) continue;
      if (slotRes.equipped) equipped.push(slotRes.equipped);
      for (const alternative of slotRes.alternatives) {
        const key = buildAlternativeKey(alternative);
        if (seenAltKeys.has(key)) continue;
        seenAltKeys.add(key);
        alternatives.push(alternative);
      }
    }

    if (equipped.length === 0 && alternatives.length === 0) continue;

    equipped.sort((a, b) => b.ilevel - a.ilevel);
    alternatives.sort((a, b) => b.ilevel - a.ilevel);
    result.push({ group, equipped, alternatives });
  }

  return result;
}

export function collectQuickSelectEntries(resolved: ResolveGearResponse): {
  vaultUids: QuickSelectEntry[];
  lootUids: QuickSelectEntry[];
  catalystUids: QuickSelectEntry[];
} {
  const vaultUids: QuickSelectEntry[] = [];
  const lootUids: QuickSelectEntry[] = [];
  const catalystUids: QuickSelectEntry[] = [];

  for (const slotRes of Object.values(resolved.slots)) {
    for (const alternative of slotRes.alternatives) {
      const entry = { uid: alternative.uid, slot: alternative.slot };
      if (alternative.origin === 'vault') vaultUids.push(entry);
      if (alternative.origin === 'loot') lootUids.push(entry);
      if (alternative.is_catalyst) catalystUids.push(entry);
    }
  }

  return { vaultUids, lootUids, catalystUids };
}

export function toggleQuickSelectGroup(
  entries: QuickSelectEntry[],
  selectedUids: Record<string, Set<string>>
): Record<string, Set<string>> {
  const updated = cloneSelectedUids(selectedUids);
  const allSelected =
    entries.length > 0 && entries.every((entry) => selectedUids[entry.slot]?.has(entry.uid));

  for (const entry of entries) {
    if (!updated[entry.slot]) updated[entry.slot] = new Set();
    if (allSelected) updated[entry.slot].delete(entry.uid);
    else updated[entry.slot].add(entry.uid);
  }

  return updated;
}
