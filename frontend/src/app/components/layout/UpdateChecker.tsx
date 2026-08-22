'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../lib/i18n';

const SEEN_KEY = 'simhammer_update_seen';

export default function UpdateChecker() {
  const { t } = useLanguage();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [version, setVersion] = useState('');
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const api = window.electronAPI;
    if (!api) return;

    // Pop the panel open the first time we see a given version, then never again for
    // it — the pill keeps the update visible without nagging on every launch.
    function reveal(ver: string) {
      setUpdateAvailable(true);
      setVersion(ver);
      try {
        if (localStorage.getItem(SEEN_KEY) !== ver) {
          localStorage.setItem(SEEN_KEY, ver);
          setOpen(true);
        }
      } catch {}
    }

    const unlisten = api.onUpdateAvailable((ver) => {
      reveal(ver);
    });

    api
      .checkForUpdate()
      .then((result) => {
        if (result) {
          reveal(result.version);
        }
      })
      .catch(() => {});

    const unlistenProgress = api.onDownloadProgress((percent) => {
      setProgress(Math.round(percent));
    });

    return () => {
      unlisten();
      unlistenProgress();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function handleInstall() {
    if (simulated) {
      setOpen(false);
      return;
    }
    const api = window.electronAPI;
    if (!api) return;
    setInstalling(true);
    setError('');
    try {
      await api.downloadAndInstall();
    } catch (e: any) {
      setError(e?.message || 'Update failed');
      setInstalling(false);
    }
  }

  if (!updateAvailable) return null;

  return (
    <div className="border-t border-outline-variant/20 px-4 py-2">
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={`${t('layout.updateAvailable')} — v${version}`}
          className="flex w-full items-center gap-2.5 border border-primary bg-primary px-4 py-3 font-headline text-xs font-bold uppercase tracking-wider text-on-primary transition-all hover:bg-primary/90"
        >
          <svg
            className="h-4 w-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4"
            />
          </svg>
          {installing ? t('layout.downloading', { progress }) : t('layout.updateTo', { version })}
        </button>

        {open && (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-2 rounded-lg border border-outline-variant bg-surface-container-high p-3 shadow-lg shadow-black/40">
            <p className="text-sm font-medium text-on-surface">{t('layout.updateAvailable')}</p>
            <p className="mt-0.5 text-xs text-on-surface-variant">
              {t('layout.updateReady', { version })}
            </p>
            {error && <p className="mt-1 text-xs text-error">{t('layout.updateFailed')}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={handleInstall}
                disabled={installing}
                className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {installing ? t('layout.downloading', { progress }) : t('layout.installRestart')}
              </button>
              <button
                onClick={() => setOpen(false)}
                disabled={installing}
                className="rounded px-3 py-1.5 text-xs font-medium text-on-surface-variant transition-colors hover:text-on-surface"
              >
                {t('layout.later')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
