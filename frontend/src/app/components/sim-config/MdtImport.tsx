'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import { decodeMdt, type MdtConversion } from '../../lib/api';
import { getRouteSimParams, setRouteSimParams } from '../../lib/route-sim-params';
import { MDT_ROUTE_SESSION_KEY, ROUTES } from '../../lib/routes';

/** Remove a previously-injected route block from the custom options. Prefers
 *  removing the exact block we last injected; falls back to filtering the route's
 *  known lines (a self-contained keystone.guru block) so a stale/cross-session
 *  reference can't leave a duplicated header behind. User lines are preserved. */
const ROUTE_LINE_PREFIXES = [
  'fight_style=DungeonRoute',
  'single_actor_batch=',
  'max_time=',
  'enemy=',
  'enemy_health=',
  'keystone_level=',
  'raid_events=',
  'raid_events+=',
  'override.',
];
function stripPriorRoute(s: string, injected: string): string {
  if (injected && s.includes(injected)) {
    return s.replace(injected, '').replace(/\n{2,}/g, '\n').trim();
  }
  return s
    .split('\n')
    .filter((l) => !ROUTE_LINE_PREFIXES.some((p) => l.trim().startsWith(p)))
    .join('\n')
    .trim();
}

export default function MdtImport() {
  const { t } = useLanguage();
  const router = useRouter();
  const { setFightStyle, customApl, setCustomApl } = useSimContext();
  const [value, setValue] = useState('');
  // Keystone level + HP-damage share are route-generation params (persisted via
  // route-sim-params, shared with saved-route loading), not general sim config.
  const [keyLevel, setKeyLevel] = useState(() => getRouteSimParams().keystoneLevel);
  const [hpPercent, setHpPercent] = useState(() => getRouteSimParams().hpPercent);
  // The imported route's MDT string is level-agnostic — kept so changing the
  // level/hp% re-generates the route (sim-time choices), and the exact block we
  // last injected so re-injection replaces it cleanly.
  const [importedMdt, setImportedMdt] = useState('');
  const [injected, setInjected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<MdtConversion | null>(null);

  /** Generate the route's SimC at the given level + HP share and (re)inject it,
   *  replacing any prior route. These are sim-time choices, so one imported
   *  route can be re-simmed at any keystone level without re-importing. */
  const applyRoute = async (mdt: string, level: number, hp: number) => {
    setBusy(true);
    setError('');
    try {
      const conv = await decodeMdt(mdt, { keystoneLevel: level, hpPercent: hp });
      setFightStyle('DungeonRoute');
      // Inject `simc` (fight_style=DungeonRoute + header + raid_events): the
      // backend detects dungeon-route sims by scanning for the literal
      // fight_style line (simc_runner), which drives the route-specific config.
      const base = stripPriorRoute(customApl, injected);
      setCustomApl(base ? `${base}\n${conv.simc}` : conv.simc);
      setInjected(conv.simc);
      setImportedMdt(mdt);
      setResult(conv);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onImport = () => {
    const trimmed = value.trim();
    if (trimmed) applyRoute(trimmed, keyLevel, hpPercent);
  };

  const onLevelChange = (raw: number) => {
    const level = Math.max(2, Math.min(40, Math.round(raw) || 2));
    setKeyLevel(level);
    setRouteSimParams({ keystoneLevel: level });
    if (importedMdt) applyRoute(importedMdt, level, hpPercent);
  };

  const onHpChange = (raw: number) => {
    const hp = Math.max(1, Math.min(100, Math.round(raw) || 1));
    setHpPercent(hp);
    setRouteSimParams({ hpPercent: hp });
    if (importedMdt) applyRoute(importedMdt, keyLevel, hp);
  };

  return (
    <div className="space-y-2 border-t border-outline-variant/10 pt-2">
      <label className="label-text">{t('config.mdtImport')}</label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('config.mdtImportPlaceholder')}
        className="input-field h-20 resize-y font-mono text-xs"
      />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-[13px] text-on-surface-variant">
          {t('config.mdtKeyLevel')}
          <input
            type="number"
            min={2}
            max={40}
            value={keyLevel}
            onChange={(e) => onLevelChange(Number(e.target.value))}
            disabled={busy}
            className="input-field w-16 text-center"
          />
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-on-surface-variant">
          {t('config.mdtHpPercent')}
          <input
            type="number"
            min={1}
            max={100}
            value={hpPercent}
            onChange={(e) => onHpChange(Number(e.target.value))}
            disabled={busy}
            title={t('config.mdtHpPercentHelp')}
            className="input-field w-16 text-center"
          />
        </label>
        <button
          type="button"
          onClick={onImport}
          disabled={busy || !value.trim()}
          className="text-[14px] font-medium text-gold transition-colors hover:text-gold/80 disabled:cursor-not-allowed disabled:text-on-surface-variant/40"
        >
          {busy ? t('config.mdtImporting') : t('config.mdtImportButton')}
        </button>
        <p className="text-[13px] text-on-surface-variant/40">{t('config.mdtImportHelp')}</p>
      </div>

      {error && <p className="text-[13px] text-red-400">{error}</p>}

      {result && (
        <div className="rounded-lg bg-gold/[0.06] px-3 py-2 text-[13px] text-on-surface-variant">
          <p className="font-medium text-on-surface">
            {t('config.mdtRouteApplied', {
              dungeon: result.dungeon_name,
              level: result.keystone_level,
              pulls: result.pull_count,
              enemies: result.enemy_count,
            })}
          </p>
          <p className="text-on-surface-variant/70">{t('config.mdtAppliedNote')}</p>
          {result.unresolved > 0 && (
            <p className="mt-1 text-amber-400">
              {t('config.mdtUnresolvedWarning', { count: result.unresolved })}
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              try {
                sessionStorage.setItem(MDT_ROUTE_SESSION_KEY, importedMdt);
              } catch {}
              router.push(ROUTES.dungeonRoute);
            }}
            className="mt-1.5 text-[13px] font-medium text-gold transition-colors hover:text-gold/80"
          >
            {t('config.mdtViewOnMap')} →
          </button>
        </div>
      )}
    </div>
  );
}
