'use client';

import Link from 'next/link';
import { useActiveSims } from '../../lib/useActiveSims';
import { ROUTES } from '../../lib/routes';
import { useLanguage } from '../../lib/i18n';

export default function ActiveSimsIndicator() {
  const { t } = useLanguage();
  const { runningCount } = useActiveSims();

  if (runningCount === 0) return null;

  return (
    <Link
      href={ROUTES.sims}
      className="desktop-no-drag flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[12px] font-medium text-amber-300 transition-colors hover:bg-amber-500/20"
      title={t('layout.simsRunningTitle', {
        count: runningCount,
        s: runningCount === 1 ? '' : 's',
      })}
    >
      <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
      {t('layout.simsRunning', { count: runningCount })}
    </Link>
  );
}
