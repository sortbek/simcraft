'use client';

import { useState, type ReactNode } from 'react';
import { useLanguage } from '../../lib/i18n';
import type { SavedRoute } from '../../lib/saved-routes';
import { T } from './routeTheme';
import { IPencil, IMerge, ITrash, ISave, IImport, IBack } from './routeIcons';
import type { EditMode } from './useRouteEditor';

interface ToolBtnProps {
  icon: ReactNode;
  label?: string;
  active?: boolean;
  danger?: boolean;
  onClick?: () => void;
}
function ToolBtn({ icon, label, active, danger, onClick }: ToolBtnProps) {
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
        gap: 6,
        padding: '6px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        background: active ? T.goldSub : h ? T.surfaceHi : 'transparent',
        border: `1px solid ${active ? T.goldBord : h ? T.borderHi : 'transparent'}`,
        color: danger ? (h ? T.red : T.text2) : active ? T.gold : h ? T.text : T.text2,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: '0.04em',
        fontFamily: 'inherit',
        transition: 'all .12s',
      }}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}

interface RouteHeaderProps {
  dungeonName: string;
  keystoneLevel: number;
  pullCount: number;
  enemyCount: number;
  mdtVersion: string;
  mode: EditMode;
  onToggleMode: (m: EditMode) => void;
  onImport: () => void;
  onSave: () => void;
  /** Return to the routes library. */
  onBack?: () => void;
  /** Saved routes in this dungeon, for the in-place switcher. */
  routes?: SavedRoute[];
  /** Id of the currently-loaded saved route (null for a fresh import/overview). */
  currentRouteId?: string | null;
  onSwitch?: (route: SavedRoute) => void;
}

export default function RouteHeader({
  dungeonName,
  keystoneLevel,
  pullCount,
  enemyCount,
  mdtVersion,
  mode,
  onToggleMode,
  onImport,
  onSave,
  onBack,
  routes,
  currentRouteId,
  onSwitch,
}: RouteHeaderProps) {
  const { t } = useLanguage();
  const [impHov, setImpHov] = useState(false);
  return (
    <div
      style={{
        height: 52,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '0 18px',
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
        background: T.bg,
      }}
    >
      {onBack && (
        <>
          <ToolBtn icon={<IBack s={13} />} label={t('route.header.backToList')} onClick={onBack} />
          <span style={{ width: 1, height: 22, background: T.border }} />
        </>
      )}
      {/* KeyChip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.text, whiteSpace: 'nowrap' }}>
          {dungeonName}
        </span>
        <span
          style={{
            background: T.goldSub,
            border: `1px solid ${T.goldBord}`,
            color: T.gold,
            fontSize: 11,
            fontWeight: 800,
            padding: '1px 8px',
            borderRadius: 5,
          }}
        >
          +{keystoneLevel}
        </span>
        <span style={{ width: 1, height: 14, background: T.border }} />
        <span style={{ fontSize: 11.5, color: T.text2, whiteSpace: 'nowrap' }}>
          {t('route.row.pulls', { count: pullCount })}
        </span>
        <span style={{ color: T.dim }}>·</span>
        <span style={{ fontSize: 11.5, color: T.text2, whiteSpace: 'nowrap' }}>
          {t('route.row.enemies', { count: enemyCount })}
        </span>
        {mdtVersion && (
          <>
            <span style={{ width: 1, height: 14, background: T.border }} />
            <span style={{ fontSize: 10.5, color: T.muted, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
              MDT {mdtVersion}
            </span>
          </>
        )}
      </div>

      {routes && routes.length > 0 && onSwitch && (
        <select
          value={currentRouteId ?? ''}
          onChange={(e) => {
            const r = routes.find((x) => x.id === e.target.value);
            if (r) onSwitch(r);
          }}
          aria-label={t('route.header.switchRoute')}
          style={{
            maxWidth: 200,
            padding: '5px 8px',
            borderRadius: 6,
            background: T.surface,
            border: `1px solid ${T.borderHi}`,
            color: T.text2,
            fontSize: 11.5,
            fontFamily: 'inherit',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          {!currentRouteId && <option value="">{t('route.header.switchRoute')}</option>}
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      )}

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', gap: 4 }}>
        <ToolBtn icon={<IPencil s={13} />} label={t('route.header.draw')} active={mode === 'draw'} onClick={() => onToggleMode('draw')} />
        <ToolBtn icon={<IMerge s={13} />} label={t('route.header.merge')} active={mode === 'merge'} onClick={() => onToggleMode('merge')} />
        <ToolBtn icon={<ITrash s={13} />} label={t('route.header.delete')} danger active={mode === 'delete'} onClick={() => onToggleMode('delete')} />
      </div>
      <span style={{ width: 1, height: 22, background: T.border }} />
      <button
        type="button"
        onClick={onImport}
        onMouseEnter={() => setImpHov(true)}
        onMouseLeave={() => setImpHov(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '6px 13px',
          borderRadius: 7,
          cursor: 'pointer',
          fontFamily: 'inherit',
          background: impHov ? T.goldSub : 'transparent',
          border: `1px solid ${T.goldBord}`,
          color: T.gold,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.04em',
          transition: 'all .12s',
        }}
      >
        <IImport s={13} /> {t('route.header.import')}
      </button>
      <ToolBtn icon={<ISave s={13} />} label={t('route.header.save')} active onClick={onSave} />
    </div>
  );
}
