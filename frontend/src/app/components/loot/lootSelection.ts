export interface LootSelectionState {
  datasetId: string;
  availableBySlot: Record<string, string[]>;
  selected: Set<string>;
  excludedSlots: Set<string>;
}
export const initialLootSelection: LootSelectionState = {
  datasetId: '',
  availableBySlot: {},
  selected: new Set(),
  excludedSlots: new Set(),
};
export type LootSelectionAction =
  | { type: 'reconcile'; datasetId: string; availableBySlot: Record<string, string[]> }
  | { type: 'select' | 'clear'; uids: string[] }
  | { type: 'toggle'; uid: string }
  | { type: 'toggleSlot'; slot: string }
  | { type: 'resetSlots' };
export function visibleIds(
  availableBySlot: Record<string, string[]>,
  excludedSlots: Set<string>
): Set<string> {
  return new Set(
    Object.entries(availableBySlot)
      .filter(([slot]) => !excludedSlots.has(slot))
      .flatMap(([, ids]) => ids)
  );
}
export function lootSelectionReducer(
  state: LootSelectionState,
  action: LootSelectionAction
): LootSelectionState {
  const next = { ...state, selected: new Set(state.selected) };
  if (action.type === 'reconcile') {
    next.datasetId = action.datasetId;
    next.availableBySlot = action.availableBySlot;
    if (state.datasetId !== action.datasetId)
      next.selected = new Set(Object.values(action.availableBySlot).flat());
  } else if (action.type === 'toggleSlot' || action.type === 'resetSlots') {
    next.excludedSlots = new Set(state.excludedSlots);
    if (action.type === 'resetSlots') next.excludedSlots.clear();
    else if (next.excludedSlots.has(action.slot)) next.excludedSlots.delete(action.slot);
    else next.excludedSlots.add(action.slot);
    for (const slot of state.excludedSlots)
      if (!next.excludedSlots.has(slot)) {
        for (const uid of state.availableBySlot[slot] ?? []) next.selected.add(uid);
      }
  } else if (action.type === 'toggle') {
    if (next.selected.has(action.uid)) next.selected.delete(action.uid);
    else next.selected.add(action.uid);
  } else {
    for (const uid of action.uids) {
      if (action.type === 'select') next.selected.add(uid);
      else next.selected.delete(uid);
    }
  }
  const available = visibleIds(next.availableBySlot, next.excludedSlots);
  next.selected = new Set([...next.selected].filter((uid) => available.has(uid)));
  return next;
}
