'use client';

import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import { getRouteSimParams } from '../../lib/route-sim-params';

/** Compact "a route is loaded" line for the sim config. The route is set from
 *  the /routes manager; here we only show it and allow unloading. */
export default function ActiveRouteIndicator() {
  const { t } = useLanguage();
  const { activeRoute, setActiveRoute, setFightStyle } = useSimContext();
  if (!activeRoute) return null;
  const { keystoneLevel, hpPercent } = getRouteSimParams();
  const name = activeRoute.name ?? '—';
  const label =
    activeRoute.kind === 'simc'
      ? t('route.activeIndicatorBaked', { name })
      : t('route.activeIndicator', { name, level: keystoneLevel, hp: hpPercent });

  return (
    <div className="flex items-center justify-between border-t border-outline-variant/10 pt-2 text-[13px]">
      <span className="min-w-0 flex-1 truncate text-gold">{label}</span>
      <button
        type="button"
        onClick={() => {
          setActiveRoute(null);
          setFightStyle('Patchwerk');
        }}
        className="ml-2 shrink-0 text-on-surface-variant/60 transition-colors hover:text-on-surface"
      >
        {t('common.clear')}
      </button>
    </div>
  );
}
