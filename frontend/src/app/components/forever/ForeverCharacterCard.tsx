'use client';

import Pill from '../ui/Pill';
import ToggleButtonGroup from '../ui/ToggleButtonGroup';
import { getCharacterAvatarUrl } from '../gear/topGearResultsUtils';
import { FOREVER_REALM } from '../../lib/game';
import { useLanguage } from '../../lib/i18n';
import { SPEC_LABEL_KEYS } from './specs';
import type { ForeverImport } from './types';
import { useForeverSd } from './useForeverSd';

/** The retail Quick Sim character card; Forever has no realm. */
export default function ForeverCharacterCard({
  summary,
  specKey,
}: {
  summary: ForeverImport;
  specKey: string | null;
}) {
  const { t } = useLanguage();
  const spec = specKey && SPEC_LABEL_KEYS[specKey] ? `${t(SPEC_LABEL_KEYS[specKey])} ` : '';
  const [sd, setSd] = useForeverSd();
  const avatarUrl = summary.region
    ? getCharacterAvatarUrl(FOREVER_REALM, summary.name, summary.region, sd)
    : null;
  return (
    <div className="card flex items-center gap-[18px] px-6 py-5">
      {avatarUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={avatarUrl}
          src={avatarUrl}
          alt=""
          className="h-14 w-14 shrink-0 rounded-[10px] border border-line/[0.11] object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
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
      {avatarUrl && (
        <ToggleButtonGroup
          size="sm"
          value={sd ? 'sd' : 'hd'}
          onChange={(model) => setSd(model === 'sd')}
          options={[
            { key: 'hd', label: 'HD' },
            { key: 'sd', label: 'SD' },
          ]}
        />
      )}
    </div>
  );
}
