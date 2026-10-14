'use client';

import PageHeader from '../components/ui/PageHeader';
import ForeverTopGear from '../components/forever/ForeverTopGear';
import { useSimContext } from '../components/sim-config/SimContext';
import { useLanguage } from '../lib/i18n';
import TopGearScreen from './TopGearScreen';

export default function TopGearGameSwitch() {
  const { game } = useSimContext();
  const { t } = useLanguage();
  if (game !== 'forever') return <TopGearScreen />;
  return (
    <div className="space-y-5 pb-20">
      <PageHeader
        eyebrow={t('nav.simTools')}
        title={t('nav.topGear')}
        subtitle={t('page.topGearSubtitle')}
      />
      <ForeverTopGear />
    </div>
  );
}
