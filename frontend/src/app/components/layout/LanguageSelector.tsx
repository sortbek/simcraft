'use client';

import { useLanguage, LOCALES } from '../../lib/i18n';
import MiniSelect from '../ui/MiniSelect';

export default function LanguageSelector() {
  const { t, locale, setLocale } = useLanguage();
  return (
    <MiniSelect
      value={locale}
      onChange={setLocale}
      label={t('layout.language')}
      options={LOCALES.map((l) => ({ value: l.value, label: l.label }))}
    />
  );
}
