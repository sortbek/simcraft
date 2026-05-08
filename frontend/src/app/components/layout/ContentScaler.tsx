'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'simhammer_content_scale';
const DEFAULT_SCALE = 100;
const MIN_SCALE = 75;
const MAX_SCALE = 150;
const STEP = 5;

const ScaleContext = createContext<{
  scale: number;
  setScale: (s: number) => void;
}>({ scale: DEFAULT_SCALE, setScale: () => {} });

export function useContentScale() {
  return useContext(ScaleContext);
}

export function ScaleProvider({ children }: { children: React.ReactNode }) {
  const [scale, setScaleState] = useState(DEFAULT_SCALE);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (parsed >= MIN_SCALE && parsed <= MAX_SCALE) setScaleState(parsed);
      }
    } catch {}
  }, []);

  const setScale = useCallback((s: number) => {
    setScaleState(s);
    try {
      localStorage.setItem(STORAGE_KEY, String(s));
    } catch {}
  }, []);

  return <ScaleContext.Provider value={{ scale, setScale }}>{children}</ScaleContext.Provider>;
}

export default function ContentScaler({ children }: { children: React.ReactNode }) {
  const { scale } = useContentScale();

  return (
    <main
      className="mx-auto max-w-screen-2xl origin-top px-8 py-8"
      style={scale !== 100 ? { zoom: scale / 100 } : undefined}
    >
      {children}
    </main>
  );
}

export function ScaleSelector() {
  const { scale, setScale } = useContentScale();

  return (
    <div className="flex items-center gap-2">
      <svg
        className="h-3.5 w-3.5 shrink-0 text-on-surface-variant/60"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="7" cy="7" r="5" />
        <path d="M14 14l-3.5-3.5M7 5v4M5 7h4" />
      </svg>
      <input
        type="range"
        min={MIN_SCALE}
        max={MAX_SCALE}
        step={STEP}
        value={scale}
        onChange={(e) => setScale(parseInt(e.target.value, 10))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-outline-variant/20 accent-primary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
      />
      <span className="w-8 text-right text-[11px] font-medium tabular-nums text-on-surface-variant/60">
        {scale}%
      </span>
    </div>
  );
}
