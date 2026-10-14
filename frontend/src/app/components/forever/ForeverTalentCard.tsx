'use client';
/* eslint-disable @next/next/no-img-element */

import { iconProps } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import { TreeToggleCell, useTreeOpen } from '../talents/TalentSummaryRow';
import ForeverTalentTrees from './ForeverTalentTrees';
import { SPEC_LABEL_KEYS, talentPointsLabel } from './specs';
import { deepestTalents } from './talentTrees';
import type { ForeverImport } from './types';

/** The retail talent card's summary row (spec, deepest talents, points) with the trees on demand. */
export default function ForeverTalentCard({
  summary,
  specKey,
  onSpecChange,
}: {
  summary: ForeverImport;
  specKey: string | null;
  onSpecChange: (key: string) => void;
}) {
  const { t } = useLanguage();
  const [treeOpen, setTreeOpen] = useTreeOpen();
  const trees = summary.talent_trees ?? [];
  const deepest = deepestTalents(trees);
  const specLabel = (key: string) => (SPEC_LABEL_KEYS[key] ? t(SPEC_LABEL_KEYS[key]) : key);

  return (
    <div className="card">
      <div className="talent-summary">
        <div className="talent-summary-cell talent-summary-picker">
          <span className="lbl">{t('forever.spec')}</span>
          {summary.spec_choices.length > 1 ? (
            <select
              value={specKey ?? ''}
              onChange={(e) => onSpecChange(e.target.value)}
              aria-label={t('forever.spec')}
              className="sel"
            >
              {specKey && !summary.spec_choices.includes(specKey) && (
                <option value={specKey}>{t('forever.spec.healer')}</option>
              )}
              {summary.spec_choices.map((k) => (
                <option key={k} value={k}>
                  {specLabel(k)}
                </option>
              ))}
            </select>
          ) : (
            <span className="flex min-h-[38px] items-center text-[13.5px] font-semibold capitalize text-on-surface">
              {specKey ? specLabel(specKey) : summary.class}
            </span>
          )}
        </div>
        {deepest.length > 0 && (
          <div className="talent-summary-cell talent-summary-highlights">
            <span className="lbl">{t('forever.deepestTalents')}</span>
            <span className="flex min-h-[38px] flex-wrap items-center gap-1">
              {deepest.map((d) => (
                <img
                  key={`${d.row}:${d.col}:${d.name}`}
                  {...iconProps(d.icon)}
                  alt={d.name}
                  title={`${d.name} (${d.rank}/${d.max_ranks})`}
                  className="h-6 w-6 rounded-[6px] border-[1.5px] border-gold-edge object-cover"
                />
              ))}
            </span>
          </div>
        )}
        <div className="talent-summary-cell talent-summary-points">
          <span className="lbl">{t('talent.points')}</span>
          <span className="flex min-h-[38px] items-center font-headline text-[13.5px] font-extrabold tabular-nums text-on-surface">
            {talentPointsLabel(summary.points_per_tree) ?? t('forever.noTalents')}
          </span>
        </div>
        {trees.length > 0 && (
          <TreeToggleCell open={treeOpen} onToggle={() => setTreeOpen(!treeOpen)} />
        )}
      </div>
      {treeOpen && trees.length > 0 && (
        <div className="border-t border-line/[0.06] p-4">
          <ForeverTalentTrees trees={trees} />
        </div>
      )}
    </div>
  );
}
