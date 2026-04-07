'use client';

import { useLanguage } from './lib/i18n';

export default function Home() {
  const { t } = useLanguage();
  return (
    <div className="py-12 text-center">
      <p className="text-sm text-muted">{t('home.selectSimType')}</p>
    </div>
  );
}
