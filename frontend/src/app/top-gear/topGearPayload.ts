import type { ItemOrigin } from '../lib/types';
import type { TopGearLocalItem } from './topGearTypes';

export function buildSelectedUidsJson(
  selectedUids: Record<string, Set<string>>
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [slot, uids] of Object.entries(selectedUids)) {
    if (uids.size > 0) result[slot] = [...uids];
  }
  return result;
}

export function appendLocalItems(simcInput: string, localItems: TopGearLocalItem[]): string {
  let result = simcInput;
  if (localItems.length === 0) return result;

  const vaultItems = localItems.filter((item) => item.origin === 'vault');
  const bagItems = localItems.filter((item) => item.origin !== 'vault');

  if (vaultItems.length > 0) {
    const vaultLines = vaultItems.map((item) => `# ${item.slot}=${item.simc_string}`).join('\n');
    const endMarker = '### End of Weekly Reward Choices';
    result = result.includes(endMarker)
      ? result.replace(endMarker, `${vaultLines}\n${endMarker}`)
      : `${result}\n${vaultLines}`;
  }

  if (bagItems.length > 0) {
    const bagLines = bagItems.map((item) => `# ${item.slot}=${item.simc_string}`).join('\n');
    result = `${result}\n${bagLines}`;
  }

  return result;
}

export function serializeSelectionMap<T extends number | string>(
  source: Record<string, Set<T>>
): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const [slot, values] of Object.entries(source)) {
    if (values.size > 0) result[slot] = [...values];
  }
  return result;
}

export function toLocalItem(
  slot: string,
  simcString: string,
  origin: ItemOrigin
): TopGearLocalItem {
  return { slot, simc_string: simcString, origin };
}
