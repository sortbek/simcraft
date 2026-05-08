'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function SimcDownloadBanner() {
  const [status, setStatus] = useState<SimcStatus | null>(null);

  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.getSimcStatus().then(setStatus);

    const unsub = window.electronAPI.onSimcStatusChanged?.((s) => setStatus(s));
    const unsubProgress = window.electronAPI.onSimcDownloadProgress?.((progress) => {
      setStatus((prev) => (prev ? { ...prev, downloading: true, progress } : null));
    });

    return () => {
      unsub?.();
      unsubProgress?.();
    };
  }, []);

  if (!status || status.ready) return null;

  if (status.downloading) {
    const percent = Math.round(status.progress * 100);
    return (
      <div className="rounded-lg bg-surface-container px-4 py-3 text-sm text-on-surface-variant">
        <div className="flex items-center gap-3">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span>Downloading SimC engine... {percent}%</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-outline-variant/20">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  if (status.error) {
    return (
      <div className="rounded-lg bg-error-container/10 px-4 py-3 text-sm text-error">
        <div className="flex items-center justify-between">
          <span>Failed to download SimC: {status.error}</span>
          <Link
            href="/settings"
            className="rounded px-3 py-1 text-xs font-medium text-error hover:bg-error-container/20"
          >
            Settings
          </Link>
        </div>
      </div>
    );
  }

  return null;
}
