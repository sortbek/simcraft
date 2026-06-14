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
import { T } from '../components/route-map/routeTheme';
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
  // Render a saved built route (dungeon + pull assignment) by serializing it at
  // the chosen level (same path used to sim it).
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
      <div style={{ height: 'calc(100vh - 1rem)', padding: 8 }}>
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
    <div
      style={{
        height: 'calc(100vh - 1rem)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: T.bg,
      }}
    >
      <div style={{ width: 540, maxWidth: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
          <span style={{ color: T.gold, display: 'flex' }}>
            <IImport s={16} />
          </span>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{t('route.title')}</h1>
        </div>
        <p style={{ fontSize: 12.5, color: T.muted, marginBottom: 18 }}>{t('route.subtitle')}</p>

        <div
          style={{
            background: T.panel,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: 18,
          }}
        >
          {dungeons.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: T.muted,
                }}
              >
                {t('route.browseDungeon')}
              </label>
              <select
                defaultValue=""
                disabled={busy}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  if (idx) loadOverview(idx);
                }}
                style={{
                  width: '100%',
                  marginTop: 8,
                  padding: '10px 12px',
                  borderRadius: 7,
                  background: T.surface,
                  border: `1px solid ${T.borderHi}`,
                  color: T.text,
                  fontSize: 12,
                  outline: 'none',
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                <option value="">{t('route.selectDungeon')}</option>
                {dungeons.map((d) => (
                  <option key={d.idx} value={d.idx}>
                    {d.name}
                  </option>
                ))}
              </select>
              <div
                style={{
                  textAlign: 'center',
                  fontSize: 11,
                  color: T.muted,
                  margin: '14px 0 2px',
                }}
              >
                {t('route.or')}
              </div>
            </div>
          )}
          <label
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: T.muted,
            }}
          >
            {t('route.mdtImportLabel')}
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('route.placeholder')}
            rows={3}
            style={{
              width: '100%',
              marginTop: 8,
              padding: '10px 12px',
              borderRadius: 7,
              background: T.surface,
              border: `1px solid ${T.borderHi}`,
              color: T.text,
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              resize: 'vertical',
              outline: 'none',
            }}
          />
          {error && <div style={{ marginTop: 10, fontSize: 12, color: T.red }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button
              type="button"
              onClick={() => load(input)}
              disabled={busy || !input.trim()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '8px 16px',
                borderRadius: 7,
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.03em',
                background: T.gold,
                color: '#141414',
                border: 'none',
                cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
                opacity: busy || !input.trim() ? 0.5 : 1,
              }}
            >
              <IImport s={13} /> {busy ? t('route.loading') : t('route.load')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
