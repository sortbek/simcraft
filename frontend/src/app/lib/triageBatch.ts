/**
 * Streamed Top Gear Triage batch-size choices. Tradeoff: small batches = pause
 * honored sooner; large batches = fewer simc invocations + lower retention overhead.
 *
 * Keep the max option in sync with the backend's `MAX_USER_BATCH_PROFILESETS` in
 * `backend/core/src/profileset_generator/triage.rs` — the backend clamps to that
 * bound, so requesting more is silently truncated.
 */

export interface TriageBatchOption {
  value: number;
  label: string;
}

export const TRIAGE_BATCH_OPTIONS: readonly TriageBatchOption[] = [
  { value: 250, label: '250 - Responsive pausing (default)' },
  { value: 500, label: '500 - Balanced' },
  { value: 1000, label: '1,000 - Throughput' },
  { value: 5000, label: '5,000 - High throughput' },
  { value: 30000, label: '30,000 - Maximum throughput' },
] as const;

export const TRIAGE_BATCH_DEFAULT = TRIAGE_BATCH_OPTIONS[0].value;
