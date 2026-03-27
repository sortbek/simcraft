'use client';

import { useEffect, useState, useCallback } from 'react';

export default function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

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
    <div className="desktop-only" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <div className="flex items-center gap-1">
        <button
          onClick={() => windowAction('minimize')}
          onMouseEnter={() => setHovered('min')}
          onMouseLeave={() => setHovered(null)}
          className="flex h-7 w-7 items-center justify-center rounded-md transition-all duration-150 hover:bg-white/[0.08]"
        >
          <div
            className={`h-[1.5px] w-2.5 rounded-full transition-colors duration-150 ${
              hovered === 'min' ? 'bg-gray-300' : 'bg-gray-600'
            }`}
          />
        </button>

        <button
          onClick={() => windowAction('toggleMaximize')}
          onMouseEnter={() => setHovered('max')}
          onMouseLeave={() => setHovered(null)}
          className="flex h-7 w-7 items-center justify-center rounded-md transition-all duration-150 hover:bg-white/[0.08]"
        >
          {isMaximized ? (
            <svg
              className={`h-[10px] w-[10px] transition-colors duration-150 ${
                hovered === 'max' ? 'text-gray-300' : 'text-gray-600'
              }`}
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            >
              <path d="M2.5 3.5h4v4h-4z" />
              <path d="M3.5 3.5V2.5h4v4h-1" />
            </svg>
          ) : (
            <svg
              className={`h-[10px] w-[10px] transition-colors duration-150 ${
                hovered === 'max' ? 'text-gray-300' : 'text-gray-600'
              }`}
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            >
              <rect x="1.5" y="1.5" width="7" height="7" rx="0.5" />
            </svg>
          )}
        </button>

        <button
          onClick={() => windowAction('close')}
          onMouseEnter={() => setHovered('close')}
          onMouseLeave={() => setHovered(null)}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-all duration-150 ${
            hovered === 'close' ? 'bg-red-500/90' : 'hover:bg-white/[0.08]'
          }`}
        >
          <svg
            className={`h-[10px] w-[10px] transition-colors duration-150 ${
              hovered === 'close' ? 'text-white' : 'text-gray-600'
            }`}
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          >
            <path d="M2 2l6 6M8 2l-6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
