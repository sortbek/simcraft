'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import Button from '../ui/Button';
import { cn } from '../../lib/cn';

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
  const Btn = ({ dir }: { dir: number }) => (
    <button
      type="button"
      onClick={() => onChange(Math.max(min, Math.min(max, value + dir)))}
      className="flex h-[26px] w-[22px] items-center justify-center text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-gold"
    >
      {dir > 0 ? <IPlus s={11} /> : <IMinus s={11} />}
    </button>
  );
  return (
    <div className="flex items-center gap-2">
      <span className="lbl">{label}</span>
      <div className="flex items-center overflow-hidden rounded-[6px] border border-line/[0.11] bg-surface-container-high">
        <Btn dir={-1} />
        <span className="min-w-[34px] px-0.5 text-center font-headline text-xs font-extrabold tabular-nums text-on-surface">
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
}) => (
  <Button
    variant={primary ? 'gold' : 'quiet'}
    onClick={onClick}
    className={cn(!label && 'px-2', danger && 'hover:border-negative/25 hover:text-negative')}
  >
    {icon}
    {label && <span>{label}</span>}
  </Button>
);

/** One saved route, rendered as a library card. [Sim] sets the chosen key/HP +
 *  activates the route, then navigates to Quick Sim (activate-only flow). */
export default function RouteRow({
  route,
  onChanged,
}: {
  route: SavedRoute;
  onChanged: () => void;
}) {
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
  const [err, setErr] = useState('');
  const [key, setKey] = useState(() => getRouteSimParams().keystoneLevel);
  const [hp, setHp] = useState(() => getRouteSimParams().hpPercent);
  // Re-render once a minute so the "updated Xm ago" label stays current.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

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
    <div className="card flex items-center gap-[18px] px-4 py-[13px] hover:border-line/[0.11] hover:bg-surface-container-high">
      <RouteMiniMap seed={seed} count={stats.pulls ?? 8} shape={shape} />

      <div className="min-w-0 flex-1">
        <div className="mb-[7px] flex items-center gap-2.5">
          <span className="truncate text-[14.5px] font-bold text-on-surface">{route.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-[9px] text-xs text-outline">
          {stats.pulls != null && (
            <>
              <span>{t('route.row.pulls', { count: stats.pulls })}</span>
              <span className="text-fg-4">·</span>
            </>
          )}
          {stats.enemies != null && (
            <>
              <span>{t('route.row.enemies', { count: stats.enemies })}</span>
              <span className="text-fg-4">·</span>
            </>
          )}
          <span className="inline-flex items-center gap-[5px]">
            <span className="h-[5px] w-[5px] rounded-full" style={{ background: sourceColor }} />
            {t(KIND_LABEL_KEY[kind])}
          </span>
          <span className="text-fg-4">·</span>
          <span>{t('route.row.updated', { time: timeAgo(route.created_at, t) })}</span>
        </div>
        {err && <div className="mt-1.5 text-xs text-negative">{err}</div>}
      </div>

      {isDungeonRoute && (
        <div className="flex items-center gap-4">
          <Stepper
            label={t('route.row.keyLevel')}
            value={key}
            min={2}
            max={40}
            prefix="+"
            onChange={setKey}
          />
          <Stepper label={t('route.row.hpPercent')} value={hp} min={1} max={100} onChange={setHp} />
        </div>
      )}

      <span className="h-[30px] w-px bg-overlay/[0.06]" />

      <div className="flex items-center gap-[7px]">
        <ActBtn icon={<IPlay s={12} />} label={t('route.row.sim')} primary onClick={onSim} />
        {isDungeonRoute && (
          <ActBtn icon={<IList s={13} />} label={t('route.row.map')} onClick={onMap} />
        )}
        <ActBtn icon={<ITrash s={13} />} danger onClick={onDelete} />
      </div>
    </div>
  );
}
