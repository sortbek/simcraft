'use client';
/* eslint-disable @next/next/no-img-element */

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl, fetchJsonOr } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import {
  comboList,
  estimateEta,
  runFraction,
  type ComboRun,
  type LiveSim,
} from '../../lib/simcLog';
import {
  QUALITY_COLORS,
  getWowheadData,
  getWowheadUrl,
  iconProps,
  localizedItemName,
  useItemInfo,
  type ItemInfo,
} from '../../lib/useItemInfo';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import type { ResultItem } from '../gear/topGearResultsTypes';
import CardHeader from '../ui/CardHeader';
import ToggleButtonGroup from '../ui/ToggleButtonGroup';
import LogConsole from './LogConsole';

const MAX_SEGMENTS = 60;
// A large stage finishes thousands of combos; the table, the gear lookups and the
// key-lines log only ever hold this many.
const MAX_RANKED_ROWS = 25;
const MAX_FINISHED_LOG_LINES = 30;

function formatTime(seconds: number | undefined): string {
  if (seconds === undefined) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

const dps = (n: number) => Math.round(n).toLocaleString();
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${dps(Math.abs(n))}`;

function comboLabel(c: ComboRun, t: (k: string) => string): string {
  return c.isBaseline ? t('live.baseline') : c.name;
}

/** Changed items per combo name, each asked for once as it appears. */
function useComboItems(jobId: string | undefined, names: string[]) {
  const [items, setItems] = useState<Record<string, ResultItem[]>>({});
  const asked = useRef(new Set<string>());
  const key = names.join('|');
  useEffect(() => {
    const missing = names.filter((n) => !asked.current.has(n));
    if (!jobId || !missing.length) return;
    missing.forEach((n) => asked.current.add(n));
    const query = encodeURIComponent(missing.join(','));
    fetchJsonOr<Record<string, ResultItem[]>>(
      apiUrl(`/api/sim/${jobId}/combos?names=${query}`),
      {}
    ).then((got) => {
      // Not written yet (a cloud chunk still starting): ask again next time.
      for (const n of missing) if (!(n in got)) asked.current.delete(n);
      if (Object.keys(got).length) setItems((prev) => ({ ...prev, ...got }));
    });
    // `key` is the value of `names`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, key]);
  return items;
}

/** Icons of the gear a combo swaps in, with Wowhead tooltips. */
function ComboGear({
  items,
  info,
  named,
}: {
  items?: ResultItem[];
  info: Record<number, ItemInfo>;
  /** Show the item's name beside a lone icon (the current combo's header). */
  named?: boolean;
}) {
  const { t, locale } = useLanguage();
  if (!items) return null;
  const gear = items.filter((i) => i.item_id > 0 && !i.type && !i.is_kept);
  if (!gear.length)
    return items.length ? (
      <span className="text-xs text-outline">{t('live.enchantsGems')}</span>
    ) : null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {gear.map((item, i) => {
        const data = info[item.item_id];
        return (
          <a
            key={`${item.slot}-${i}`}
            href={getWowheadUrl(item.item_id)}
            data-wowhead={getWowheadData(item)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.preventDefault()}
            className="relative block h-[22px] w-[22px] shrink-0 overflow-hidden rounded-[4px] border"
            style={{ borderColor: data ? QUALITY_COLORS[data.quality] : QUALITY_COLORS[1] }}
          >
            <img {...iconProps(data?.icon)} alt="" className="h-full w-full" />
          </a>
        );
      })}
      {named && gear.length === 1 && (
        <span
          className="ml-1.5 max-w-[220px] truncate text-[12.5px] font-semibold"
          style={{
            color: info[gear[0].item_id]
              ? QUALITY_COLORS[info[gear[0].item_id].quality]
              : undefined,
          }}
        >
          {localizedItemName(
            gear[0].item_id,
            info[gear[0].item_id]?.name || gear[0].name || '',
            locale
          )}
        </span>
      )}
    </span>
  );
}

/** Mean DPS over the combo's updates settling, against a dashed baseline line. */
function SettlingChart({ samples, baseline }: { samples: number[]; baseline?: number }) {
  const { t } = useLanguage();
  if (samples.length < 2) return <div className="h-[110px]" />;
  const values = baseline !== undefined ? [...samples, baseline] : samples;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const y = (v: number) => 8 + (1 - (v - min) / span) * 74;
  const line = samples
    .map(
      (v, i) =>
        `${i ? 'L' : 'M'}${((i / (samples.length - 1)) * 300).toFixed(1)},${y(v).toFixed(1)}`
    )
    .join(' ');
  const baseY = baseline !== undefined ? y(baseline) : undefined;
  return (
    <div className="relative">
      <svg viewBox="0 0 300 90" preserveAspectRatio="none" className="block h-[110px] w-full">
        <defs>
          <linearGradient id="live-spark" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="rgb(var(--c-primary-fill))" stopOpacity=".22" />
            <stop offset="1" stopColor="rgb(var(--c-primary-fill))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {baseY !== undefined && (
          <line
            x1="0"
            x2="300"
            y1={baseY}
            y2={baseY}
            stroke="rgb(var(--c-on-surface-variant))"
            strokeOpacity=".5"
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path d={`${line} L300,90 L0,90 Z`} fill="url(#live-spark)" />
        <path
          d={line}
          fill="none"
          stroke="rgb(var(--c-primary-fill))"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {baseY !== undefined && baseline !== undefined && (
        <span
          className="absolute right-0 -translate-y-full pb-0.5 text-[11px] text-outline"
          style={{ top: `${(baseY / 90) * 100}%` }}
        >
          {t('live.baselineAt', { dps: dps(baseline) })}
        </span>
      )}
    </div>
  );
}

/** One cell of the hairline-split readout row, like the hero's stats strip. */
function Readout({
  label,
  value,
  note,
  large,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  large?: boolean;
}) {
  return (
    <div className={large ? 'px-6 py-4' : 'px-5 py-4'}>
      <span className="lbl block">{label}</span>
      <span
        className={`block font-headline font-extrabold tabular-nums text-on-surface ${
          large ? 'mt-1.5 text-2xl' : 'mt-2 text-lg'
        }`}
      >
        {value}
      </span>
      {note && <span className="text-xs text-outline">{note}</span>}
    </div>
  );
}

/** "Implementation Not Yet Verified: Rune of X: Procs are…" → name + explanation. */
function NoteText({ text }: { text: string }) {
  const { t } = useLanguage();
  const m = text.match(/^Implementation Not Yet Verified: ([^:]+): (.*)$/);
  if (!m) return <>{text}</>;
  return (
    <>
      <b className="font-semibold text-on-surface">{m[1]}</b> — {t('live.notVerified')} {m[2]}
    </>
  );
}

export default function LiveSimView({
  jobId,
  live,
  title,
  cpu,
  actions,
  logLines,
  showLogs,
}: {
  jobId?: string;
  live: LiveSim;
  title: string;
  cpu: number | null;
  actions?: ReactNode;
  logLines: string[];
  showLogs: boolean;
}) {
  const { t } = useLanguage();
  const [logView, setLogView] = useState<'key' | 'all'>('key');
  const combos = comboList(live);
  const current = live.current !== undefined ? live.combos[live.current] : undefined;
  const baseline = combos.find((c) => c.isBaseline);
  const finished = combos.filter((c) => c.done);
  const multi = live.total > 1;
  const eta = estimateEta(live, combos);
  const fraction = runFraction(live, combos);
  const opts = live.options;

  const ranked = [...finished].sort((a, b) => b.mean - a.mean);
  const rankOf = new Map(ranked.map((c, i) => [c.index, i + 1]));
  const shown = ranked.slice(0, MAX_RANKED_ROWS);
  if (baseline?.done && !shown.includes(baseline)) shown.push(baseline);

  const keyLines = useMemo(() => {
    const out = [...live.header];
    for (const n of live.notes) out.push(n.count > 1 ? `${n.text} (×${n.count})` : n.text);
    const done = finished.slice(-MAX_FINISHED_LOG_LINES);
    if (finished.length > done.length)
      out.push(t('live.earlierFinished', { count: finished.length - done.length }));
    for (const c of done)
      out.push(
        `✓ ${comboLabel(c, t)} — ${dps(c.mean)} DPS · ${c.errorPct.toFixed(3)}%${
          c.elapsed !== undefined ? ` · ${c.elapsed.toFixed(1)}s` : ''
        }`
      );
    const last = [...logLines].reverse().find((l) => l.startsWith('Generating '));
    if (last && current && !current.done) out.push(last);
    return out;
    // `finished` is derived from `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logLines, live, current, t]);

  const segments = Math.min(live.total, MAX_SEGMENTS);

  const lookup = [...shown, ...(current ? [current] : [])]
    .filter((c) => !c.isBaseline)
    .map((c) => c.name);
  const comboItems = useComboItems(multi ? jobId : undefined, [...new Set(lookup)]);
  const queries = useMemo(
    () =>
      Object.values(comboItems)
        .flat()
        .map((i) => ({ item_id: i.item_id, bonus_ids: i.bonus_ids })),
    [comboItems]
  );
  const itemInfo = useItemInfo(queries);
  useWowheadTooltips([itemInfo]);

  return (
    <div className="w-full space-y-4">
      {/* Overview */}
      <section
        className="relative overflow-hidden rounded-[10px] border border-line/[0.06] px-7 py-6 [box-shadow:var(--shadow-card)]"
        style={{
          background:
            'radial-gradient(ellipse 40% 80% at 10% 0%,rgb(var(--c-primary-fill) / .07),transparent 70%),linear-gradient(180deg,rgb(var(--c-surface-container-high)),rgb(var(--c-surface-container)))',
        }}
      >
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <div className="flex items-center gap-2.5 font-headline text-xs font-extrabold uppercase tracking-[0.14em] text-gold">
              <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-gold-fill shadow-[0_0_0_4px_rgb(var(--c-primary-fill)/0.15)]" />
              {title}
            </div>
            <div className="mt-2.5 font-headline text-[40px] font-extrabold leading-none tracking-[-0.02em] text-on-surface">
              {!current ? (
                // Queued, SimC still loading, or between stages: no progress line yet.
                <span className="text-on-surface-variant">{t('live.starting')}</span>
              ) : multi ? (
                <>
                  {comboLabel(current, t)}
                  <span className="ml-2 font-sans text-[15px] font-semibold tracking-normal text-on-surface-variant">
                    {t('live.ofTotal', { index: live.current ?? 0, total: live.total })}
                  </span>
                </>
              ) : (
                `${Math.round(fraction * 100)}%`
              )}
            </div>
          </div>
          <div className="text-right">
            <span className="lbl block">{t('live.timeLeft')}</span>
            <span className="mt-1 block font-headline text-[26px] font-extrabold tabular-nums text-on-surface">
              {formatTime(eta)}
            </span>
          </div>
        </div>

        <div className="mt-5">
          {multi && live.total <= MAX_SEGMENTS ? (
            <div
              className="grid gap-[3px]"
              style={{ gridTemplateColumns: `repeat(${segments}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: segments }, (_, i) => {
                const c = live.combos[i + 1];
                const partial = c && !c.done ? Math.min(100, (c.iterations / c.target) * 100) : 0;
                return (
                  <i
                    key={i}
                    className={`block h-1.5 rounded-[3px] ${c?.done ? 'bg-gold-dark' : 'bg-surface-container-highest'}`}
                    style={
                      partial
                        ? {
                            background: `linear-gradient(90deg,rgb(var(--c-primary-fill)) ${partial}%,rgb(var(--c-surface-container-highest)) ${partial}%)`,
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          ) : (
            <div className="h-1.5 overflow-hidden rounded-[6px] bg-surface-container-highest">
              <div
                className="h-full rounded-[6px] bg-gradient-to-r from-gold-dark to-gold-fill transition-all duration-700"
                style={{ width: `${Math.max(2, fraction * 100)}%` }}
              />
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-on-surface-variant">
            {live.version && (
              <span>
                SimC <b className="font-semibold text-on-surface">{live.version}</b>
                {live.build && ` · ${live.build}`}
              </span>
            )}
            {opts.fight_style && (
              <span>
                <b className="font-semibold text-on-surface">{opts.fight_style}</b>
                {opts.max_time &&
                  ` · ${formatTime(Number(opts.max_time))}${
                    opts.vary_combat_length
                      ? ` ±${Math.round(Number(opts.vary_combat_length) * 100)}%`
                      : ''
                  }`}
              </span>
            )}
            {opts.target_error && (
              <span>
                {t('live.targetError')}{' '}
                <b className="font-semibold text-on-surface">{Number(opts.target_error)}%</b>
              </span>
            )}
            {opts.threads && (
              <span>
                {t('live.threads')} <b className="font-semibold text-on-surface">{opts.threads}</b>
              </span>
            )}
            {cpu !== null && (
              <span>
                CPU <b className="font-semibold text-on-surface">{Math.round(cpu)}%</b>
              </span>
            )}
          </div>
          {actions}
        </div>
      </section>

      <div className={`grid gap-4 ${multi ? 'lg:grid-cols-[1.1fr_1fr]' : ''}`}>
        {/* Current combo */}
        {current && (
          <section className="card overflow-hidden">
            <CardHeader
              title={
                multi
                  ? t('live.nowSimming', { name: comboLabel(current, t) })
                  : t('live.simming', { name: current.name })
              }
              right={
                multi && !current.isBaseline ? (
                  <ComboGear items={comboItems[current.name]} info={itemInfo} named />
                ) : undefined
              }
            />
            <div className="grid grid-cols-[1.3fr_1fr_1fr] border-b border-line/[0.06] [&>*+*]:shadow-[inset_1px_0_0_rgb(var(--c-line)/calc(0.06*var(--c-line-k)))]">
              <Readout
                label={t('live.liveDps')}
                value={dps(current.mean)}
                large
                note={
                  baseline && !current.isBaseline ? (
                    <span
                      className={current.mean >= baseline.mean ? 'text-positive' : 'text-negative'}
                    >
                      {t('live.vsBaseline', { delta: signed(current.mean - baseline.mean) })}
                    </span>
                  ) : undefined
                }
              />
              <Readout
                label={t('results.error')}
                value={`${current.errorPct.toFixed(3)}%`}
                note={
                  opts.target_error
                    ? t('live.target', { value: `${Number(opts.target_error).toFixed(3)}%` })
                    : undefined
                }
              />
              <Readout
                label={t('results.iterations')}
                value={current.iterations.toLocaleString()}
                note={
                  t('live.ofAbout', { count: current.target.toLocaleString() }) +
                  (current.eta !== undefined
                    ? ` · ${t('live.left', { time: formatTime(current.eta) })}`
                    : '')
                }
              />
            </div>
            <div className="px-6 pb-[18px] pt-3.5">
              <SettlingChart
                samples={current.samples}
                baseline={baseline && !current.isBaseline ? baseline.mean : undefined}
              />
            </div>
          </section>
        )}

        {/* Finished so far */}
        {multi && (
          <section className="card">
            <CardHeader
              title={t('live.finished')}
              right={
                <span className="lbl">
                  {t('live.ofTotalShort', { done: finished.length, total: live.total })}
                </span>
              }
            />
            {shown.length === 0 ? (
              <p className="px-6 py-5 text-[13px] text-outline">{t('live.noneFinished')}</p>
            ) : (
              // Header plus five rows; the rest scrolls under a pinned header.
              <div className="max-h-[258px] overflow-y-auto">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 z-10 bg-surface-container">
                    <tr className="shadow-[inset_0_-1px_0_rgb(var(--c-line)/calc(0.06*var(--c-line-k)))]">
                      <th className="lbl w-10 py-2.5 pl-6 text-left">#</th>
                      <th className="lbl py-2.5 text-left">{t('live.combo')}</th>
                      <th className="lbl py-2.5 text-right">DPS</th>
                      <th className="lbl py-2.5 text-right">Δ</th>
                      <th className="lbl py-2.5 pr-6 text-right">{t('live.time')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => {
                      const delta = baseline && !c.isBaseline ? c.mean - baseline.mean : null;
                      const rank = rankOf.get(c.index) ?? 0;
                      return (
                        <tr
                          key={c.index}
                          className={`border-b border-line/[0.06] last:border-0 ${
                            rank === 1 ? 'shadow-[inset_2px_0_0_rgb(var(--c-primary-fill))]' : ''
                          } ${c.isBaseline ? 'text-on-surface-variant' : 'text-on-surface'}`}
                        >
                          <td className="py-2.5 pl-6 text-outline">{rank}</td>
                          <td className="py-2">
                            {c.isBaseline ? (
                              comboLabel(c, t)
                            ) : (
                              <span className="flex items-center gap-2.5">
                                <ComboGear items={comboItems[c.name]} info={itemInfo} />
                                <span className="text-xs text-outline">{c.name}</span>
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 text-right font-headline font-extrabold tabular-nums">
                            {dps(c.mean)}
                          </td>
                          <td
                            className={`py-2.5 text-right tabular-nums ${
                              delta === null
                                ? 'text-outline'
                                : delta >= 0
                                  ? 'text-positive'
                                  : 'text-negative'
                            }`}
                          >
                            {delta === null ? '—' : signed(delta)}
                          </td>
                          <td className="py-2.5 pr-6 text-right font-mono text-xs text-outline">
                            {c.elapsed !== undefined ? `${c.elapsed.toFixed(1)}s` : ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-line/[0.06] px-6 py-3 text-xs text-outline">
              {ranked.length > MAX_RANKED_ROWS
                ? t('live.moreFinished', { count: ranked.length - MAX_RANKED_ROWS })
                : t('live.earlyResults')}
            </p>
          </section>
        )}
      </div>

      {/* SimC notes */}
      {live.notes.length > 0 && (
        <section className="card">
          <CardHeader
            title={t('live.notes')}
            right={
              <span className="lbl">{t('live.uniqueNotes', { count: live.notes.length })}</span>
            }
          />
          <div className="divide-y divide-line/[0.06]">
            {live.notes.map((n) => (
              <div key={n.text} className="flex items-start gap-3 px-6 py-3.5">
                <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-warning/[0.14] font-headline text-[11px] font-extrabold text-warning">
                  !
                </span>
                <p className="text-[13px] text-on-surface-variant">
                  <NoteText text={n.text} />
                  {n.count > 1 && (
                    <span className="ml-1.5 rounded-[5px] bg-surface-container-highest px-1.5 py-0.5 font-headline text-[11px] font-extrabold text-on-surface-variant">
                      ×{n.count}
                    </span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {showLogs && logLines.length > 0 && (
        <LogConsole
          lines={logView === 'key' ? keyLines : logLines}
          totalLines={logLines.length}
          headerRight={
            <ToggleButtonGroup
              size="sm"
              value={logView}
              onChange={setLogView}
              options={[
                { key: 'key', label: t('live.keyLines') },
                { key: 'all', label: t('live.everything') },
              ]}
            />
          }
        />
      )}
    </div>
  );
}
