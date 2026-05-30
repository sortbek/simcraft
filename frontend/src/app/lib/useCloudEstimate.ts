import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { postJson, providerKeyHeaders } from './api';

export interface CloudEstimate {
  combos: number;
  chunks: number;
  est_credits: number;
  available_credits: number | null;
  affordable: boolean;
  ceiling: number;
  /** True only when combos ≥ TRIAGE_THRESHOLD: the job streams via the chunk
   * orchestrator. Below the threshold a cloud run is a single eager Simmit job,
   * so the chunked credit/chunk estimate doesn't describe it. */
  would_stream: boolean;
  error?: string;
}

/**
 * Debounced cloud-estimate POST. Mirrors {@link useComboCount}'s
 * debounce/AbortController discipline. `enabled` gates the request (when false,
 * clears the estimate). `buildBody` returns the request payload (or null to skip).
 * `computeChoice` selects which provider keys to attach as `X-Provider-*-Key`
 * headers (the estimate fetches the user's available credits from that provider).
 *
 * NOTE: the effect re-runs on `deps` only. Any value feeding `enabled` (or read
 * by `buildBody`) MUST be included in `deps`, or the request won't re-fire.
 */
export function useCloudEstimate(
  endpoint: string,
  buildBody: () => Record<string, unknown> | null,
  deps: React.DependencyList,
  options: { enabled: boolean; computeChoice?: string; debounceMs?: number }
): { estimate: CloudEstimate | null; loading: boolean } {
  const { enabled, computeChoice, debounceMs = 300 } = options;
  const [estimate, setEstimate] = useState<CloudEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!enabled) {
      setEstimate(null);
      setLoading(false);
      return;
    }
    const body = buildBody();
    if (body === null) {
      setEstimate(null);
      setLoading(false);
      return;
    }
    clearTimeout(timerRef.current);
    const controller = new AbortController();
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const data = await postJson<CloudEstimate>(endpoint, body, {
          signal: controller.signal,
          headers: providerKeyHeaders(computeChoice),
        });
        setEstimate(data);
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return;
        setEstimate(null);
      } finally {
        setLoading(false);
      }
    }, debounceMs);
    return () => {
      clearTimeout(timerRef.current);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { estimate, loading };
}
