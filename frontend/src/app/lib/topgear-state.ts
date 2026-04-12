import type { ItemOrigin } from './types';

const STORAGE_KEY = 'simhammer_topgear_state';

export interface TopGearSavedState {
  selectedUids: Record<string, string[]>;
  localItems: { slot: string; simc_string: string; origin: ItemOrigin }[];
  enchantSelections: Record<string, number[]>;
  gemSelections: number[];
  maxUpgrade: boolean;
  copyEnchants: boolean;
  catalyst: boolean;
  catalystCharges: number | null;
  replaceGems: boolean;
  diamondAlwaysUse: boolean;
  maxColors: boolean;
}

export function storeTopGearState(state: TopGearSavedState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function getTopGearState(): TopGearSavedState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearTopGearState(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}
