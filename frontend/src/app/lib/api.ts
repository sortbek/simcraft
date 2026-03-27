// API URL detection: desktop app uses a fixed local server port
// Use 127.0.0.1 (not localhost) to match the backend bind address and avoid
// IPv6 resolution issues on Windows where localhost may resolve to ::1
export const API_URL =
  typeof window !== 'undefined' && window.electronAPI
    ? 'http://127.0.0.1:17384'
    : (process.env.NEXT_PUBLIC_API_URL ?? '');

/** Fetch JSON with consistent error handling. Throws on non-ok responses. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Server error ${res.status}`);
  }
  return res.json();
}
