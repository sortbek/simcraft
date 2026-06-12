'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSavedRoutes, type SavedRoute } from '../lib/saved-routes';
import { listDungeons, type DungeonSummary } from '../lib/api';
import RouteImportPanel from '../components/routes/RouteImportPanel';
import RouteRow from '../components/routes/RouteRow';
import { T } from '../components/route-map/routeTheme';
import { IList } from '../components/route-map/routeIcons';

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
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [dungeons, setDungeons] = useState<DungeonSummary[]>([]);

  const refresh = useCallback(() => {
    getSavedRoutes().then(setRoutes);
  }, []);

  useEffect(() => {
    refresh();
    listDungeons().then(setDungeons).catch(() => {});
  }, [refresh]);

  // Group by dungeon (only when that dungeon is known); the rest → "Other".
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
    if (other && other.length) out.push({ key: null, name: 'Other', routes: other });
    return out;
  }, [routes, dungeons]);

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: T.bg }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '30px 28px 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: T.text, letterSpacing: '-0.01em' }}>M+ Routes</h1>
          <span style={{ fontSize: 11.5, color: T.muted }}>
            {routes.length} routes · {groups.length} dungeons
          </span>
        </div>
        <p style={{ fontSize: 13, color: T.text2, marginTop: 6 }}>
          Import, organize and sim your dungeon routes — then open any on the map.
        </p>

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
            <div style={{ fontSize: 13, color: T.text2 }}>
              No routes yet — paste an import string above to get started.
            </div>
          </div>
        )}

        <div style={{ textAlign: 'center', padding: '56px 40px 40px', maxWidth: 560, margin: '0 auto' }}>
          <p style={{ fontSize: 11.5, lineHeight: 1.7, color: T.dim }}>
            SimHammer is a pet project held together by coffee, duct tape, and prayers to the RNG gods.
            Bugs are not features — but they might sim higher than your gear. Not affiliated with Blizzard,
            Raidbots, or anyone who knows what they&apos;re doing.
          </p>
          <p style={{ fontSize: 10.5, color: T.faint, marginTop: 14, letterSpacing: '0.08em' }}>v4.0.0</p>
        </div>
      </div>
    </div>
  );
}
