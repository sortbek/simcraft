'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  decodeMdt,
  getDungeonOverview,
  listDungeons,
  serializeRoute,
  type CloneRef,
  type DungeonSummary,
  type MdtConversion,
} from '../lib/api';
import { useLanguage } from '../lib/i18n';
import type { ActiveRoute } from '../lib/active-route';
import { getRouteSimParams } from '../lib/route-sim-params';
import { ROUTES, MDT_ROUTE_SESSION_KEY } from '../lib/routes';
import { getSavedRoutes, type SavedRoute } from '../lib/saved-routes';
import { classifyRoute, routeToActiveRoute, routeUsesLevelKnobs } from '../lib/routes-model';
import RouteViewer from '../components/route-map/RouteViewer';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import { IImport } from '../components/route-map/routeIcons';

export default function RoutePage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conv, setConv] = useState<MdtConversion | null>(null);
  const [loadId, setLoadId] = useState(0);
  const [dungeons, setDungeons] = useState<DungeonSummary[]>([]);
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  // Id of the saved route currently shown (null for a fresh import or overview).
  const [activeId, setActiveId] = useState<string | null>(null);

  // Shared load: drive a conversion request into view state (busy/error/conv).
  const run = async (req: Promise<MdtConversion>, clearInput: boolean) => {
    setBusy(true);
    setError('');
    if (clearInput) setInput('');
    try {
      setConv(await req);
      setLoadId((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConv(null);
    } finally {
      setBusy(false);
    }
  };

  const load = (str: string) => {
    const trimmed = str.trim();
    if (trimmed) run(decodeMdt(trimmed, getRouteSimParams()), false);
  };
  // Browse a dungeon's map + enemies without an imported route (no pulls).
  const loadOverview = (idx: number) => run(getDungeonOverview(idx, getRouteSimParams()), true);
  // Render a saved built route by serializing it at the chosen level (same path used to sim it).
  const loadPulls = (dungeonIdx: number, pulls: CloneRef[][]) =>
    run(serializeRoute(dungeonIdx, pulls, getRouteSimParams()), true);

  // Load an in-memory route (deep-link or the header switcher) onto the map.
  const loadActiveRoute = (ar: ActiveRoute) => {
    if (ar.kind === 'mdt') {
      setInput(ar.mdtString);
      load(ar.mdtString);
    } else if (ar.kind === 'pulls') {
      setInput('');
      loadPulls(ar.dungeonIdx, ar.pulls);
    }
  };

  useEffect(() => {
    listDungeons()
      .then(setDungeons)
      .catch(() => {});
    getSavedRoutes()
      .then(setRoutes)
      .catch(() => {});
  }, []);

  // Deep-link: the routes manager stashes a route (serialized ActiveRoute) here.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(MDT_ROUTE_SESSION_KEY);
      if (!raw) return;
      sessionStorage.removeItem(MDT_ROUTE_SESSION_KEY);
      const ar = JSON.parse(raw) as ActiveRoute | null;
      if (!ar) return;
      // Only mdt/pulls routes have a map to render here; baked simc/footer can't
      // be shown, so don't strand an activeId pointing at an unrenderable route.
      if (!routeUsesLevelKnobs(ar.kind)) return;
      setActiveId(ar.id ?? null);
      loadActiveRoute(ar);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (conv) {
    // Other saved routes in this dungeon that can be shown on the map.
    const siblings = routes.filter(
      (r) => r.dungeon_idx === conv.map.dungeon_idx && routeUsesLevelKnobs(classifyRoute(r))
    );
    const onSwitch = (r: SavedRoute) => {
      const ar = routeToActiveRoute(r);
      if (!ar) return;
      setActiveId(r.id);
      loadActiveRoute(ar);
    };
    return (
      <div className="h-[calc(100vh-1rem)] p-2">
        <RouteViewer
          key={loadId}
          conv={conv}
          mdtString={input}
          onImport={() => {
            setConv(null);
            setError('');
            setActiveId(null);
          }}
          siblings={siblings}
          currentRouteId={activeId}
          onSwitch={onSwitch}
          onBack={() => router.push(ROUTES.routesManager)}
        />
      </div>
    );
  }

  // ── Empty state: import an MDT route ─────────────────────────────
  return (
    <div className="flex h-[calc(100vh-1rem)] items-center justify-center p-6">
      <div className="w-[540px] max-w-full">
        <div className="mb-5">
          <PageHeader
            eyebrow={t('nav.library')}
            title={t('route.title')}
            subtitle={t('route.subtitle')}
          />
        </div>

        <div className="card px-6 py-[22px]">
          {dungeons.length > 0 && (
            <div className="mb-4">
              <label className="label-text">{t('route.browseDungeon')}</label>
              <select
                defaultValue=""
                disabled={busy}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  if (idx) loadOverview(idx);
                }}
                className="sel cursor-pointer disabled:cursor-not-allowed"
              >
                <option value="">{t('route.selectDungeon')}</option>
                {dungeons.map((d) => (
                  <option key={d.idx} value={d.idx}>
                    {d.name}
                  </option>
                ))}
              </select>
              <div className="lbl mb-0.5 mt-3.5 text-center">{t('route.or')}</div>
            </div>
          )}
          <label className="label-text">{t('route.mdtImportLabel')}</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('route.placeholder')}
            rows={3}
            className="input-field resize-y font-mono text-[12px]"
          />
          {error && <div className="mt-2.5 text-[12px] text-negative">{error}</div>}
          <div className="mt-3 flex justify-end">
            <Button variant="solid" onClick={() => load(input)} disabled={busy || !input.trim()}>
              <IImport s={13} /> {busy ? t('route.loading') : t('route.load')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
