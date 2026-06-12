'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSavedRoutes, type SavedRoute } from '../lib/saved-routes';
import { listDungeons, type DungeonSummary } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import RouteImportPanel from '../components/routes/RouteImportPanel';
import RouteRow from '../components/routes/RouteRow';

export default function RoutesManagerPage() {
  const { t } = useLanguage();
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [dungeons, setDungeons] = useState<DungeonSummary[]>([]);

  const refresh = useCallback(() => {
    getSavedRoutes().then(setRoutes);
  }, []);

  useEffect(() => {
    refresh();
    listDungeons().then(setDungeons).catch(() => {});
  }, [refresh]);

  // Group by dungeon_idx (only when that dungeon is known); the rest → "Other".
  // Dungeon groups follow the dungeon list order; "Other" is last.
  const groups = useMemo(() => {
    const byKey = new Map<number | null, SavedRoute[]>();
    for (const r of routes) {
      const known = r.dungeon_idx != null && dungeons.some((d) => d.idx === r.dungeon_idx);
      const key = known ? r.dungeon_idx! : null;
      const arr = byKey.get(key) ?? [];
      arr.push(r);
      byKey.set(key, arr);
    }
    const out: { key: number | null; name: string; routes: SavedRoute[] }[] = [];
    for (const d of dungeons) {
      const rs = byKey.get(d.idx);
      if (rs && rs.length) out.push({ key: d.idx, name: d.name, routes: rs });
    }
    const other = byKey.get(null);
    if (other && other.length) out.push({ key: null, name: t('route.group.other'), routes: other });
    return out;
  }, [routes, dungeons, t]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-6">
      <div>
        <h1 className="font-headline text-lg font-bold text-on-surface">{t('route.manager.title')}</h1>
        <p className="text-[13px] text-on-surface-variant/70">{t('route.manager.subtitle')}</p>
      </div>

      <RouteImportPanel dungeons={dungeons} onSaved={refresh} />

      {groups.length === 0 ? (
        <p className="px-1 text-[13px] text-on-surface-variant/50">{t('route.manager.empty')}</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.key ?? 'other'} className="space-y-0.5">
              <h2 className="px-1 pb-1 font-headline text-[11px] font-bold uppercase tracking-wider text-on-surface-variant/60">
                {g.name}
              </h2>
              {g.routes.map((r) => (
                <RouteRow key={r.id} route={r} onChanged={refresh} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
