/**
 * Safe wrappers around `localStorage` / `sessionStorage` reads that always
 * return a value (no exceptions, no nulls). Each helper centralises one
 * fallback policy that previously was repeated inline in components.
 *
 * Writes are intentionally not wrapped — every setter we have is followed
 * by a single `localStorage.setItem` inside a `try {}` block, which is
 * already terse enough.
 */

/** JSON-decode a stored value; return `fallback` on missing/invalid JSON. */
export function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Read a positive integer; return `fallback` if missing or unparseable.
 * Zero is treated as "not set" — callers wanting `0` to be a real value should
 * implement their own parse. */
export function readStoredPositiveInt(key: string, fallback: number): number {
  const v = localStorage.getItem(key);
  if (v == null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Read a string from `sessionStorage`; return `fallback` if missing. */
export function readSessionString(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return sessionStorage.getItem(key) ?? fallback;
}
