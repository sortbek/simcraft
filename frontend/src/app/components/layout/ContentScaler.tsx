'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { VIEWER_BUILD } from '../../lib/featureFlags';

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
      className={VIEWER_BUILD ? 'origin-top' : 'mx-auto max-w-screen-2xl origin-top px-8 py-8'}
      style={scale !== 100 ? { zoom: scale / 100 } : undefined}
    >
      {children}
    </main>
  );
}

export function ScaleSelector() {
  const { scale, setScale } = useContentScale();
  const fill = ((scale - MIN_SCALE) / (MAX_SCALE - MIN_SCALE)) * 100;

  return (
    <div className="flex flex-1 items-center gap-2.5">
      <input
        type="range"
        min={MIN_SCALE}
        max={MAX_SCALE}
        step={STEP}
        value={scale}
        onChange={(e) => setScale(parseInt(e.target.value, 10))}
        style={{ '--v': `${fill}%` } as React.CSSProperties}
        className="range-slim !h-3 min-w-0 flex-1"
      />
      <span className="lbl w-9 text-right tabular-nums text-on-surface-variant">{scale}%</span>
    </div>
  );
}
