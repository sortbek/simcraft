'use client';

import { useEffect, useState, useCallback } from 'react';

export default function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  const windowAction = useCallback(async (action: 'minimize' | 'toggleMaximize' | 'close') => {
    try {
      const api = window.electronAPI;
      if (!api) return;
      if (action === 'minimize') await api.minimize();
      else if (action === 'toggleMaximize') {
        await api.toggleMaximize();
        setIsMaximized(await api.isMaximized());
      } else if (action === 'close') await api.close();
    } catch {}
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api
      .isMaximized()
      .then(setIsMaximized)
      .catch(() => {});
    const unlisten = api.onMaximizedChange(setIsMaximized);
    return () => {
      unlisten();
    };
  }, []);

  return (
    <div
      className="desktop-only-flex -mr-7"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <div className="flex items-center text-outline">
        <div className="mr-2.5 h-5 w-px bg-overlay/[0.06]" />

        <button
          onClick={() => windowAction('minimize')}
          className="grid h-9 w-11 place-items-center transition-colors duration-100 hover:bg-surface-container-high hover:text-on-surface"
        >
          <svg
            className="h-[10px] w-[10px]"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
          >
            <path d="M1.5 5h7" />
          </svg>
        </button>

        <button
          onClick={() => windowAction('toggleMaximize')}
          className="grid h-9 w-11 place-items-center transition-colors duration-100 hover:bg-surface-container-high hover:text-on-surface"
        >
          {isMaximized ? (
            <svg
              className="h-[10px] w-[10px]"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
            >
              <rect x="0.5" y="2.5" width="6" height="6" rx="0.5" />
              <path d="M3.5 2.5V1.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5H8.5" />
            </svg>
          ) : (
            <svg
              className="h-[10px] w-[10px]"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
            >
              <rect x="1" y="1" width="8" height="8" rx="1" />
            </svg>
          )}
        </button>

        <button
          onClick={() => windowAction('close')}
          className="grid h-9 w-11 place-items-center transition-colors duration-100 hover:bg-win-close hover:text-white"
        >
          <svg
            className="h-[10px] w-[10px]"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          >
            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
