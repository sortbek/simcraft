'use client';

import { useLanguage } from '../lib/i18n';
import CardHeader from '../components/ui/CardHeader';
import { THEMES, ThemeSwatch, useTheme } from '../components/layout/ThemeSelector';

export default function AppearanceSection() {
  const { t } = useLanguage();
  const { theme, setTheme } = useTheme();

  return (
    <section className="card">
      <CardHeader title={t('settings.appearance')} />
      <div className="p-6">
        <h3 className="lbl">{t('settings.theme')}</h3>
        <p className="mt-2 text-xs text-on-surface-variant">{t('settings.themeDesc')}</p>
        <div className="mt-4 grid max-w-xl grid-cols-2 gap-3">
          {THEMES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTheme(id)}
              aria-pressed={id === theme}
              className={`flex flex-col overflow-hidden rounded-[8px] border text-left transition-colors ${
                id === theme
                  ? 'border-gold-edge bg-gold-tint'
                  : 'border-line/[0.06] bg-surface-container-high hover:border-line/[0.11]'
              }`}
            >
              <ThemeSwatch id={id} className="h-16" />
              <div className="p-3">
                <div
                  className={`font-headline text-xs font-extrabold uppercase tracking-[0.12em] ${
                    id === theme ? 'text-gold' : 'text-on-surface'
                  }`}
                >
                  {t(`theme.${id}`)}
                </div>
                <p className="mt-1 text-xs leading-snug text-on-surface-variant">
                  {t(`theme.${id}Desc`)}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
