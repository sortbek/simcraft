'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import MiniSelect from '../ui/MiniSelect';
import { useLanguage } from '../../lib/i18n';

// Same key the inline script in layout.tsx reads before first paint.
const STORAGE_KEY = 'simhammer_theme';
export const THEMES = ['forge', 'parchment'] as const;
export type ThemeId = (typeof THEMES)[number];
const DEFAULT_THEME: ThemeId = 'forge';

const isTheme = (v: string | null): v is ThemeId => THEMES.includes(v as ThemeId);

const ThemeContext = createContext<{
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}>({ theme: DEFAULT_THEME, setTheme: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME);

  // The layout.tsx head script already validated, migrated and applied the stored
  // theme before first paint; adopt what it set rather than repeating that logic.
  useEffect(() => {
    const applied = document.documentElement.getAttribute('data-theme');
    if (isTheme(applied)) setThemeState(applied);
  }, []);

  const setTheme = useCallback((t: ThemeId) => {
    setThemeState(t);
    document.documentElement.setAttribute('data-theme', t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {}
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

/** Mini preview of a theme: its own `data-theme` scopes the color variables. */
export function ThemeSwatch({ id, className = '' }: { id: ThemeId; className?: string }) {
  return (
    <div data-theme={id} className={`bg-background p-1.5 ${className}`}>
      <div className="flex h-full flex-col gap-1 rounded-[3px] bg-surface-container p-1.5">
        <div className="h-1.5 w-1/3 rounded-full bg-gold-fill" />
        <div className="h-1 w-3/4 rounded-full bg-on-surface/80" />
        <div className="h-1 w-1/2 rounded-full bg-outline/70" />
      </div>
    </div>
  );
}

// Mock .sw: the theme's card color and gold split diagonally.
function ThemeDot({ id }: { id: ThemeId }) {
  return (
    <span
      data-theme={id}
      className="h-3 w-3 shrink-0 rounded-[3px] border border-line/[0.11] bg-[linear-gradient(135deg,rgb(var(--c-surface-container))_50%,rgb(var(--c-primary-fill))_50%)]"
    />
  );
}

/** Compact sidebar picker in the footer Theme row. */
export default function ThemeSelector() {
  const { t } = useLanguage();
  const { theme, setTheme } = useTheme();
  return (
    <MiniSelect
      value={theme}
      onChange={setTheme}
      label={t('layout.theme')}
      options={THEMES.map((id) => ({
        value: id,
        label: t(`theme.${id}`),
        icon: <ThemeDot id={id} />,
      }))}
    />
  );
}
