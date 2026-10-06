'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import Button from '../ui/Button';

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
    <div className="px-[22px] py-3">
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={`${t('layout.updateAvailable')} — v${version}`}
          className="flex h-[42px] w-full items-center gap-2.5 rounded-[6px] border border-gold-fill bg-gold-fill px-4 font-headline text-xs font-extrabold uppercase tracking-[0.14em] text-on-primary transition-colors hover:bg-gold-fill-hover"
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
          <div className="popover absolute bottom-full left-0 right-0 z-50 mb-2 p-3">
            <p className="text-sm font-medium text-on-surface">{t('layout.updateAvailable')}</p>
            <p className="mt-0.5 text-xs text-on-surface-variant">
              {t('layout.updateReady', { version })}
            </p>
            {error && <p className="mt-1 text-xs text-negative">{t('layout.updateFailed')}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="solid" onClick={handleInstall} disabled={installing}>
                {installing ? t('layout.downloading', { progress }) : t('layout.installRestart')}
              </Button>
              <Button size="sm" variant="text" onClick={() => setOpen(false)} disabled={installing}>
                {t('layout.later')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
