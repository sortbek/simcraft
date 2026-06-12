'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSimContext } from '../sim-config/SimContext';
import { deleteSavedRoute, type SavedRoute } from '../../lib/saved-routes';
import { classifyRoute, routeToActiveRoute, routeStats, seedFromId } from '../../lib/routes-model';
import { getRouteSimParams, setRouteSimParams } from '../../lib/route-sim-params';
import { ROUTES, MDT_ROUTE_SESSION_KEY, MDT_ROUTE_PULLS_SESSION_KEY } from '../../lib/routes';
import { useLanguage } from '../../lib/i18n';
import { T } from '../route-map/routeTheme';
import { IPlay, IList, ITrash, IPlus, IMinus } from '../route-map/routeIcons';
import RouteMiniMap from './RouteMiniMap';

type TFn = (key: string, params?: Record<string, string | number>) => string;

function relTime(iso: string, t: TFn): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const m = Math.floor((Date.now() - then) / 60000);
  if (m < 1) return t('route.time.justNow');
  if (m < 60) return t('route.time.minutes', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('route.time.hours', { count: h });
  return t('route.time.days', { count: Math.floor(h / 24) });
}

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
  const { setActiveRoute, setSimcFooter, setFightStyle } = useSimContext();
  const kind = classifyRoute(route);
  const levelAgnostic = kind === 'mdt' || kind === 'pulls';
  const mappable = kind === 'mdt' || kind === 'pulls';
  const stats = routeStats(route);
  const [h, setH] = useState(false);
  const [key, setKey] = useState(() => getRouteSimParams().keystoneLevel);
  const [hp, setHp] = useState(() => getRouteSimParams().hpPercent);

  const onSim = () => {
    if (levelAgnostic) setRouteSimParams({ keystoneLevel: key, hpPercent: hp });
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

  const sourceColor = stats.source === 'keystone.guru' ? '#c95fd6' : '#6ea7cc';

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
      <RouteMiniMap seed={seedFromId(route.id)} count={stats.pulls ?? 8} />

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
            {stats.source}
          </span>
          <span style={{ color: T.dim }}>·</span>
          <span>{t('route.row.updated', { time: relTime(route.created_at, t) })}</span>
        </div>
      </div>

      {levelAgnostic && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Stepper label={t('route.row.keyLevel')} value={key} min={2} max={40} prefix="+" onChange={setKey} />
          <Stepper label={t('route.row.hpPercent')} value={hp} min={1} max={100} onChange={setHp} />
        </div>
      )}

      <span style={{ width: 1, height: 30, background: T.border }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <ActBtn icon={<IPlay s={12} />} label={t('route.row.sim')} primary onClick={onSim} />
        {mappable && <ActBtn icon={<IList s={13} />} label={t('route.row.map')} onClick={onMap} />}
        <ActBtn icon={<ITrash s={13} />} danger onClick={() => deleteSavedRoute(route.id).then(onChanged)} />
      </div>
    </div>
  );
}
