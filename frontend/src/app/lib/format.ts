/**
 * Format a DPS number for compact display: <1k integer, <1M kilo ("12.3k"),
 * ≥1M mega ("1.2M"). `decimals=0` (ability chart, where a decimal is noise);
 * `decimals=1` everywhere else.
 */
export function formatDps(value: number, decimals: 0 | 1 = 1): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) {
    const k = value / 1_000;
    return `${decimals === 0 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return Math.round(value).toLocaleString();
}

/** A whole number, or one decimal while the sim's DPS is under 10k (WoW Forever), where a
 *  single point is already a real step. `scale` is the DPS the value belongs to. */
export function formatDpsExact(value: number, scale: number): string {
  const decimals = Math.abs(scale) < 10_000 ? 1 : 0;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
