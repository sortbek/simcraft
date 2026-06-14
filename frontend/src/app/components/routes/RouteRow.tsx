'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSimContext } from '../sim-config/SimContext';
import { deleteSavedRoute, type SavedRoute } from '../../lib/saved-routes';
import {
  classifyRoute,
  routeToActiveRoute,
  routeStats,
  routeUsesLevelKnobs,
  seedFromId,
  type RouteKind,
} from '../../lib/routes-model';
import { getRouteSimParams, setRouteSimParams } from '../../lib/route-sim-params';
import { ROUTES, MDT_ROUTE_SESSION_KEY } from '../../lib/routes';
import { useLanguage } from '../../lib/i18n';
import { timeAgo } from '../../sims/_components/shared';
import { T, SOURCE_COLORS } from '../route-map/routeTheme';
import { IPlay, IList, ITrash, IPlus, IMinus } from '../route-map/routeIcons';
import RouteMiniMap, { type ShapePoint } from './RouteMiniMap';

/** Localized source label per route kind (the badge next to the source dot). */
const KIND_LABEL_KEY: Record<RouteKind, string> = {
  mdt: 'route.row.kindMdt',
  pulls: 'route.row.kindBuilt',
  simc: 'route.row.kindKsg',
  footer: 'route.row.kindLegacy',
};

const Stepper = ({
  label,
  value,
  min,
  max,
  prefix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  prefix?: string;
  onChange: (v: number) => void;
}) => {
  const Btn = ({ dir }: { dir: number }) => {
    const [bh, setBh] = useState(false);
    return (
      <button
        type="button"
        onMouseEnter={() => setBh(true)}
        onMouseLeave={() => setBh(false)}
        onClick={() => onChange(Math.max(min, Math.min(max, value + dir)))}
        style={{
          width: 22,
          height: 26,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: bh ? T.surfaceHi : 'transparent',
          border: 'none',
          color: bh ? T.gold : T.text2,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {dir > 0 ? <IPlus s={11} /> : <IMinus s={11} />}
      </button>
    );
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: T.muted,
        }}
      >
        {label}
      </span>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: T.surface,
          border: `1px solid ${T.borderHi}`,
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <Btn dir={-1} />
        <span
          style={{
            minWidth: 34,
            textAlign: 'center',
            fontSize: 12,
            fontWeight: 700,
            color: T.text,
            fontVariantNumeric: 'tabular-nums',
            padding: '0 2px',
          }}
        >
          {prefix}
          {value}
        </span>
        <Btn dir={1} />
      </div>
    </div>
  );
};

const ActBtn = ({
  icon,
  label,
  primary,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label?: string;
  primary?: boolean;
  danger?: boolean;
  onClick: () => void;
}) => {
  const [h, setH] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: label ? '7px 13px' : '7px 8px',
        borderRadius: 7,
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.03em',
        transition: 'all .12s',
        background: primary
          ? h
            ? T.gold
            : T.goldSub
          : h
            ? danger
              ? 'rgba(224,82,74,0.12)'
              : T.surfaceHi
            : 'transparent',
        border: `1px solid ${
          primary
            ? h
              ? T.gold
              : T.goldBord
            : danger
              ? h
                ? 'rgba(224,82,74,0.5)'
                : T.border
              : h
                ? T.borderHi
                : T.border
        }`,
        color: primary
          ? h
            ? '#141414'
            : T.gold
          : danger
            ? h
              ? T.red
              : T.muted
            : h
              ? T.text
              : T.text2,
      }}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
};

/** One saved route, rendered as a library card. [Sim] sets the chosen key/HP +
 *  activates the route, then navigates to Quick Sim (activate-only flow). */
