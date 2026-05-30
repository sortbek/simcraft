import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { postJson } from './api';

interface ComboCountResponse {
  combo_count?: number;
  error?: string;
}

/**
 * Debounced combo-count POST. Extracted from the duplicated effects in top-gear,
 * enchant-gem, and upgrade-compare. `enabled` gates the request (when false,
 * resets to 0). `buildBody` returns the request payload (or null to skip).
 * `debounceMs` keeps each page's existing timing (top-gear/upgrade 300, enchant 200).
 *
 * NOTE: the effect re-runs on `deps` only. Any value feeding `enabled` (or read
 * by `buildBody`) MUST be included in `deps`, or the request won't re-fire when
 * it changes. Today's callers derive `enabled` from values already in their deps.
 */
export function useComboCount(
  endpoint: string,
  buildBody: () => Record<string, unknown> | null,
  deps: React.DependencyList,
  options: { enabled: boolean; debounceMs?: number; tooManyMessage?: string }
): { comboCount: number; error: string } {
  const { enabled, debounceMs = 300, tooManyMessage = '' } = options;
  const [comboCount, setComboCount] = useState(0);
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!enabled) {
      setComboCount(0);
      setError('');
      return;
    }
    const body = buildBody();
    if (body === null) {
      setComboCount(0);
      setError('');
      return;
    }
    clearTimeout(timerRef.current);
    const controller = new AbortController();
    timerRef.current = setTimeout(async () => {
      try {
        const data = await postJson<ComboCountResponse>(endpoint, body, {
          signal: controller.signal,
        });
        setComboCount(data.combo_count ?? 0);
        setError(data.error ?? '');
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return;
        setComboCount(0);
        setError(tooManyMessage);
      }
    }, debounceMs);
    return () => {
      clearTimeout(timerRef.current);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { comboCount, error };
}
