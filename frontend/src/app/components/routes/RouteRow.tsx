'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSimContext } from '../sim-config/SimContext';
import { useLanguage } from '../../lib/i18n';
import { deleteSavedRoute, type SavedRoute } from '../../lib/saved-routes';
import { classifyRoute, routeToActiveRoute } from '../../lib/routes-model';
import { getRouteSimParams, setRouteSimParams } from '../../lib/route-sim-params';
import {
  ROUTES,
  MDT_ROUTE_SESSION_KEY,
  MDT_ROUTE_PULLS_SESSION_KEY,
} from '../../lib/routes';

const KIND_LABEL: Record<string, string> = {
  mdt: 'route.row.kindMdt',
  pulls: 'route.row.kindBuilt',
  simc: 'route.row.kindKsg',
  footer: 'route.row.kindLegacy',
};

/** One saved route: kind badge, (for level-agnostic kinds) key level + HP%
 *  inputs, and Sim / Map / Delete. Sim activates the route (sets sim-params +
 *  activeRoute) and navigates to Quick Sim. */
export default function RouteRow({
  route,
  onChanged,
}: {
  route: SavedRoute;
  onChanged: () => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const { setActiveRoute, setSimcFooter, setFightStyle } = useSimContext();
  const kind = classifyRoute(route);
  const levelAgnostic = kind === 'mdt' || kind === 'pulls';
  const mappable = kind === 'mdt' || kind === 'pulls';
  const [level, setLevel] = useState(() => String(getRouteSimParams().keystoneLevel));
  const [hp, setHp] = useState(() => String(getRouteSimParams().hpPercent));

  const onSim = () => {
    if (levelAgnostic) {
      setRouteSimParams({
        keystoneLevel: Math.max(2, Math.min(40, Math.round(Number(level)) || 10)),
        hpPercent: Math.max(1, Math.min(100, Math.round(Number(hp)) || 27)),
      });
    }
    if (kind === 'footer') {
      setActiveRoute(null);
      setSimcFooter(route.mdt_string);
      setFightStyle('Patchwerk');
    } else {
      const ar = routeToActiveRoute(route);
      if (!ar) return;
      setActiveRoute(ar);
      setSimcFooter('');
      setFightStyle('DungeonRoute');
    }
    router.push(ROUTES.quickSim);
  };

  const onMap = () => {
    try {
      if (kind === 'mdt') {
        sessionStorage.setItem(MDT_ROUTE_SESSION_KEY, route.mdt_string);
        sessionStorage.removeItem(MDT_ROUTE_PULLS_SESSION_KEY);
      } else if (kind === 'pulls') {
        sessionStorage.setItem(
          MDT_ROUTE_PULLS_SESSION_KEY,
          JSON.stringify({ dungeonIdx: route.dungeon_idx, pulls: JSON.parse(route.pulls!) })
        );
        sessionStorage.removeItem(MDT_ROUTE_SESSION_KEY);
      }
    } catch {}
    router.push(ROUTES.dungeonRoute);
  };

  return (
    <div className="flex items-center gap-2 rounded-md px-2.5 py-1.5 hover:bg-surface-container">
      <span className="min-w-0 flex-1 truncate text-[13px] text-on-surface">{route.name}</span>
      <span className="shrink-0 rounded bg-surface-container-high px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-on-surface-variant/70">
        {t(KIND_LABEL[kind])}
      </span>
      {levelAgnostic && (
        <>
          <label className="flex items-center gap-1 text-[12px] text-on-surface-variant/70">
            {t('route.row.keyLevel')}
            <input
              type="number"
              min={2}
              max={40}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="input-field w-12 text-center text-[12px]"
            />
          </label>
          <label className="flex items-center gap-1 text-[12px] text-on-surface-variant/70">
            {t('route.row.hpPercent')}
            <input
              type="number"
              min={1}
              max={100}
              value={hp}
              onChange={(e) => setHp(e.target.value)}
              className="input-field w-12 text-center text-[12px]"
            />
          </label>
        </>
      )}
      <button
        type="button"
        onClick={onSim}
        className="shrink-0 rounded bg-gold/10 px-2.5 py-1 text-[12px] font-medium text-gold transition-colors hover:bg-gold/20"
      >
        {t('route.row.sim')}
      </button>
      {mappable && (
        <button
          type="button"
          onClick={onMap}
          className="shrink-0 rounded px-2 py-1 text-[12px] text-on-surface-variant/70 transition-colors hover:text-on-surface"
        >
          {t('route.row.map')}
        </button>
      )}
      <button
        type="button"
        onClick={() => deleteSavedRoute(route.id).then(onChanged)}
        className="shrink-0 rounded px-2 py-1 text-[12px] text-on-surface-variant/40 transition-colors hover:text-red-400"
        aria-label={t('route.row.delete')}
      >
        ✕
      </button>
    </div>
  );
}
