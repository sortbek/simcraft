'use client';

import { useState } from 'react';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import { decodeMdt, type MdtConversion } from '../../lib/api';

/** Remove a previously-imported route from the custom options so re-importing
 *  replaces it cleanly without clobbering the user's other custom lines. */
function stripPriorRoute(s: string): string {
  return s
    .split('\n')
    .filter(
      (l) => !l.startsWith('raid_events+=/pull') && l.trim() !== 'fight_style=DungeonRoute'
    )
    .join('\n')
    .trim();
}

export default function MdtImport() {
  const { t } = useLanguage();
  const { setFightStyle, customApl, setCustomApl } = useSimContext();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<MdtConversion | null>(null);

  const onImport = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const conv = await decodeMdt(trimmed);
      setFightStyle('DungeonRoute');
      const base = stripPriorRoute(customApl);
      setCustomApl(base ? `${base}\n${conv.raid_events}` : conv.raid_events);
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
        </div>
      )}
    </div>
  );
}
