/**
 * Compact DPS rendering: 1.2M / 87k / 123.
 * `decimals` controls precision in the `k` band — defaults to 1 (the form
 * used by per-sim cards), pass `0` for tighter inline labels.
 */
export function formatDps(value: number, decimals: 0 | 1 = 1): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) {
    const k = value / 1_000;
    return `${decimals === 0 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return Math.round(value).toLocaleString();
}
