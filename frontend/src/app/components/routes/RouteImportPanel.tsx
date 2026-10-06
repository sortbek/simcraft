'use client';

import { useState } from 'react';
import { decodeMdt, type DungeonSummary } from '../../lib/api';
import { saveRoute } from '../../lib/saved-routes';
import { detectDungeonFromSimc } from '../../lib/routes-model';
import { useLanguage } from '../../lib/i18n';
import { SOURCE_COLORS } from '../route-map/routeTheme';
import { IImport } from '../route-map/routeIcons';
import Button from '../ui/Button';
import CardHeader from '../ui/CardHeader';
import Pill from '../ui/Pill';

const SourceTag = ({ label, color }: { label: string; color: string }) => (
  <Pill>
    <span className="h-[5px] w-[5px] rounded-full" style={{ background: color }} />
    {label}
  </Pill>
);

/** One smart field: an MDT string (`!`) is decoded and saved level-agnostically as
 *  mdt_string; a keystone.guru SimC block (`fight_style=DungeonRoute`) is saved
 *  verbatim with a best-effort dungeon. */
export default function RouteImportPanel({
  dungeons,
  onSaved,
}: {
  dungeons: DungeonSummary[];
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const [txt, setTxt] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const trimmed = txt.trim();
  const isMdt = trimmed.startsWith('!');
  const isKsg = !isMdt && trimmed.includes('fight_style=DungeonRoute');
  const detected = trimmed.length > 0;
  const fmt = isMdt
    ? t('route.import.fmtMdt')
    : isKsg
      ? t('route.import.fmtKsg')
      : t('route.import.fmtUnknown');
  const enabled = detected && !busy;

  const onImport = async () => {
    const s = trimmed;
    if (!s) return;
    setBusy(true);
    setError('');
    try {
      if (isMdt) {
        const conv = await decodeMdt(s);
        await saveRoute(name.trim() || conv.dungeon_name, {
          mdtString: s,
          dungeonIdx: conv.map.dungeon_idx,
        });
      } else if (isKsg) {
        const dungeonIdx = detectDungeonFromSimc(s, dungeons);
        const title = s.match(/^enemy="([^"]*)"/m)?.[1];
        await saveRoute(name.trim() || title || t('route.defaultName'), {
          simc: s,
          ...(dungeonIdx != null ? { dungeonIdx } : {}),
        });
      } else {
        setError(t('route.import.unknownFormat'));
        return;
      }
      setTxt('');
      setName('');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card overflow-hidden">
      <CardHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex text-gold">
              <IImport s={15} />
            </span>
            {t('route.import.label')}
          </span>
        }
        right={
          <div className="flex gap-[7px]">
            <SourceTag label="MDT" color={SOURCE_COLORS.mdt} />
            <SourceTag label="keystone.guru" color={SOURCE_COLORS.simc} />
          </div>
        }
      />
      <div className="px-6 py-[22px]">
        <textarea
          value={txt}
          onChange={(e) => setTxt(e.target.value)}
          placeholder={t('route.import.placeholder')}
          className="input-field h-24 resize-none bg-background font-mono text-[12px] leading-relaxed text-on-surface-variant focus:border-gold/35"
        />

        <div className="mt-3.5 flex items-center gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('route.import.namePlaceholder')}
            className="input-field flex-1"
          />
          <div
            className={`flex min-w-[158px] items-center gap-2 text-[12px] ${
              detected ? (isMdt || isKsg ? 'text-positive' : 'text-negative') : 'text-outline'
            }`}
          >
            {detected && (isMdt || isKsg) && (
              <span className="h-1.5 w-1.5 rounded-full bg-positive" />
            )}
            {detected ? t('route.import.detected', { fmt }) : t('route.import.autoDetect')}
          </div>
          <Button disabled={!enabled} onClick={onImport}>
            <IImport s={13} /> {busy ? t('route.import.importing') : t('route.import.button')}
          </Button>
        </div>
        {error && <p className="mt-3 text-[12px] text-negative">{error}</p>}
      </div>
    </div>
  );
}
