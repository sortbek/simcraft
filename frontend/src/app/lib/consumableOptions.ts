/** Consumable alternatives for Top Gear: slot -> extra SimC values to try
 *  against the Sim settings consumables (the baseline). */
export type ConsumableOptions = Record<string, string[]>;

/** A consumable's identity across crafting qualities ("_1" / "_2" suffixes). */
export const baseOf = (value: string) => value.replace(/_\d+$/, '');

/** The alternatives that still differ from the baseline: a pick the baseline
 *  now uses (in any quality) is dropped, as are slots left empty. */
export function effectiveConsumableOptions(
  options: ConsumableOptions,
  baseline: Record<string, string>
): ConsumableOptions {
  const out: ConsumableOptions = {};
  for (const [slot, values] of Object.entries(options)) {
    const base = baseline[slot] ? baseOf(baseline[slot]) : '';
    const kept = values.filter((v) => baseOf(v) !== base);
    if (kept.length) out[slot] = kept;
  }
  return out;
}

/** How many consumable mixes the run tries, the baseline mix included. */
export function consumableMixCount(options: ConsumableOptions): number {
  return Object.values(options).reduce((n, values) => n * (values.length + 1), 1);
}
