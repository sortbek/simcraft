'use client';

import GearItemRow from '../gear/GearItemRow';
import { qualityHex } from '../../lib/qualityColors';
import { useLanguage } from '../../lib/i18n';
import { SPEC_LABEL_KEYS, talentPointsLabel } from './specs';
import type { ForeverImport } from './types';

export default function ForeverCharacterCard({
  summary,
  specKey,
  onSpecChange,
}: {
  summary: ForeverImport;
  specKey: string | null;
  onSpecChange: (key: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="card space-y-4 px-6 py-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-headline text-xl font-extrabold text-on-surface">{summary.name}</h2>
        <span className="text-sm capitalize text-outline">
          {t('forever.levelLine', {
            level: summary.level,
            race: summary.race.replace(/_/g, ' '),
            cls: summary.class,
          })}
        </span>
        {summary.spec_choices.length > 1 && (
          <select
            value={specKey ?? ''}
            onChange={(e) => onSpecChange(e.target.value)}
            aria-label={t('forever.spec')}
            className="ml-auto h-8 rounded-[6px] border border-line/[0.06] bg-surface-container-highest px-2 text-sm"
          >
            {specKey && !summary.spec_choices.includes(specKey) && (
              <option value={specKey}>{t('forever.spec.healer')}</option>
            )}
            {summary.spec_choices.map((k) => (
              <option key={k} value={k}>
                {SPEC_LABEL_KEYS[k] ? t(SPEC_LABEL_KEYS[k]) : k}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="text-sm text-on-surface-variant">
        <span className="lbl mr-2">{t('forever.talents')}</span>
        {talentPointsLabel(summary.points_per_tree) ?? t('forever.noTalents')}
      </p>
      {summary.warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-warning">
          {summary.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {summary.equipped.map((g) => (
          <GearItemRow
            key={`${g.slot}-${g.item_id}`}
            icon={g.icon || 'inv_misc_questionmark'}
            name={g.name}
            nameColor={qualityHex(g.quality)}
            ilevel={g.ilevel}
          />
        ))}
      </div>
    </div>
  );
}
