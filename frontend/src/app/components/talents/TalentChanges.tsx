'use client';
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { iconProps } from '../../lib/useItemInfo';
import { entryOf, type BuildDiff, type BuildSummary } from '../../lib/talentSummary';
import { cn } from '../../lib/cn';

const MAX_CHIPS = 8;

const TONE = {
  gained: 'bg-positive/10 text-positive',
  lost: 'bg-negative/10 text-negative',
  changed: 'bg-info/10 text-info',
};

function Chip({
  icon,
  tone,
  children,
}: {
  icon?: string | null;
  tone: keyof typeof TONE;
  children: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-[5px] pl-[3px] pr-2 text-[12px] font-semibold',
        TONE[tone]
      )}
    >
      {icon && <img {...iconProps(icon)} alt="" className="h-[18px] w-[18px] rounded-[4px]" />}
      {children}
    </span>
  );
}

/** What the shown build changes against the equipped one, as chips. A hero-tree
 *  switch is one chip; long lists collapse behind "+N more". */
export default function TalentChanges({
  diff,
  isEquipped,
  heroFrom,
  heroTo,
  max = MAX_CHIPS,
}: {
  diff: BuildDiff | null;
  isEquipped: boolean;
  heroFrom: BuildSummary | null;
  heroTo: BuildSummary | null;
  /** Chips shown before "+N more". */
  max?: number;
}) {
  const { t } = useLanguage();
  const [all, setAll] = useState(false);
  useEffect(() => setAll(false), [diff]);

  if (isEquipped) {
    return <span className="text-[12.5px] text-outline">{t('talent.isEquipped')}</span>;
  }
  if (!diff) return <span />;
  if (diff.count === 0) {
    return <span className="text-[12.5px] text-outline">{t('talent.sameAsEquipped')}</span>;
  }

  const chips = [
    ...(diff.heroSwap
      ? [
          <Chip key="hero" icon={heroTo?.heroIcon} tone="changed">
            {`${heroFrom?.heroName ?? '?'} → ${heroTo?.heroName ?? '?'}`}
          </Chip>,
        ]
      : []),
    ...diff.gained.map(({ node, to }) => (
      <Chip key={`g${node.id}`} icon={entryOf(node, to)?.icon} tone="gained">
        {`+ ${entryOf(node, to)?.name ?? node.name}`}
      </Chip>
    )),
    ...diff.lost.map(({ node, from }) => (
      <Chip key={`l${node.id}`} icon={entryOf(node, from)?.icon} tone="lost">
        {`− ${entryOf(node, from)?.name ?? node.name}`}
      </Chip>
    )),
    ...diff.changed.map(({ node, from, to }) => (
      <Chip key={`c${node.id}`} icon={entryOf(node, to)?.icon} tone="changed">
        {from?.choiceIndex !== to?.choiceIndex
          ? `${entryOf(node, from)?.name} → ${entryOf(node, to)?.name}`
          : `${entryOf(node, to)?.name} ${from?.ranks}→${to?.ranks}`}
      </Chip>
    )),
  ];
  const shown = all ? chips : chips.slice(0, max);
  const more = chips.length - shown.length;

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <span className="lbl mr-1">
        {t(diff.count === 1 ? 'talent.changeVsEquippedOne' : 'talent.changesVsEquipped', {
          count: diff.count,
        })}
      </span>
      {shown}
      {more > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="inline-flex h-6 items-center rounded-[5px] bg-overlay/[0.06] px-2 text-[12px] font-semibold text-on-surface-variant hover:text-on-surface"
        >
          {t('talent.moreChanges', { count: more })}
        </button>
      )}
    </div>
  );
}