export default function RouteRow({ route, onChanged }: { route: SavedRoute; onChanged: () => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const { activateRoute } = useSimContext();
  const kind = useMemo(() => classifyRoute(route), [route]);
  // mdt + pulls routes are level-agnostic (sim at any key) and have map data;
  // simc is baked and footer is legacy — neither shows steppers or a map.
  const isDungeonRoute = routeUsesLevelKnobs(kind);
  const stats = useMemo(() => routeStats(route), [route]);
  const seed = useMemo(() => seedFromId(route.id), [route.id]);
  // Real route shape (pull centroids) when the backend has it; else the card
  // falls back to a seeded decorative scatter.
  const shape = useMemo<ShapePoint[] | undefined>(() => {
    if (!route.shape) return undefined;
    try {
      const parsed = JSON.parse(route.shape);
      return Array.isArray(parsed) && parsed.length ? (parsed as ShapePoint[]) : undefined;
    } catch {
      return undefined;
    }
  }, [route.shape]);
  const [h, setH] = useState(false);
  const [err, setErr] = useState('');
  const [key, setKey] = useState(() => getRouteSimParams().keystoneLevel);
  const [hp, setHp] = useState(() => getRouteSimParams().hpPercent);

  const onSim = () => {
    const ar = routeToActiveRoute(route);
    if (!ar) {
      setErr(t('route.row.loadFailed'));
      return;
    }
    if (isDungeonRoute) setRouteSimParams({ keystoneLevel: key, hpPercent: hp });
    activateRoute(ar);
    router.push(ROUTES.quickSim);
  };

  const onMap = () => {
    const ar = routeToActiveRoute(route);
    if (!ar) {
      setErr(t('route.row.loadFailed'));
      return;
    }
    // Render the map at the same key/HP the row's steppers show.
    setRouteSimParams({ keystoneLevel: key, hpPercent: hp });
    try {
      sessionStorage.setItem(MDT_ROUTE_SESSION_KEY, JSON.stringify(ar));
    } catch {}
    router.push(ROUTES.dungeonRoute);
  };

  const onDelete = () => {
    setErr('');
    deleteSavedRoute(route.id)
      .then(onChanged)
      .catch((e) => setErr(e instanceof Error ? e.message : t('route.row.deleteFailed')));
  };

  const sourceColor = SOURCE_COLORS[kind] ?? T.muted;

  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '13px 16px',
        borderRadius: 11,
        background: h ? T.surface : T.panel,
        border: `1px solid ${h ? T.borderHi : T.border}`,
        transition: 'all .12s',
      }}
    >
      <RouteMiniMap seed={seed} count={stats.pulls ?? 8} shape={shape} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
          <span
            style={{
              fontSize: 14.5,
              fontWeight: 700,
              color: T.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {route.name}
          </span>
        </div>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 11, color: T.muted, flexWrap: 'wrap' }}
        >
          {stats.pulls != null && (
            <>
              <span>{t('route.row.pulls', { count: stats.pulls })}</span>
              <span style={{ color: T.dim }}>·</span>
            </>
          )}
          {stats.enemies != null && (
            <>
              <span>{t('route.row.enemies', { count: stats.enemies })}</span>
              <span style={{ color: T.dim }}>·</span>
            </>
          )}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: sourceColor }} />
            {t(KIND_LABEL_KEY[kind])}
          </span>
          <span style={{ color: T.dim }}>·</span>
          <span>{t('route.row.updated', { time: timeAgo(route.created_at, t) })}</span>
        </div>
        {err && <div style={{ marginTop: 6, fontSize: 11, color: T.red }}>{err}</div>}
      </div>

      {isDungeonRoute && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Stepper label={t('route.row.keyLevel')} value={key} min={2} max={40} prefix="+" onChange={setKey} />
          <Stepper label={t('route.row.hpPercent')} value={hp} min={1} max={100} onChange={setHp} />
        </div>
      )}

      <span style={{ width: 1, height: 30, background: T.border }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <ActBtn icon={<IPlay s={12} />} label={t('route.row.sim')} primary onClick={onSim} />
        {isDungeonRoute && <ActBtn icon={<IList s={13} />} label={t('route.row.map')} onClick={onMap} />}
        <ActBtn icon={<ITrash s={13} />} danger onClick={onDelete} />
      </div>
    </div>
  );
}
