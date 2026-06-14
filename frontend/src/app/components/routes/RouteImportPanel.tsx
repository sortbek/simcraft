'use client';

import { useState } from 'react';
import { decodeMdt, type DungeonSummary } from '../../lib/api';
import { saveRoute } from '../../lib/saved-routes';
import { detectDungeonFromSimc } from '../../lib/routes-model';
import { useLanguage } from '../../lib/i18n';
import { T, SOURCE_COLORS } from '../route-map/routeTheme';
import { IImport } from '../route-map/routeIcons';

const SourceTag = ({ label, color }: { label: string; color: string }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      fontSize: 9.5,
      fontWeight: 600,
      color: T.muted,
      padding: '3px 9px',
      borderRadius: 5,
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${T.border}`,
    }}
  >
    <span style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
    {label}
  </span>
);

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
  const [txt, setTxt] = useState('');
  const [name, setName] = useState('');
  const [focus, setFocus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [btnHover, setBtnHover] = useState(false);

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
    <div
      style={{
        background: T.panel,
        border: `1px solid ${T.border}`,
        borderRadius: 13,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 18px',
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <span style={{ color: T.gold, display: 'flex' }}>
          <IImport s={15} />
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: T.text,
          }}
        >
          {t('route.import.label')}
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 7 }}>
          <SourceTag label="MDT" color={SOURCE_COLORS.mdt} />
          <SourceTag label="keystone.guru" color={SOURCE_COLORS.simc} />
        </div>
      </div>
      <div style={{ padding: 18 }}>
        <textarea
          value={txt}
          onChange={(e) => setTxt(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          placeholder={t('route.import.placeholder')}
          style={{
            width: '100%',
            height: 96,
            resize: 'none',
            padding: '12px 14px',
            borderRadius: 9,
            background: T.bg,
            border: `1px solid ${focus ? T.goldBord : T.borderHi}`,
            color: T.text2,
            fontSize: 11.5,
            lineHeight: 1.6,
            fontFamily: 'monospace',
            outline: 'none',
            transition: 'border-color .12s',
            boxShadow: focus ? `0 0 0 3px ${T.goldSub}` : 'none',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('route.import.namePlaceholder')}
            style={{
              flex: 1,
              padding: '10px 13px',
              borderRadius: 8,
              background: T.surface,
              border: `1px solid ${T.borderHi}`,
              color: T.text,
              fontSize: 12,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <div
            style={{
              minWidth: 158,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 10.5,
              color: detected ? (isMdt || isKsg ? '#7fd693' : T.red) : T.muted,
            }}
          >
            {detected && (isMdt || isKsg) && (
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#5fbf6a' }} />
            )}
            {detected ? t('route.import.detected', { fmt }) : t('route.import.autoDetect')}
          </div>
          <button
            type="button"
            disabled={!enabled}
            onClick={onImport}
            onMouseEnter={() => setBtnHover(true)}
            onMouseLeave={() => setBtnHover(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 22px',
              borderRadius: 8,
              fontFamily: 'inherit',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.04em',
              cursor: enabled ? 'pointer' : 'not-allowed',
              background: enabled ? (btnHover ? T.gold : T.goldSub) : 'rgba(255,255,255,0.03)',
              border: `1px solid ${enabled ? (btnHover ? T.gold : T.goldBord) : T.border}`,
              color: enabled ? (btnHover ? '#141414' : T.gold) : T.dim,
              transition: 'all .12s',
            }}
          >
            <IImport s={13} /> {busy ? t('route.import.importing') : t('route.import.button')}
          </button>
        </div>
        {error && <p style={{ marginTop: 12, fontSize: 11.5, color: T.red }}>{error}</p>}
      </div>
    </div>
  );
}
