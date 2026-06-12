'use client';

import { useState } from 'react';
import { decodeMdt, type DungeonSummary } from '../../lib/api';
import { saveRoute } from '../../lib/saved-routes';
import { detectDungeonFromSimc } from '../../lib/routes-model';
import { useLanguage } from '../../lib/i18n';

/** One smart field: an MDT export string (starts with `!`) is decoded and saved
 *  level-agnostically as its mdt_string; a keystone.guru SimC block
 *  (`fight_style=DungeonRoute`) is saved verbatim with a best-effort dungeon. */
export default function RouteImportPanel({
  dungeons,
  onSaved,
}: {
  dungeons: DungeonSummary[];
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onImport = async () => {
    const s = value.trim();
    if (!s) return;
    setBusy(true);
    setError('');
    try {
      if (s.startsWith('!')) {
        const conv = await decodeMdt(s);
        await saveRoute(name.trim() || conv.dungeon_name, {
          mdtString: s,
          dungeonIdx: conv.map.dungeon_idx,
        });
      } else if (s.includes('fight_style=DungeonRoute')) {
        const dungeonIdx = detectDungeonFromSimc(s, dungeons);
        const title = s.match(/^enemy="([^"]*)"/m)?.[1];
        await saveRoute(name.trim() || title || 'Route', {
          simc: s,
          ...(dungeonIdx != null ? { dungeonIdx } : {}),
        });
      } else {
        setError(t('route.import.unknownFormat'));
        return;
      }
      setValue('');
      setName('');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-outline-variant/20 bg-surface-container p-4">
      <label className="label-text">{t('route.import.label')}</label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('route.import.placeholder')}
        className="input-field h-20 resize-y font-mono text-xs"
      />
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('route.import.namePlaceholder')}
          className="input-field flex-1 text-[13px]"
        />
        <button
          type="button"
          onClick={onImport}
          disabled={busy || !value.trim()}
          className="rounded bg-gold/10 px-3 py-1.5 text-[13px] font-medium text-gold transition-colors hover:bg-gold/20 disabled:opacity-40"
        >
          {busy ? t('route.import.importing') : t('route.import.button')}
        </button>
      </div>
      {error && <p className="text-[13px] text-red-400">{error}</p>}
    </div>
  );
}
