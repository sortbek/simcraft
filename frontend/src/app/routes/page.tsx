'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSavedRoutes, type SavedRoute } from '../lib/saved-routes';
import { listDungeons, type DungeonSummary } from '../lib/api';
import { groupRoutesByDungeon } from '../lib/routes-model';
import RouteImportPanel from '../components/routes/RouteImportPanel';
import RouteRow from '../components/routes/RouteRow';
import { T } from '../components/route-map/routeTheme';
import { IList } from '../components/route-map/routeIcons';
import { useLanguage } from '../lib/i18n';

const GroupHead = ({ name, count }: { name: string; count: number }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 11, margin: '24px 0 11px' }}>
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: T.text2,
      }}
    >
      {name}
    </span>
    <span
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        color: T.muted,
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 20,
        padding: '1px 8px',
      }}
    >
      {count}
    </span>
    <span style={{ flex: 1, height: 1, background: T.border }} />
  </div>
);

export default function RoutesManagerPage() {
  const { t } = useLanguage();
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [dungeons, setDungeons] = useState<DungeonSummary[]>([]);

  const refresh = useCallback(() => {
    getSavedRoutes().then(setRoutes);
  }, []);

  useEffect(() => {
    refresh();
    listDungeons()
      .then(setDungeons)
      .catch(() => {});
  }, [refresh]);

  // Group by dungeon (dungeon-list order; unknown-dungeon routes under "Other").
  const groups = useMemo(
    () => groupRoutesByDungeon(routes, dungeons, t('route.group.other')),
    [routes, dungeons, t]
  );

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: T.bg }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '30px 28px 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: T.text, letterSpacing: '-0.01em' }}>
            {t('route.manager.title')}
          </h1>
          <span style={{ fontSize: 11.5, color: T.muted }}>
            {t('route.manager.count', { routes: routes.length, dungeons: groups.length })}
          </span>
        </div>
        <p style={{ fontSize: 13, color: T.text2, marginTop: 6 }}>{t('route.manager.subtitle')}</p>

        <div style={{ marginTop: 22 }}>
          <RouteImportPanel dungeons={dungeons} onSaved={refresh} />
        </div>

        {groups.map((g) => (
          <div key={g.key ?? 'other'}>
            <GroupHead name={g.name} count={g.routes.length} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {g.routes.map((r) => (
                <RouteRow key={r.id} route={r} onChanged={refresh} />
              ))}
            </div>
          </div>
        ))}

        {routes.length === 0 && (
          <div style={{ textAlign: 'center', padding: '70px 0', color: T.muted }}>
            <div
              style={{
                display: 'inline-flex',
                width: 48,
                height: 48,
                borderRadius: 12,
                background: T.surface,
                border: `1px solid ${T.border}`,
                alignItems: 'center',
                justifyContent: 'center',
                color: T.dim,
                marginBottom: 14,
              }}
            >
              <IList s={20} />
            </div>
            <div style={{ fontSize: 13, color: T.text2 }}>{t('route.manager.empty')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
