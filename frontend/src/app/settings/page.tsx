'use client';

import { useLanguage } from '../lib/i18n';
import { useIsDesktop } from '../lib/useIsDesktop';
import GeneralSettingsSection from './GeneralSettingsSection';
import SimcEngineSection from './SimcEngineSection';
import ComputeProvidersSection from './ComputeProvidersSection';

export default function SettingsPage() {
  const { t } = useLanguage();
  const isDesktop = useIsDesktop();

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-20">
      <header className="mb-10">
        <h1 className="font-headline text-3xl font-extrabold uppercase tracking-tight text-primary">
          {t('common.settings')}
        </h1>
        <p className="text-on-surface-variant">Configure the simulation engine and providers.</p>
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
    </div>
  );
}
