/**
 * Format a DPS number for compact display.
 *
 *   < 1,000          → comma-grouped integer ("847")
 *   < 1,000,000      → kilo form ("12.3k" / "847k" when decimals=0)
 *   ≥ 1,000,000      → mega form ("1.2M")
 *
 * `decimals=0` is used by the ability chart where the value is already
 * abbreviated context and one decimal would be noise. `decimals=1` is the
 * default everywhere else.
 */
export function formatDps(value: number, decimals: 0 | 1 = 1): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) {
    const k = value / 1_000;
    return `${decimals === 0 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return Math.round(value).toLocaleString();
}
