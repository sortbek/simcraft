'use client';

import { useEffect, useState } from 'react';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import { getRouteSimParams } from '../../lib/route-sim-params';
import { getSavedRoutes, type SavedRoute } from '../../lib/saved-routes';
import { routeToActiveRoute } from '../../lib/routes-model';

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

/** Route control for the sim config, shown only in Dungeon Route fight style.
 *  A custom dropdown (styled to match FightStyleSelector) picks/switches the
 *  active saved route; the chosen route's key/HP and a clear button sit beside
 *  it. Routes can also be loaded from the /routes manager. */
export default function ActiveRouteIndicator() {
  const { t } = useLanguage();
  const { fightStyle, activeRoute, activateRoute, clearRoute } = useSimContext();
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    getSavedRoutes().then((r) => {
      if (alive) setRoutes(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  // The route control belongs to Dungeon Route mode only.
  if (fightStyle !== 'DungeonRoute') return null;

  const onPick = (id: string) => {
    setOpen(false);
    const r = routes.find((x) => x.id === id);
    if (!r) return;
    const ar = routeToActiveRoute(r);
    if (ar) activateRoute(ar);
  };

  const { keystoneLevel, hpPercent } = getRouteSimParams();
  // Baked routes (pre-rendered SimC) carry no level/HP knobs; mdt/pulls do.
  const baked = activeRoute?.kind === 'simc' || activeRoute?.kind === 'footer';
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
        <div className="flex items-center gap-2.5">
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
                {routes.length === 0 ? (
                  <div className="px-3.5 py-2 text-sm text-on-surface-variant/50">
                    {t('route.active.noneSaved')}
                  </div>
                ) : (
                  routes.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onMouseDown={() => onPick(r.id)}
                      className={`flex w-full whitespace-nowrap px-3.5 py-2 text-left text-sm transition-colors ${
                        r.id === activeRoute?.id
                          ? 'bg-gold/[0.08] text-gold'
                          : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
                      }`}
                    >
                      {r.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {activeRoute && !baked && (
            <span className="shrink-0 text-[12px] text-on-surface-variant">
              {t('route.active.detail', { level: keystoneLevel, hp: hpPercent })}
            </span>
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
