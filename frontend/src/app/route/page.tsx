'use client';

import { useEffect, useState } from 'react';
import { decodeMdt, type MdtConversion } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { MDT_ROUTE_SESSION_KEY } from '../lib/routes';
import RouteViewer from '../components/route-map/RouteViewer';
import { T } from '../components/route-map/routeTheme';
import { IImport } from '../components/route-map/routeIcons';

export default function RoutePage() {
  const { t } = useLanguage();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conv, setConv] = useState<MdtConversion | null>(null);
  const [loadId, setLoadId] = useState(0);

  const load = async (str: string) => {
    const trimmed = str.trim();
    if (!trimmed) return;
    setBusy(true);
    setError('');
    try {
      setConv(await decodeMdt(trimmed));
      setLoadId((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConv(null);
    } finally {
      setBusy(false);
    }
  };

  // Deep-link: an MDT string stashed by the sim-config import opens here.
  useEffect(() => {
    try {
      const stashed = sessionStorage.getItem(MDT_ROUTE_SESSION_KEY);
      if (stashed) {
        sessionStorage.removeItem(MDT_ROUTE_SESSION_KEY);
        setInput(stashed);
        load(stashed);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (conv) {
    return (
      <div style={{ height: 'calc(100vh - 1rem)', padding: 8 }}>
        <RouteViewer
          key={loadId}
          conv={conv}
          mdtString={input}
          onImport={() => {
            setConv(null);
            setError('');
          }}
        />
      </div>
    );
  }

  // ── Empty state: import an MDT route ─────────────────────────────
  return (
    <div
      style={{
        height: 'calc(100vh - 1rem)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: T.bg,
      }}
    >
      <div style={{ width: 540, maxWidth: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
          <span style={{ color: T.gold, display: 'flex' }}>
            <IImport s={16} />
          </span>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{t('route.title')}</h1>
        </div>
        <p style={{ fontSize: 12.5, color: T.muted, marginBottom: 18 }}>{t('route.subtitle')}</p>

        <div
          style={{
            background: T.panel,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: 18,
          }}
        >
          <label
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: T.muted,
            }}
          >
            MDT import string
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('route.placeholder')}
            rows={3}
            style={{
              width: '100%',
              marginTop: 8,
              padding: '10px 12px',
              borderRadius: 7,
              background: T.surface,
              border: `1px solid ${T.borderHi}`,
              color: T.text,
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              resize: 'vertical',
              outline: 'none',
            }}
          />
          {error && <div style={{ marginTop: 10, fontSize: 12, color: T.red }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button
              type="button"
              onClick={() => load(input)}
              disabled={busy || !input.trim()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '8px 16px',
                borderRadius: 7,
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.03em',
                background: T.gold,
                color: '#141414',
                border: 'none',
                cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
                opacity: busy || !input.trim() ? 0.5 : 1,
              }}
            >
              <IImport s={13} /> {busy ? t('route.loading') : t('route.load')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
