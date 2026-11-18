'use client';
/* eslint-disable @next/next/no-img-element */

import { useLanguage } from '../../lib/i18n';
import type { ForeverTimeline as Timeline } from '../../lib/simResultTypes';
import { iconProps } from '../../lib/useItemInfo';

/** A spell icon in the damage breakdown's frame. */
export function Icon({ icon, title }: { icon?: string | null; title?: string }) {
  return (
    <span
      title={title}
      className="relative h-6 w-6 shrink-0 overflow-hidden rounded-[5px] border border-line/[0.11] bg-surface-container-high"
    >
      {icon && <img alt="" {...iconProps(icon)} className="h-full w-full object-cover" />}
      <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.7)]" />
    </span>
  );
}

const clock = (seconds: number) => {
  const sign = seconds < 0 ? '-' : '';
  const whole = Math.abs(Math.round(seconds));
  return `${sign}${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** The first thirty seconds of the logged fight, cast by cast. */
export function ForeverOpener({ timeline }: { timeline: Timeline }) {
  const casts = timeline.casts.filter((c) => !c.owner && c.t <= 30).slice(0, 24);
  if (casts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-3">
      {casts.map((c, i) => (
        <div key={i} className="flex w-9 flex-col items-center gap-1">
          <Icon icon={c.icon} title={c.name} />
          <span className="text-[10.5px] tabular-nums text-outline">{clock(c.t)}</span>
        </div>
      ))}
    </div>
  );
}

function Row({
  icon,
  name,
  children,
}: {
  icon?: string | null;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex w-44 shrink-0 items-center gap-2 text-[12.5px]">
        <Icon icon={icon} />
        <span className="truncate font-semibold text-on-surface">{name}</span>
      </span>
      <div className="relative h-5 min-w-0 flex-1 rounded-[3px] bg-overlay/[0.03]">{children}</div>
    </div>
  );
}

/** One logged fight: when each ability was cast, when each aura was up and the mana curve. */
export default function ForeverTimeline({ timeline }: { timeline: Timeline }) {
  const { t } = useLanguage();
  const start = Math.min(0, ...timeline.casts.map((c) => c.t));
  const end = Math.max(timeline.duration, 1);
  const span = end - start;
  const at = (time: number) => `${Math.min(100, Math.max(0, ((time - start) / span) * 100))}%`;

  // One row per ability, in the order they are first cast; the pet's after the player's.
  const rows = new Map<
    string,
    { name: string; icon?: string | null; owner: string; times: number[] }
  >();
  for (const c of [...timeline.casts].sort((a, b) => Number(!!a.owner) - Number(!!b.owner))) {
    const key = `${c.owner}:${c.name}`;
    if (!rows.has(key)) rows.set(key, { name: c.name, icon: c.icon, owner: c.owner, times: [] });
    rows.get(key)!.times.push(c.t);
  }
  const ticks = [];
  for (let s = 0; s <= end; s += end > 150 ? 30 : 10) ticks.push(s);
  const mana = timeline.mana;
  const top = Math.max(1, ...mana.map(([, value]) => value));
  const points = mana
    .map(([time, value]) => `${((time - start) / span) * 100},${40 - (value / top) * 38}`)
    .join(' ');

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <span className="lbl block">{t('forever.details.casts')}</span>
        {[...rows.values()].map((row) => (
          <Row
            key={`${row.owner}:${row.name}`}
            icon={row.icon}
            name={row.owner ? `${row.owner}: ${row.name}` : row.name}
          >
            {row.times.map((time, i) => (
              <span
                key={i}
                title={clock(time)}
                className="absolute top-0 h-full w-[2px] rounded-full bg-gold-fill"
                style={{ left: at(time) }}
              />
            ))}
          </Row>
        ))}
      </div>
      {timeline.auras.length > 0 && (
        <div className="space-y-1.5">
          <span className="lbl block">{t('forever.details.uptimes')}</span>
          {timeline.auras.map((aura) => (
            <Row
              key={`${aura.on}:${aura.name}`}
              icon={aura.icon}
              name={
                aura.on === 'target'
                  ? t('forever.details.onTarget', { name: aura.name })
                  : aura.name
              }
            >
              {aura.spans.map(([from, to], i) => (
                <span
                  key={i}
                  title={`${clock(from)} - ${clock(to)}`}
                  className={`absolute top-1 h-3 rounded-[2px] ${
                    aura.on === 'target' ? 'bg-info/60' : 'bg-gold-fill/70'
                  }`}
                  style={{ left: at(from), width: `calc(${at(to)} - ${at(from)})` }}
                />
              ))}
            </Row>
          ))}
        </div>
      )}
      {mana.length > 1 && (
        <div className="space-y-1.5">
          <span className="lbl block">{t('forever.details.mana')}</span>
          <div className="flex items-center gap-3">
            <span className="w-44 shrink-0 text-[12.5px] tabular-nums text-on-surface-variant">
              {t('forever.details.manaPeak', { value: Math.round(top).toLocaleString() })}
            </span>
            <svg
              viewBox="0 0 100 40"
              preserveAspectRatio="none"
              className="h-10 min-w-0 flex-1 rounded-[3px] bg-overlay/[0.03]"
              aria-hidden
            >
              <polyline
                points={points}
                fill="none"
                stroke="rgb(var(--c-primary))"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3">
        <span className="w-44 shrink-0" />
        <div className="relative h-4 min-w-0 flex-1">
          {ticks.map((s) => (
            <span
              key={s}
              className="absolute -translate-x-1/2 text-[10.5px] tabular-nums text-outline"
              style={{ left: at(s) }}
            >
              {clock(s)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
