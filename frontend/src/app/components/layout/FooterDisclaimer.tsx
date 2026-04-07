'use client';

import { useLanguage } from '../../lib/i18n';

export default function FooterDisclaimer({ version }: { version: string }) {
  const { t } = useLanguage();
  return (
    <footer className="mt-16 border-t border-outline-variant/10 py-8">
      <p className="mx-auto max-w-md text-center text-[13px] leading-relaxed text-on-surface-variant/30">
        {t('footer.disclaimer')}
      </p>
      <p className="mt-3 text-center text-[12px] text-on-surface-variant/30">v{version}</p>
    </footer>
  );
}
