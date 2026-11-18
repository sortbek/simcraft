'use client';
/* eslint-disable @next/next/no-img-element */

import Pill from '../ui/Pill';
import { getForeverWowheadUrl, iconProps } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import type { ForeverTalent, ForeverTalentTree } from './types';

const CELL = 42;
const GAP = 14;
const COLS = 4;
const at = (n: number) => n * (CELL + GAP);
const centre = (n: number) => at(n) + CELL / 2;

type Step = (by: 1 | -1) => void;

function Node({
  talent,
  locale,
  onStep,
}: {
  talent: ForeverTalent;
  locale: string;
  onStep?: Step;
}) {
  const on = talent.rank > 0;
  return (
    <a
      href={getForeverWowheadUrl('spell', talent.spell_id, locale)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.preventDefault();
        onStep?.(1);
      }}
      onContextMenu={(e) => {
        if (!onStep) return;
        e.preventDefault();
        onStep(-1);
      }}
      aria-label={`${talent.name} (${talent.rank}/${talent.max_ranks})`}
      className="absolute block"
      style={{ left: at(talent.col), top: at(talent.row), width: CELL, height: CELL }}
    >
      <img
        {...iconProps(talent.icon)}
        alt={talent.name}
        width={CELL}
        height={CELL}
        className={`h-full w-full rounded-[6px] border-2 bg-background object-cover ${
          on ? 'border-gold' : 'border-line/[0.11] opacity-50'
        }`}
      />
      <span
        className={`absolute -bottom-1.5 -right-1.5 rounded-[4px] border border-line/[0.11] bg-background px-1 font-headline text-[10px] font-extrabold tabular-nums leading-[14px] ${
          talent.rank >= talent.max_ranks ? 'text-gold' : on ? 'text-on-surface' : 'text-outline'
        }`}
      >
        {talent.rank}/{talent.max_ranks}
      </span>
    </a>
  );
}

function Tree({
  tree,
  locale,
  onStep,
}: {
  tree: ForeverTalentTree;
  locale: string;
  onStep?: (talentIndex: number, by: 1 | -1) => void;
}) {
  const rows = Math.max(0, ...tree.talents.map((t) => t.row)) + 1;
  const width = at(COLS) - GAP;
  const height = at(rows) - GAP;
  return (
    <div className="flex min-w-0 shrink-0 flex-col items-center gap-3 px-6">
      <div className="flex items-center gap-2.5">
        <span className="h-card">{tree.name}</span>
        <Pill className="tabular-nums">{tree.points}</Pill>
      </div>
      <div className="relative" style={{ width, height }}>
        <svg className="absolute inset-0" width={width} height={height} aria-hidden>
          {tree.talents.map((t) =>
            t.prereq ? (
              <line
                key={`${t.row}:${t.col}`}
                x1={centre(t.prereq[1])}
                y1={centre(t.prereq[0])}
                x2={centre(t.col)}
                y2={centre(t.row)}
                stroke={
                  t.rank > 0
                    ? 'rgb(var(--c-primary))'
                    : 'rgb(var(--c-line) / calc(0.15 * var(--c-line-k)))'
                }
                strokeWidth={t.rank > 0 ? 3 : 2}
                strokeLinecap="round"
              />
            ) : null
          )}
        </svg>
        {tree.talents.map((t, i) => (
          <Node
            key={`${t.row}:${t.col}`}
            talent={t}
            locale={locale}
            onStep={onStep && ((by) => onStep(i, by))}
          />
        ))}
      </div>
    </div>
  );
}

/** The three calculator trees side by side, as the retail tree lays out its trees. */
export default function ForeverTalentTrees({
  trees,
  onStep,
}: {
  trees: ForeverTalentTree[];
  /** Given, the trees are a calculator: a click adds a rank, a right-click takes one off. */
  onStep?: (treeIndex: number, talentIndex: number, by: 1 | -1) => void;
}) {
  const { locale } = useLanguage();
  useWowheadTooltips([trees]);
  return (
    <div className="flex flex-col items-center gap-6 lg:flex-row lg:flex-wrap lg:items-start lg:justify-center lg:gap-0 lg:[&>*+*]:shadow-[inset_1px_0_0_rgb(var(--c-line)/calc(0.06*var(--c-line-k)))]">
      {trees.map((tree, treeIndex) => (
        <Tree
          key={tree.name}
          tree={tree}
          locale={locale}
          onStep={onStep && ((i, by) => onStep(treeIndex, i, by))}
        />
      ))}
    </div>
  );
}
