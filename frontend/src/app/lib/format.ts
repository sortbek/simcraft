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
