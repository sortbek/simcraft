'use client';
/* eslint-disable @next/next/no-img-element */

import { getForeverWowheadUrl, iconProps } from '../../lib/useItemInfo';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import { useLanguage } from '../../lib/i18n';
import { TreeToggleCell, useTreeOpen } from '../talents/TalentSummaryRow';
import { buttonClass } from '../ui/Button';
import ForeverTalentTrees from './ForeverTalentTrees';
import { SPEC_LABEL_KEYS, talentPointsLabel } from './specs';
import { deepestTalents, stepTalent, talentsString } from './talentTrees';
import type { ForeverImport } from './types';
import type { ForeverTalents } from './useForeverTalents';

/** The retail talent card's summary row (spec, deepest talents, points) with the calculator on
 *  demand: click a talent to add a rank, right-click to take one off. */
export default function ForeverTalentCard({
  summary,
  specKey,
  onSpecChange,
  talents,
  compare,
}: {
  summary: ForeverImport;
  specKey: string | null;
  onSpecChange: (key: string) => void;
  talents: ForeverTalents;
  compare: { submit: () => void; submitting: boolean; error: string };
}) {
  const { t, locale } = useLanguage();
  const [treeOpen, setTreeOpen] = useTreeOpen();
  const trees = summary.talent_trees ?? [];
  const deepest = deepestTalents(trees);
  useWowheadTooltips([deepest.length]);
  const specLabel = (key: string) => (SPEC_LABEL_KEYS[key] ? t(SPEC_LABEL_KEYS[key]) : key);
  const spent = summary.points_per_tree.reduce((a, b) => a + b, 0);
  const isEdited = summary.talents_string !== summary.exported_talents_string;
  const points = talentPointsLabel(summary.points_per_tree);
  const inCompare = talents.builds.some((b) => b.talents_string === summary.talents_string);

  const step = (treeIndex: number, talentIndex: number, by: 1 | -1) => {
    const next = stepTalent(trees, treeIndex, talentIndex, by, summary.max_talent_points);
    if (!next) return;
    const edited = talentsString(next);
    talents.setEdited(edited === summary.exported_talents_string ? null : edited);
  };

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
                <a
                  key={`${d.row}:${d.col}:${d.name}`}
                  href={getForeverWowheadUrl('spell', d.spell_id, locale)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.preventDefault()}
                  aria-label={d.name}
                >
                  <img
                    {...iconProps(d.icon)}
                    alt=""
                    className="h-6 w-6 rounded-[6px] border-[1.5px] border-gold-edge object-cover"
                  />
                </a>
              ))}
            </span>
          </div>
        )}
        <div className="talent-summary-cell talent-summary-points">
          <span className="lbl">{t('talent.points')}</span>
          <span className="flex min-h-[38px] items-center gap-2 font-headline text-[13.5px] font-extrabold tabular-nums text-on-surface">
            {points ?? t('forever.noTalents')}
            {isEdited && <span className="chip chip-on">{t('forever.talentsEdited')}</span>}
          </span>
        </div>
        {trees.length > 0 && (
          <TreeToggleCell open={treeOpen} onToggle={() => setTreeOpen(!treeOpen)} />
        )}
      </div>
      {treeOpen && trees.length > 0 && (
        <div className="space-y-4 border-t border-line/[0.06] p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="lbl tabular-nums">
              {t('forever.pointsSpent', { spent, max: summary.max_talent_points })}
            </span>
            <span className="text-xs text-outline">{t('forever.talentEditHint')}</span>
            <span className="ml-auto flex items-center">
              {isEdited && (
                <button
                  type="button"
                  onClick={() => talents.setEdited(null)}
                  className={buttonClass('text', 'sm')}
                >
                  {t('forever.resetTalents')}
                </button>
              )}
              <button
                type="button"
                disabled={!isEdited || inCompare}
                onClick={() =>
                  talents.addBuild({
                    name: points ?? summary.talents_string,
                    talents_string: summary.talents_string,
                  })
                }
                className={buttonClass('text', 'sm')}
              >
                {t('forever.addToCompare')}
              </button>
            </span>
          </div>
          <ForeverTalentTrees trees={trees} onStep={step} />
          {talents.builds.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-line/[0.06] pt-4">
              <span className="lbl mr-1">{t('forever.compareWith')}</span>
              {talents.builds.map((b) => (
                <button
                  key={b.talents_string}
                  type="button"
                  title={t('forever.removeBuild')}
                  onClick={() => talents.removeBuild(b.talents_string)}
                  className="chip chip-on tabular-nums"
                >
                  {b.name} ×
                </button>
              ))}
              <button
                type="button"
                disabled={compare.submitting}
                onClick={compare.submit}
                className={`ml-auto ${buttonClass('solid', 'sm')}`}
              >
                {t('forever.compareBuilds', { count: talents.builds.length + 1 })}
              </button>
              {compare.error && <p className="w-full text-xs text-negative">{compare.error}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
