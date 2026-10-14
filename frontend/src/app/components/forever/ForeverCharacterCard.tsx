'use client';

import Pill from '../ui/Pill';
import { useLanguage } from '../../lib/i18n';
import { SPEC_LABEL_KEYS } from './specs';
import type { ForeverImport } from './types';

/** The retail Quick Sim character card; Forever has no armory render and no realm. */
export default function ForeverCharacterCard({
  summary,
  specKey,
}: {
  summary: ForeverImport;
  specKey: string | null;
}) {
  const { t } = useLanguage();
  const spec = specKey && SPEC_LABEL_KEYS[specKey] ? `${t(SPEC_LABEL_KEYS[specKey])} ` : '';
  return (
    <div className="card flex items-center gap-[18px] px-6 py-5">
      <div className="min-w-0 flex-1">
        <h2 className="font-headline text-xl font-extrabold leading-[1.1] tracking-[-0.01em] text-on-surface">
          {summary.name}
        </h2>
        <div className="mt-[7px] flex items-center gap-2">
          <Pill variant="gold">
            {spec}
            {summary.class}
          </Pill>
          <span className="text-[12.5px] capitalize text-outline">
            {t('forever.levelRace', {
              level: summary.level,
              race: summary.race.replace(/_/g, ' '),
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
