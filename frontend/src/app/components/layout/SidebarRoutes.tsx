'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSimContext } from '../sim-config/SimContext';
import {
  getSavedRoutes,
  saveRoute,
  deleteSavedRoute,
  type SavedRoute,
} from '../../lib/saved-routes';
import { serializeRoute } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';

/** Strip a previously-injected DungeonRoute so loading another replaces it
 *  cleanly (mirrors the MDT importer). */
function stripPriorRoute(s: string): string {
  return s
    .split('\n')
    .filter((l) => !l.startsWith('raid_events+=/pull') && l.trim() !== 'fight_style=DungeonRoute')
    .join('\n')
    .trim();
}

export default function SidebarRoutes() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [routeName, setRouteName] = useState('');
  const [routeString, setRouteString] = useState('');
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const { setFightStyle, simcFooter, setSimcFooter, customApl, setCustomApl } = useSimContext();

  // A route is "active" when its definition is currently injected into the sim.
  const isRouteActive = useCallback(
    (r: SavedRoute) => (r.simc ? customApl.includes(r.simc) : simcFooter === r.mdt_string),
    [customApl, simcFooter]
  );

  const refreshRoutes = useCallback(() => {
    getSavedRoutes().then(setSavedRoutes);
  }, []);

  useEffect(() => {
    refreshRoutes();
  }, [refreshRoutes]);

  const activeRouteName = useMemo(() => {
    const match = savedRoutes.find(isRouteActive);
    return match?.name ?? null;
  }, [savedRoutes, isRouteActive]);

  const handleLoadRoute = useCallback(
    async (route: SavedRoute) => {
      if (route.dungeon_idx != null && route.pulls) {
        // Level-agnostic route: regenerate the DungeonRoute at a default level
        // (the per-sim keystone level control overrides this on import).
        try {
          const pulls = JSON.parse(route.pulls);
          const conv = await serializeRoute(route.dungeon_idx, pulls, { keystoneLevel: 10 });
          setFightStyle('DungeonRoute');
          const base = stripPriorRoute(customApl);
          setCustomApl(base ? `${base}\n${conv.simc}` : conv.simc);
        } catch {
          // fall through to legacy handling below on parse/serialize failure
        }
        return;
      }
      if (route.simc) {
        setFightStyle('DungeonRoute');
        const base = stripPriorRoute(customApl);
        setCustomApl(base ? `${base}\n${route.simc}` : route.simc);
      } else {
        setSimcFooter(route.mdt_string);
        setFightStyle('Patchwerk');
      }
    },
    [customApl, setCustomApl, setSimcFooter, setFightStyle]
  );

  const handleSaveRoute = useCallback(() => {
    if (!routeName.trim() || !routeString.trim()) return;
    saveRoute(routeName.trim(), { mdtString: routeString.trim() }).then(() => {
      setRouteName('');
      setRouteString('');
      setShowForm(false);
      refreshRoutes();
    });
  }, [routeName, routeString, refreshRoutes]);

  return (
    <div className="shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center px-6 py-3 text-left font-headline text-xs font-bold uppercase tracking-wider transition-all ${
          open ? 'text-on-surface' : 'text-on-surface-variant hover:bg-surface hover:text-white'
        }`}
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span>{t('layout.routes')}</span>
          {activeRouteName && (
            <span className="truncate text-[10px] font-medium normal-case tracking-normal text-primary/70">
              · {activeRouteName}
            </span>
          )}
        </span>
        <svg
          className={`h-3 w-3 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>

      {/* + New Route quick action — always visible (hidden while the form is open) */}
      {!showForm && (
        <div className="px-6 pb-3 pt-0">
          <button
            onClick={() => {
              setOpen(true);
              setShowForm(true);
            }}
            className="w-full cursor-pointer border border-dashed border-outline-variant/30 px-2.5 py-1.5 text-left font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/60 transition-colors hover:border-on-surface-variant hover:text-on-surface"
          >
            + {t('layout.saveNewRoute')}
          </button>
        </div>
      )}

      {open && (
        <div className="space-y-1 px-3 pb-3">
          <div className="max-h-48 space-y-0.5 overflow-y-auto">
            {savedRoutes.map((route) => {
              const isActive = isRouteActive(route);
              return (
                <div
                  key={route.id}
                  className={`flex items-center rounded-md ${
                    isActive ? 'bg-gold/[0.08]' : 'hover:bg-surface-container'
                  }`}
                >
                  <button
                    onClick={() => handleLoadRoute(route)}
                    className={`min-w-0 flex-1 truncate px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                      isActive
                        ? 'font-medium text-gold'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {route.name}
                  </button>
                  <button
                    onClick={() => deleteSavedRoute(route.id).then(refreshRoutes)}
                    className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-on-surface-variant/30 transition-colors hover:bg-red-400/10 hover:text-red-400"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>

          {showForm ? (
            <div className="space-y-1.5 rounded-lg bg-surface-container-high p-2">
              <input
                type="text"
                value={routeName}
                onChange={(e) => setRouteName(e.target.value)}
                placeholder={t('layout.routeNamePlaceholder')}
                className="w-full rounded bg-surface-container-high px-2 py-1 text-[12px] text-on-surface placeholder-on-surface-variant/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
                autoFocus
              />
              <textarea
                value={routeString}
                onChange={(e) => setRouteString(e.target.value)}
                placeholder={t('layout.pasteMdtString')}
                className="h-20 w-full resize-y rounded bg-surface-container-high px-2 py-1 font-mono text-[11px] text-on-surface placeholder-on-surface-variant/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={handleSaveRoute}
                  disabled={!routeName.trim() || !routeString.trim()}
                  className="rounded bg-gold/10 px-2.5 py-1 text-[12px] font-medium text-gold transition-colors hover:bg-gold/20 disabled:opacity-40"
                >
                  {t('common.save')}
                </button>
                <button
                  onClick={() => {
                    setShowForm(false);
                    setRouteName('');
                    setRouteString('');
                  }}
                  className="rounded px-2.5 py-1 text-[12px] text-on-surface-variant/60 transition-colors hover:text-on-surface"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
