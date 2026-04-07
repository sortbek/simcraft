'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '../../lib/i18n';

export default function UpdateChecker() {
  const { t } = useLanguage();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [version, setVersion] = useState('');
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    // Listen for update notifications from main process
    const unlisten = api.onUpdateAvailable((ver) => {
      setUpdateAvailable(true);
      setVersion(ver);
    });

    // Also actively check
    api
      .checkForUpdate()
      .then((result) => {
        if (result) {
          setUpdateAvailable(true);
          setVersion(result.version);
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

  async function handleInstall() {
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
    <div className="fixed bottom-4 right-4 z-[100] max-w-sm rounded-lg border border-gold/40 bg-[#1a1a2e] p-4 shadow-lg shadow-black/40">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gold/20">
          <svg
            className="h-4 w-4 text-gold"
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
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-200">{t('layout.updateAvailable')}</p>
          <p className="mt-0.5 text-xs text-gray-400">{t('layout.updateReady', { version })}</p>
          {error && <p className="mt-1 text-xs text-red-400">{t('layout.updateFailed')}</p>}
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleInstall}
              disabled={installing}
              className="rounded bg-gold px-3 py-1.5 text-xs font-medium text-black transition-colors hover:bg-gold/90 disabled:opacity-50"
            >
              {installing ? t('layout.downloading', { progress }) : t('layout.installRestart')}
            </button>
            <button
              onClick={() => setUpdateAvailable(false)}
              disabled={installing}
              className="rounded px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-gray-200"
            >
              {t('layout.later')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
