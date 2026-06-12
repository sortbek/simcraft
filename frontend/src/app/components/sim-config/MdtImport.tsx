'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import { decodeMdt, type MdtConversion } from '../../lib/api';
import { getRouteSimParams, setRouteSimParams } from '../../lib/route-sim-params';
import { MDT_ROUTE_SESSION_KEY, ROUTES } from '../../lib/routes';

export default function MdtImport() {
  const { t } = useLanguage();
  const router = useRouter();
  const { setFightStyle, setActiveRoute } = useSimContext();
  const [value, setValue] = useState('');
  // Keystone level + HP-damage share are route-generation params (persisted via
  // route-sim-params): they're applied when the route is materialized at sim
  // time, so they're plain editable numbers here, not re-decode triggers. The
  // draft strings let the user type a multi-digit value before it's clamped.
  const [keyLevel, setKeyLevel] = useState(() => getRouteSimParams().keystoneLevel);
  const [hpPercent, setHpPercent] = useState(() => getRouteSimParams().hpPercent);
  const [levelDraft, setLevelDraft] = useState(() => String(getRouteSimParams().keystoneLevel));
  const [hpDraft, setHpDraft] = useState(() => String(getRouteSimParams().hpPercent));
  // The imported MDT string, kept for the "view on map" deep-link.
  const [importedMdt, setImportedMdt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<MdtConversion | null>(null);

  const commitLevel = () => {
    const level = Math.max(2, Math.min(40, Math.round(Number(levelDraft)) || 2));
    setKeyLevel(level);
    setLevelDraft(String(level));
    setRouteSimParams({ keystoneLevel: level });
  };
  const commitHp = () => {
    const hp = Math.max(1, Math.min(100, Math.round(Number(hpDraft)) || 1));
    setHpPercent(hp);
    setHpDraft(String(hp));
    setRouteSimParams({ hpPercent: hp });
  };

  /** Decode the MDT string for a preview and set it as the active route. The
   *  route stays level-agnostic — the keystone level + HP share apply when it's
   *  materialized at sim time, so one import sims at any level. */
  const onImport = async () => {
    const mdt = value.trim();
    if (!mdt) return;
    setBusy(true);
    setError('');
    try {
      const conv = await decodeMdt(mdt, { keystoneLevel: keyLevel, hpPercent });
      setFightStyle('DungeonRoute');
      setActiveRoute({ kind: 'mdt', name: conv.dungeon_name, mdtString: mdt });
      setImportedMdt(mdt);
      setResult(conv);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
            value={levelDraft}
            onChange={(e) => setLevelDraft(e.target.value)}
            onBlur={commitLevel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLevel();
            }}
            className="input-field w-16 text-center"
          />
        </label>
        <label className="flex items-center gap-1.5 text-[13px] text-on-surface-variant">
          {t('config.mdtHpPercent')}
          <input
            type="number"
            min={1}
            max={100}
            value={hpDraft}
            onChange={(e) => setHpDraft(e.target.value)}
            onBlur={commitHp}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitHp();
            }}
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
              level: keyLevel,
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
          <div className="mt-1.5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                try {
                  sessionStorage.setItem(MDT_ROUTE_SESSION_KEY, importedMdt);
                } catch {}
                router.push(ROUTES.dungeonRoute);
              }}
              className="text-[13px] font-medium text-gold transition-colors hover:text-gold/80"
            >
              {t('config.mdtViewOnMap')} →
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveRoute(null);
                setFightStyle('Patchwerk');
                setResult(null);
                setImportedMdt('');
              }}
              className="text-[13px] text-on-surface-variant/50 transition-colors hover:text-on-surface"
            >
              {t('common.clear')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
