'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSimContext } from '../sim-config/SimContext';
import {
  getSavedRoutes,
  saveRoute,
  deleteSavedRoute,
  type SavedRoute,
} from '../../lib/saved-routes';
import { useLanguage } from '../../lib/i18n';

export default function SidebarRoutes() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [routeName, setRouteName] = useState('');
  const [routeString, setRouteString] = useState('');
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const { setFightStyle, simcFooter, setSimcFooter } = useSimContext();

  const refreshRoutes = useCallback(() => {
    getSavedRoutes().then(setSavedRoutes);
  }, []);

  useEffect(() => {
    refreshRoutes();
  }, [refreshRoutes]);

  const activeRouteName = useMemo(() => {
    if (!simcFooter) return null;
    const match = savedRoutes.find((r) => r.mdt_string === simcFooter);
    return match?.name ?? null;
  }, [simcFooter, savedRoutes]);

  const handleLoadRoute = useCallback(
    (mdtString: string) => {
      setSimcFooter(mdtString);
      setFightStyle('DungeonRoute');
    },
    [setSimcFooter, setFightStyle]
  );

  const handleSaveRoute = useCallback(() => {
    if (!routeName.trim() || !routeString.trim()) return;
    saveRoute(routeName.trim(), routeString.trim()).then(() => {
      setRouteName('');
      setRouteString('');
      setShowForm(false);
      refreshRoutes();
    });
  }, [routeName, routeString, refreshRoutes]);

  return (
    <div className="shrink-0 px-3 py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left font-headline font-bold text-xs uppercase transition-all duration-150 ${
          open
            ? 'bg-primary-container/10 text-primary'
            : 'text-on-surface-variant hover:bg-surface hover:text-white'
        }`}
      >
        <svg
          className={`h-4 w-4 shrink-0 transition-colors ${
            open ? 'text-gold' : 'text-on-surface-variant/40 group-hover:text-on-surface-variant'
          }`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 3h12M2 8h8M2 13h10" />
        </svg>
        <div className="min-w-0 flex-1">
          {activeRouteName ? (
            <>
              <div className="truncate text-[14px] leading-tight">{t('layout.routes')}</div>
              <div className="truncate text-[11px] font-normal text-on-surface-variant/60">
                {activeRouteName}
              </div>
            </>
          ) : (
            t('layout.routes')
          )}
        </div>
        <svg
          className={`h-3 w-3 shrink-0 text-on-surface-variant/40 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div className="mt-1.5 space-y-1 px-1 pb-1">
          {savedRoutes.map((route) => {
            const isActive = simcFooter === route.mdt_string;
            return (
              <div
                key={route.id}
                className={`flex items-center justify-between rounded-md px-2.5 py-1.5 ${
                  isActive ? 'bg-gold/[0.08]' : 'hover:bg-surface-container'
                }`}
              >
                <button
                  onClick={() => handleLoadRoute(route.mdt_string)}
                  className={`min-w-0 truncate text-[13px] transition-colors ${
                    isActive ? 'font-medium text-gold' : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {route.name}
                </button>
                <button
                  onClick={() => deleteSavedRoute(route.id).then(refreshRoutes)}
                  className="ml-2 shrink-0 text-[13px] text-on-surface-variant/30 hover:text-red-400 transition-colors"
                >
                  &times;
                </button>
              </div>
            );
          })}

          {showForm ? (
            <div className="space-y-1.5 rounded-lg bg-surface-container-high p-2">
              <input
                type="text"
                value={routeName}
                onChange={(e) => setRouteName(e.target.value)}
                placeholder={t('layout.routeNamePlaceholder')}
                className="w-full rounded bg-surface-container-high px-2 py-1 text-[12px] text-on-surface placeholder-on-surface-variant/30 focus:ring-1 focus:ring-primary/30 focus:outline-none"
                autoFocus
              />
              <textarea
                value={routeString}
                onChange={(e) => setRouteString(e.target.value)}
                placeholder={t('layout.pasteMdtString')}
                className="h-20 w-full resize-y rounded bg-surface-container-high px-2 py-1 font-mono text-[11px] text-on-surface placeholder-on-surface-variant/30 focus:ring-1 focus:ring-primary/30 focus:outline-none"
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
                  className="rounded px-2.5 py-1 text-[12px] text-on-surface-variant/60 hover:text-on-surface transition-colors"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-on-surface-variant/60 transition-colors hover:text-on-surface"
            >
              <span className="text-[15px] leading-none">+</span>
              {t('layout.saveNewRoute')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
