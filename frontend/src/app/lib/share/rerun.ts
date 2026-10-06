import { isGearComparisonResult, type SimResult } from '../simResultTypes';
import type { SharePayload } from './api';

export const SUPPORTED_PAYLOAD_VERSION = 1;
export const SUPPORTED_REQUEST_VERSION = 1;

export const RERUN_ENDPOINTS: Record<string, string> = {
  quick: '/api/sim',
  stat_weights: '/api/sim',
  top_gear: '/api/top-gear/sim',
  droptimizer: '/api/droptimizer/sim',
  upgrade_compare: '/api/upgrade-compare/sim',
};

/** A table entry for an uploader-controlled key; never an inherited property. */
export function ownEntry<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

export function checkPayloadVersion(p: { v: number }): 'ok' | 'too_new' {
  return p.v > SUPPORTED_PAYLOAD_VERSION ? 'too_new' : 'ok';
}

/** Null when the shared result can be rendered, else a short reason. */
export function checkResultShape(result: unknown): string | null {
  if (typeof result !== 'object' || result === null || Array.isArray(result))
    return 'malformed result';
  const r = result as Record<string, unknown>;
  if (typeof r.player_name !== 'string' || typeof r.fight_length !== 'number')
    return 'malformed result';
  const ok = isGearComparisonResult(r as unknown as SimResult)
    ? Array.isArray(r.results)
    : typeof r.dps === 'number';
  return ok ? null : 'malformed result';
}

export function buildRerunRequest(
  p: SharePayload,
  shareId: string
):
  | { endpoint: string; body: Record<string, unknown> }
  | { error: 'not_rerunnable' | 'incompatible' | 'unknown_mode' } {
  if (!p.request) return { error: 'not_rerunnable' };
  if (p.requestVersion > SUPPORTED_REQUEST_VERSION) return { error: 'incompatible' };
  const endpoint = ownEntry(RERUN_ENDPOINTS, p.mode);
  if (!endpoint) return { error: 'unknown_mode' };
  // Machine-local: the viewer's threads, and whichever SimC build they have installed.
  const { batch_id: _batch, threads: _threads, simc_branch: _branch, ...rest } = p.request;
  return { endpoint, body: { ...rest, compute_provider: 'local', rerun_of: shareId } };
}
