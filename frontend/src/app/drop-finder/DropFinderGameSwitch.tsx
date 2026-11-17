'use client';

import PageHeader from '../components/ui/PageHeader';
import ForeverDropFinder from '../components/forever/ForeverDropFinder';
import { useSimContext } from '../components/sim-config/SimContext';
import { useLanguage } from '../lib/i18n';
import DropFinderContent from './DropFinderContent';

export default function DropFinderGameSwitch() {
  const { game } = useSimContext();
  const { t } = useLanguage();
  if (game !== 'forever') return <DropFinderContent />;
  return (
    <div className="space-y-5 pb-20">
      <PageHeader
        eyebrow={t('nav.simTools')}
        title={t('dropFinder.title')}
        subtitle={t('forever.drops.subtitle')}
      />
      <ForeverDropFinder />
    </div>
  );
}
