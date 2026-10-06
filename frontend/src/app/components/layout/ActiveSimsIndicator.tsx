'use client';

import Link from 'next/link';
import { useActiveSims } from '../../lib/useActiveSims';
import { ROUTES } from '../../lib/routes';
import { useLanguage } from '../../lib/i18n';
import Pill from '../ui/Pill';

export default function ActiveSimsIndicator() {
  const { t } = useLanguage();
  const { runningCount } = useActiveSims();

  if (runningCount === 0) return null;

  return (
    <Link
      href={ROUTES.sims}
      className="desktop-no-drag rounded-[5px] transition-opacity hover:opacity-80"
      title={t(runningCount === 1 ? 'layout.simsRunningTitleOne' : 'layout.simsRunningTitle', {
        count: runningCount,
      })}
    >
      <Pill variant="gold">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold-fill" />
        {t('layout.simsRunning', { count: runningCount })}
      </Pill>
    </Link>
  );
}
