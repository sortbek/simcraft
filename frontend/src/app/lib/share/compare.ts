import type { ResultItem } from '../../components/gear/topGearResultsTypes';
import { isGearComparisonResult, type SimResult } from '../simResultTypes';
import { checkResultShape } from './rerun';

export type Comparison =
  | { kind: 'single'; sharedDps: number; localDps: number; deltaPct: number; flagged: boolean }
  | {
      kind: 'gear';
      rows: Array<{
        label: string;
        sharedGainPct: number;
        localGainPct: number | null;
        flagged: boolean;
      }>;
    };

const FALLBACK_ERR_PCT = 0.5;
const round1 = (n: number) => Math.round(n * 10) / 10;
const gain = (dps: number, base: number) => (base > 0 ? ((dps - base) / base) * 100 : 0);
const flagged = (a: number, b: number, errA?: number, errB?: number) =>
  Math.abs(a - b) > 2 * Math.hypot(errA ?? FALLBACK_ERR_PCT, errB ?? FALLBACK_ERR_PCT);

// Gem-only delta rows (emit.rs::build_gem_entry) carry just the singular `gem_id`, not `gem_ids`.
// Mirrors toGemIdList (useItemInfo.ts): prefer `gem_ids` when present, else wrap `gem_id`.
const gemIdsOf = (it: ResultItem): number[] =>
  (it.gem_ids?.length ? it.gem_ids : it.gem_id ? [it.gem_id] : []).filter((g) => g > 0);

export function comboKey(
  items: ResultItem[],
  talentBuild?: string,
  folioBuild?: string,
  consumables?: Record<string, string>
): string {
  const parts = items
    .filter((it) => !it.is_kept)
    .map((it) =>
      [
        it.type ?? 'item',
        it.slot,
        it.item_id,
        [...(it.bonus_ids ?? [])].sort((a, b) => a - b).join(':'),
        it.enchant_id ?? '',
        gemIdsOf(it).join(':'),
      ].join('/')
    )
    .sort();
  const mix = Object.entries(consumables ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slot, value]) => `${slot}:${value}`)
    .join(',');
  // Appended only when set, so keys of results without consumables are unchanged.
  return [
    ...parts,
    `t=${talentBuild ?? ''}`,
    `f=${folioBuild ?? ''}`,
    ...(mix ? [`c=${mix}`] : []),
  ].join('|');
}

export function compareResults(shared: SimResult, local: SimResult, limit = 5): Comparison {
  if (!isGearComparisonResult(shared) || !isGearComparisonResult(local)) {
    const s = shared as { dps: number; dps_error_pct?: number };
    const l = local as { dps: number; dps_error_pct?: number };
    const deltaPct = s.dps > 0 ? ((l.dps - s.dps) / s.dps) * 100 : 0;
    return {
      kind: 'single',
      sharedDps: s.dps,
      localDps: l.dps,
      deltaPct,
      flagged: flagged(deltaPct, 0, s.dps_error_pct, l.dps_error_pct),
    };
  }
  const localByKey = new Map(
    local.results.map((r) => [comboKey(r.items, r.talent_build, r.folio_build, r.consumables), r])
  );
  const rows = [...shared.results]
    .sort((a, b) => b.dps - a.dps)
    .slice(0, limit)
    .map((r) => {
      const match = localByKey.get(comboKey(r.items, r.talent_build, r.folio_build, r.consumables));
      const sharedGainPct = round1(gain(r.dps, shared.base_dps));
      const localGainPct = match ? round1(gain(match.dps, local.base_dps)) : null;
      const label =
        r.items
          .filter((it) => !it.is_kept && (it.item_id > 0 || it.type))
          .map((it) => it.name)
          .join(', ') || r.name;
      return {
        label,
        sharedGainPct,
        localGainPct,
        flagged:
          localGainPct !== null &&
          flagged(sharedGainPct, localGainPct, r.precision_pct, match?.precision_pct),
      };
    });
  return { kind: 'gear', rows };
}

/** Null when the shared result (from an anonymous uploader) can't be compared. */
export function compareShared(shared: SimResult, local: SimResult): Comparison | null {
  if (checkResultShape(shared)) return null;
  try {
    return compareResults(shared, local);
  } catch {
    return null;
  }
}
