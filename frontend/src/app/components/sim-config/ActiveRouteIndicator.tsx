'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import {
  getRouteSimParams,
  setRouteSimParams,
  type RouteSimParams,
} from '../../lib/route-sim-params';
import { getSavedRoutes, type SavedRoute } from '../../lib/saved-routes';
import { listDungeons, type DungeonSummary } from '../../lib/api';
import {
  groupRoutesByDungeon,
  routeToActiveRoute,
  routeUsesLevelKnobs,
} from '../../lib/routes-model';
import { IPlus, IMinus } from '../route-map/routeIcons';

const IRoute = () => (
  <svg
    className="h-4 w-4"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="3.5" cy="12.5" r="1.5" />
    <circle cx="12.5" cy="3.5" r="1.5" />
    <path d="M3.5 11V7a2 2 0 0 1 2-2h5a2 2 0 0 0 2-2" />
  </svg>
);

/** Compact ± stepper for the route's keystone level / HP share. */
const Stepper = ({
  label,
  value,
  min,
  max,
  prefix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  prefix?: string;
  onChange: (v: number) => void;
}) => (
  <div className="flex items-center gap-1.5">
    <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/55">
      {label}
    </span>
    <div className="flex items-center overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container-lowest">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-7 w-6 items-center justify-center text-on-surface-variant/70 transition-colors hover:bg-surface-container-high hover:text-gold"
      >
        <IMinus s={11} />
      </button>
      <span className="min-w-[2.1rem] text-center text-[13px] font-bold tabular-nums text-on-surface">
        {prefix}
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-7 w-6 items-center justify-center text-on-surface-variant/70 transition-colors hover:bg-surface-container-high hover:text-gold"
      >
        <IPlus s={11} />
      </button>
    </div>
  </div>
);

/** Route control for the sim config: a FightStyleSelector-styled dropdown picks the
 *  active saved route, with keystone-level + HP-share steppers (which drive the route's
 *  SimC at sim time) and a clear button beside it. Routes also load from /routes. */
export default function ActiveRouteIndicator() {
  const { t } = useLanguage();
  const { isDungeonRoute, activeRoute, activateRoute, clearRoute } = useSimContext();
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [dungeons, setDungeons] = useState<DungeonSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [params, setParams] = useState<RouteSimParams>(getRouteSimParams);

  // Shown in Dungeon Route mode or whenever a route is loaded (incl. a legacy footer
  // route on Patchwerk), so an active route is always visible and clearable.
  const show = isDungeonRoute || activeRoute != null;

  // Only fetch the picker's lists when the control is actually shown.
  useEffect(() => {
    if (!show) return;
    let alive = true;
    getSavedRoutes().then((r) => {
      if (alive) setRoutes(r);
    });
    listDungeons()
      .then((d) => {
        if (alive) setDungeons(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [show]);

  // Group saved routes by dungeon for the picker (shared with the routes manager).
  const groups = useMemo(
    () => groupRoutesByDungeon(routes, dungeons, t('route.group.other')),
    [routes, dungeons, t]
  );

  if (!show) return null;

  const onPick = (id: string) => {
    setOpen(false);
    const r = routes.find((x) => x.id === id);
    if (!r) return;
    const ar = routeToActiveRoute(r);
    if (ar) activateRoute(ar);
  };

  const updateParams = (p: Partial<RouteSimParams>) => {
    setParams((prev) => ({ ...prev, ...p }));
    setRouteSimParams(p);
  };

  // Baked routes (pre-rendered SimC) carry no level/HP knobs; mdt/pulls do.
  const baked = activeRoute ? !routeUsesLevelKnobs(activeRoute.kind) : false;
  const currentName = activeRoute?.name ?? null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-gold/35 bg-gold/[0.05] px-4 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold/10 text-gold">
        <IRoute />
      </span>

      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-widest text-gold/70">
          {t('route.active.label')}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Custom route dropdown — mirrors FightStyleSelector for consistency. */}
          <div className="relative" onBlur={() => setOpen(false)}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex max-w-[18rem] items-center gap-2 rounded-lg border border-gold/30 bg-surface-container-lowest px-3 py-1.5 text-left transition-colors hover:border-gold/55"
            >
              <span
                className={`truncate text-sm font-bold ${
                  currentName ? 'text-gold' : 'text-on-surface-variant/60'
                }`}
              >
                {currentName ?? t('route.active.selectPlaceholder')}
              </span>
              <svg
                className={`h-4 w-4 shrink-0 text-on-surface-variant/60 transition-transform duration-150 ${
                  open ? 'rotate-180' : ''
                }`}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
            {open && (
              <div
                className="absolute z-50 mt-1 min-w-full overflow-y-auto overscroll-contain rounded-lg bg-surface-container-high py-1 shadow-lg shadow-black/40"
                style={{ maxHeight: '14rem' }}
              >
                {groups.length === 0 ? (
                  <div className="px-3.5 py-2 text-sm text-on-surface-variant/50">
                    {t('route.active.noneSaved')}
                  </div>
                ) : (
                  groups.map((g) => (
                    <div key={g.key ?? 'other'}>
                      <div className="px-3.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/40">
                        {g.name}
                      </div>
                      {g.routes.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onMouseDown={() => onPick(r.id)}
                          className={`flex w-full whitespace-nowrap px-3.5 py-1.5 text-left text-sm transition-colors ${
                            r.id === activeRoute?.id
                              ? 'bg-gold/[0.08] text-gold'
                              : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
                          }`}
                        >
                          {r.name}
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {activeRoute && !baked && (
            <>
              <Stepper
                label={t('route.row.keyLevel')}
                value={params.keystoneLevel}
                min={2}
                max={40}
                prefix="+"
                onChange={(v) => updateParams({ keystoneLevel: v })}
              />
              <Stepper
                label={t('route.row.hpPercent')}
                value={params.hpPercent}
                min={1}
                max={100}
                onChange={(v) => updateParams({ hpPercent: v })}
              />
            </>
          )}
        </div>
      </div>

      {activeRoute && (
        <button
          type="button"
          onClick={clearRoute}
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] text-on-surface-variant/70 transition-colors hover:bg-surface-container-high hover:text-on-surface"
        >
          {t('common.clear')}
        </button>
      )}
    </div>
  );
}
