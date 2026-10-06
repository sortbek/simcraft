'use client';

import { useLanguage } from '../lib/i18n';
import { useIsDesktop } from '../lib/useIsDesktop';
import GeneralSettingsSection from './GeneralSettingsSection';
import SimcEngineSection from './SimcEngineSection';
import ComputeProvidersSection from './ComputeProvidersSection';
import AppearanceSection from './AppearanceSection';
import PageHeader from '../components/ui/PageHeader';

export default function SettingsPage() {
  const { t } = useLanguage();
  const isDesktop = useIsDesktop();

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-20">
      <header className="mb-10">
        <PageHeader
          eyebrow={t('nav.app')}
          title={t('common.settings')}
          subtitle={t('settings.pageDescription')}
        />
      </header>
      <ComputeProvidersSection />
      {isDesktop && (
        <>
          <section className="space-y-4">
            <SimcEngineSection />
          </section>
          <GeneralSettingsSection />
        </>
      )}
      <AppearanceSection />
    </div>
  );
}
