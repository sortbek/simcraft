'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import en_US from '../../../locales/en_US.json';

export type Locale = 'en_US' | 'de_DE' | 'es_ES' | 'fr_FR' | 'it_IT' | 'pt_BR' | 'ru_RU';

export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en_US', label: 'English' },
  { value: 'de_DE', label: 'Deutsch' },
  { value: 'es_ES', label: 'Español' },
  { value: 'fr_FR', label: 'Français' },
  { value: 'it_IT', label: 'Italiano' },
  { value: 'pt_BR', label: 'Português' },
  { value: 'ru_RU', label: 'Русский' },
];

type Translations = Record<string, string>;

const STORAGE_KEY = 'simhammer_language';

// Lazy-load non-English locales
const localeLoaders: Record<Locale, () => Promise<{ default: Translations }>> = {
  en_US: () => Promise.resolve({ default: en_US }),
  de_DE: () => import('../../../locales/de_DE.json'),
  es_ES: () => import('../../../locales/es_ES.json'),
  fr_FR: () => import('../../../locales/fr_FR.json'),
  it_IT: () => import('../../../locales/it_IT.json'),
  pt_BR: () => import('../../../locales/pt_BR.json'),
  ru_RU: () => import('../../../locales/ru_RU.json'),
};

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en_US');
  const [translations, setTranslations] = useState<Translations>(en_US);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem(STORAGE_KEY, newLocale);
  }, []);

  // Read stored locale after mount (avoids hydration mismatch)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LOCALES.some((l) => l.value === stored) && stored !== 'en_US') {
      setLocaleState(stored as Locale);
    }
  }, []);

  // Load translations when locale changes
  useEffect(() => {
    if (locale === 'en_US') {
      setTranslations(en_US);
      return;
    }
    localeLoaders[locale]()
      .then((mod) => setTranslations(mod.default))
      .catch(() => setTranslations(en_US));
  }, [locale]);

  // Update html lang attribute
  useEffect(() => {
    document.documentElement.lang = locale.replace('_', '-');
  }, [locale]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      let value = translations[key] ?? (en_US as Translations)[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          value = value.replace(`{${k}}`, String(v));
        }
      }
      return value;
    },
    [translations]
  );

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

// Fallback for SSR / static generation when LanguageProvider is not mounted
const fallback: LanguageContextValue = {
  locale: 'en_US',
  setLocale: () => {},
  t: (key: string, params?: Record<string, string | number>): string => {
    let value = (en_US as Translations)[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replace(`{${k}}`, String(v));
      }
    }
    return value;
  },
};

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  return ctx ?? fallback;
}
