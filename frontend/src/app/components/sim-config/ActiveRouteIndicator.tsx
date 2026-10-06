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
import { buttonClass } from '../ui/Button';

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
    <span className="lbl">{label}</span>
    <div className="flex items-center overflow-hidden rounded-[6px] border border-line/[0.06] bg-surface-container-high">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-8 w-7 items-center justify-center text-outline transition-colors hover:bg-surface-container-highest hover:text-on-surface"
      >
        <IMinus s={11} />
      </button>
      <span className="min-w-[2.1rem] text-center font-headline text-[13px] font-extrabold tabular-nums text-on-surface">
        {prefix}
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-8 w-7 items-center justify-center text-outline transition-colors hover:bg-surface-container-highest hover:text-on-surface"
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
    <div className="card flex items-center gap-3 !border-gold/35 px-4 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-gold/10 text-gold">
        <IRoute />
      </span>

      <div className="min-w-0 flex-1">
        <div className="lbl mb-2 text-gold">{t('route.active.label')}</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Custom route dropdown — mirrors FightStyleSelector for consistency. */}
          <div className="relative" onBlur={() => setOpen(false)}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex h-[38px] max-w-[18rem] items-center gap-2 rounded-[6px] border border-line/[0.06] bg-surface-container-high px-3 text-left transition-colors hover:border-line/[0.11]"
            >
              <span
                className={`truncate text-sm font-semibold ${
                  currentName ? 'text-on-surface' : 'text-outline'
                }`}
              >
                {currentName ?? t('route.active.selectPlaceholder')}
              </span>
              <svg
                className={`h-4 w-4 shrink-0 text-outline transition-transform duration-150 ${
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
                className="popover absolute z-50 mt-1 min-w-full overflow-y-auto overscroll-contain py-1"
                style={{ maxHeight: '14rem' }}
              >
                {groups.length === 0 ? (
                  <div className="px-3.5 py-2 text-sm text-outline">
                    {t('route.active.noneSaved')}
                  </div>
                ) : (
                  groups.map((g) => (
                    <div key={g.key ?? 'other'}>
                      <div className="lbl px-3.5 pb-1.5 pt-2.5">{g.name}</div>
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
        <button type="button" onClick={clearRoute} className={`shrink-0 ${buttonClass('text')}`}>
          {t('common.clear')}
        </button>
      )}
    </div>
  );
}
