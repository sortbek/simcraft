import { useEffect, useReducer } from 'react';
import { initialLootSelection, lootSelectionReducer, visibleIds } from './lootSelection';
export function useLootSelection(datasetId: string, availableBySlot: Record<string, string[]>) {
  const [state, dispatch] = useReducer(lootSelectionReducer, initialLootSelection);
  // Reconcile on dataset identity and the available IDs, not on fetched object
  // references — hence a string key rather than the object as an effect dep.
  const availabilityKey = JSON.stringify(availableBySlot);
  useEffect(() => {
    dispatch({ type: 'reconcile', datasetId, availableBySlot });
    // `availableBySlot` is rebuilt every render; `availabilityKey` is its value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, availabilityKey]);
  const visible = visibleIds(availableBySlot, state.excludedSlots);
  const selected =
    state.datasetId === datasetId
      ? new Set([...state.selected].filter((uid) => visible.has(uid)))
      : visible;
  return {
    selected,
    excludedSlots: state.excludedSlots,
    toggleItem: (uid: string) => dispatch({ type: 'toggle', uid }),
    selectItems: (uids: string[]) => dispatch({ type: 'select', uids }),
    clearItems: (uids: string[]) => dispatch({ type: 'clear', uids }),
    toggleSlot: (slot: string) => dispatch({ type: 'toggleSlot', slot }),
    resetExcludedSlots: () => dispatch({ type: 'resetSlots' }),
  };
}
