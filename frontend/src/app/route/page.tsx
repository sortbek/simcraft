'use client';

import { useEffect, useState } from 'react';
import { decodeMdt, type MdtConversion } from '../lib/api';
import RouteMap from '../components/route-map/RouteMap';
import PullList from '../components/route-map/PullList';
import ErrorAlert from '../components/ui/ErrorAlert';
import { useLanguage } from '../lib/i18n';
import { MDT_ROUTE_SESSION_KEY } from '../lib/routes';

export default function RoutePage() {
  const { t } = useLanguage();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conv, setConv] = useState<MdtConversion | null>(null);
  const [selectedPull, setSelectedPull] = useState<number | null>(null);

  const load = async (str: string) => {
    const trimmed = str.trim();
    if (!trimmed) return;
    setBusy(true);
    setError('');
    setSelectedPull(null);
    try {
      setConv(await decodeMdt(trimmed));
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

  return (
    <div className="mx-auto flex h-[calc(100vh-1rem)] max-w-[1500px] flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-semibold text-on-surface">{t('route.title')}</h1>
        <p className="text-[13px] text-on-surface-variant/60">{t('route.subtitle')}</p>
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') load(input);
          }}
          placeholder={t('route.placeholder')}
          className="input-field flex-1 font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => load(input)}
          disabled={busy || !input.trim()}
          className="btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? t('route.loading') : t('route.load')}
        </button>
      </div>

      {error && <ErrorAlert message={error} />}

      {conv && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium text-on-surface">{conv.dungeon_name}</span>
            <span className="font-medium text-gold">+{conv.keystone_level}</span>
            <span className="text-on-surface-variant/70">
              {conv.pull_count} pulls · {conv.enemy_count} enemies
            </span>
            {conv.mdt_version && (
              <span
                className="text-on-surface-variant/40"
                title={t('route.mdtVersionTitle')}
              >
                MDT {conv.mdt_version}
              </span>
            )}
            {conv.unresolved > 0 && (
              <span className="text-amber-400">{conv.unresolved} unresolved</span>
            )}
          </div>
          <div className="flex min-h-0 flex-1 gap-4">
            <div className="min-w-0 flex-1">
              <RouteMap
                map={conv.map}
                selectedPull={selectedPull}
                onSelectPull={setSelectedPull}
              />
            </div>
            <div className="w-72 shrink-0">
              <PullList
                pulls={conv.map.pulls}
                selectedPull={selectedPull}
                onSelectPull={setSelectedPull}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
