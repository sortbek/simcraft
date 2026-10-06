'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSavedRoutes, type SavedRoute } from '../lib/saved-routes';
import { listDungeons, type DungeonSummary } from '../lib/api';
import { groupRoutesByDungeon } from '../lib/routes-model';
import RouteImportPanel from '../components/routes/RouteImportPanel';
import RouteRow from '../components/routes/RouteRow';
import PageHeader from '../components/ui/PageHeader';
import { IList } from '../components/route-map/routeIcons';
import { useLanguage } from '../lib/i18n';

const GroupHead = ({ name, count }: { name: string; count: number }) => (
  <div className="mb-3 mt-6 flex items-center gap-3">
    <span className="lbl text-on-surface-variant">{name}</span>
    <span className="rounded-full bg-overlay/[0.04] px-2 py-px font-headline text-[11px] font-bold text-outline">
      {count}
    </span>
    <span className="h-px flex-1 bg-overlay/[0.06]" />
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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1000px] pb-20">
        <div className="flex items-end justify-between gap-6">
          <PageHeader
            eyebrow={t('nav.library')}
            title={t('route.manager.title')}
            subtitle={t('route.manager.subtitle')}
          />
          <span className="shrink-0 text-[12.5px] text-outline">
            {t('route.manager.count', { routes: routes.length, dungeons: groups.length })}
          </span>
        </div>

        <div className="mt-5">
          <RouteImportPanel dungeons={dungeons} onSaved={refresh} />
        </div>

        {groups.map((g) => (
          <div key={g.key ?? 'other'}>
            <GroupHead name={g.name} count={g.routes.length} />
            <div className="flex flex-col gap-2.5">
              {g.routes.map((r) => (
                <RouteRow key={r.id} route={r} onChanged={refresh} />
              ))}
            </div>
          </div>
        ))}

        {routes.length === 0 && (
          <div className="py-[70px] text-center text-outline">
            <div className="mb-3.5 inline-flex h-12 w-12 items-center justify-center rounded-[10px] border border-line/[0.06] bg-surface-container-high text-fg-4">
              <IList s={20} />
            </div>
            <div className="text-[13px] text-on-surface-variant">{t('route.manager.empty')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
