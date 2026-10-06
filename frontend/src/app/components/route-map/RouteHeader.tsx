'use client';

import type { ReactNode } from 'react';
import { useLanguage } from '../../lib/i18n';
import type { SavedRoute } from '../../lib/saved-routes';
import Button from '../ui/Button';
import Pill from '../ui/Pill';
import { cn } from '../../lib/cn';
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
  return (
    <Button
      variant={active ? 'gold' : 'text'}
      onClick={onClick}
      className={cn(!active && 'border border-transparent', danger && 'hover:text-negative')}
    >
      {icon}
      {label && <span>{label}</span>}
    </Button>
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
  return (
    <div className="flex h-[58px] shrink-0 items-center gap-4 border-b border-line/[0.06] bg-background px-6">
      {onBack && (
        <>
          <ToolBtn icon={<IBack s={13} />} label={t('route.header.backToList')} onClick={onBack} />
          <span className="h-[22px] w-px bg-overlay/[0.06]" />
        </>
      )}
      <div className="flex min-w-0 items-center gap-[9px]">
        <span className="h-card whitespace-nowrap">{dungeonName}</span>
        <Pill variant="gold">+{keystoneLevel}</Pill>
        <span className="h-3.5 w-px bg-overlay/[0.06]" />
        <span className="whitespace-nowrap text-[12px] text-on-surface-variant">
          {t('route.row.pulls', { count: pullCount })}
        </span>
        <span className="text-fg-4">·</span>
        <span className="whitespace-nowrap text-[12px] text-on-surface-variant">
          {t('route.row.enemies', { count: enemyCount })}
        </span>
        {mdtVersion && (
          <>
            <span className="h-3.5 w-px bg-overlay/[0.06]" />
            <span className="whitespace-nowrap text-[11px] tracking-[0.04em] text-outline">
              MDT {mdtVersion}
            </span>
          </>
        )}
      </div>

      {routes && routes.length > 0 && onSwitch && (
        <select
          // Fall back to the placeholder when the active route isn't an option
          // (deleted/cross-dungeon link) so the controlled value always matches one.
          value={routes.some((r) => r.id === currentRouteId) ? currentRouteId! : ''}
          onChange={(e) => {
            const r = routes.find((x) => x.id === e.target.value);
            if (r) onSwitch(r);
          }}
          aria-label={t('route.header.switchRoute')}
          className="sel h-[34px] w-auto max-w-[200px] cursor-pointer text-[12px]"
        >
          {!routes.some((r) => r.id === currentRouteId) && (
            <option value="">{t('route.header.switchRoute')}</option>
          )}
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      )}

      <div className="flex-1" />

      <div className="flex gap-1">
        <ToolBtn
          icon={<IPencil s={13} />}
          label={t('route.header.draw')}
          active={mode === 'draw'}
          onClick={() => onToggleMode('draw')}
        />
        <ToolBtn
          icon={<IMerge s={13} />}
          label={t('route.header.merge')}
          active={mode === 'merge'}
          onClick={() => onToggleMode('merge')}
        />
        <ToolBtn
          icon={<ITrash s={13} />}
          label={t('route.header.delete')}
          danger
          active={mode === 'delete'}
          onClick={() => onToggleMode('delete')}
        />
      </div>
      <span className="h-[22px] w-px bg-overlay/[0.06]" />
      <Button onClick={onImport}>
        <IImport s={13} /> {t('route.header.import')}
      </Button>
      <Button variant="solid" onClick={onSave}>
        <ISave s={13} /> {t('route.header.save')}
      </Button>
    </div>
  );
}
