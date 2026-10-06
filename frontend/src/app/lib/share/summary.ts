import { isGearComparisonResult, type SimResult } from '../simResultTypes';

export interface ShareItem {
  slot: string;
  itemId: number;
  name: string;
  ilvl: number;
}
export interface ShareRow {
  dps: number;
  gainPct: number;
  precisionPct: number | null;
  items: ShareItem[];
}
interface SummaryBase {
  v: 1;
  character: string;
  realm: string | null;
  region: string | null;
  playerClass: string;
  fightLength: number;
  targets: number;
}
export type ShareSummary =
  | (SummaryBase & {
      kind: 'single_actor';
      dps: number;
      dpsError: number | null;
      statWeights: Record<string, number> | null;
    })
  | (SummaryBase & {
      kind: 'gear_comparison';
      mode: string;
      baselineDps: number;
      rows: ShareRow[];
    });

const clamp = (s: string, max: number) => s.slice(0, max);

/** Keeps at most the 20 weights with the largest absolute value (website cap),
 *  clamping each key to 32 chars. `undefined` stays `null`. */
function capStatWeights(w: Record<string, number> | undefined): Record<string, number> | null {
  if (!w) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(w)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 20)) {
    out[clamp(k, 32)] = v;
  }
  return out;
}

export function simcBuildOf(
  r: Pick<SimResult, 'simc_git_revision' | 'simc_version'>
): string | null {
  return (r.simc_git_revision || r.simc_version || '').slice(0, 64) || null;
}

export function buildShareSummary(r: SimResult): ShareSummary {
  const base: SummaryBase = {
    v: 1,
    character: clamp(r.player_name, 64),
    realm: r.realm ? clamp(r.realm, 64) : null,
    region: r.region ? clamp(r.region, 8) : null,
    playerClass: clamp(r.player_class, 64),
    fightLength: r.fight_length,
    targets: r.desired_targets ?? 1,
  };
  if (!isGearComparisonResult(r)) {
    return {
      ...base,
      kind: 'single_actor',
      dps: r.dps,
      dpsError: r.dps_error ?? null,
      statWeights: capStatWeights(r.stat_weights),
    };
  }
  const rows = [...r.results]
    .sort((a, b) => b.dps - a.dps)
    .slice(0, 10)
    .map((res) => ({
      dps: res.dps,
      gainPct: r.base_dps > 0 ? Math.round(((res.dps - r.base_dps) / r.base_dps) * 1000) / 10 : 0,
      precisionPct: res.precision_pct ?? null,
      items: res.items
        .filter((it) => !it.is_kept && it.item_id > 0)
        .slice(0, 20)
        .map((it) => ({
          slot: clamp(it.slot, 32),
          itemId: it.item_id,
          name: clamp(it.name, 128),
          ilvl: it.ilevel,
        })),
    }));
  return {
    ...base,
    kind: 'gear_comparison',
    mode: clamp(r.type, 32),
    baselineDps: r.base_dps,
    rows,
  };
}
