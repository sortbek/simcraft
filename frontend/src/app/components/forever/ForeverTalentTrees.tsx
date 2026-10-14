'use client';
/* eslint-disable @next/next/no-img-element */

import Pill from '../ui/Pill';
import { iconProps } from '../../lib/useItemInfo';
import type { ForeverTalent, ForeverTalentTree } from './types';

const CELL = 42;
const GAP = 14;
const COLS = 4;
const at = (n: number) => n * (CELL + GAP);
const centre = (n: number) => at(n) + CELL / 2;

function Node({ talent }: { talent: ForeverTalent }) {
  const on = talent.rank > 0;
  return (
    <div
      className="absolute"
      style={{ left: at(talent.col), top: at(talent.row), width: CELL, height: CELL }}
      title={`${talent.name} (${talent.rank}/${talent.max_ranks})`}
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
    </div>
  );
}

function Tree({ tree }: { tree: ForeverTalentTree }) {
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
        {tree.talents.map((t) => (
          <Node key={`${t.row}:${t.col}`} talent={t} />
        ))}
      </div>
    </div>
  );
}

/** The three calculator trees side by side, as the retail tree lays out its trees. */
export default function ForeverTalentTrees({ trees }: { trees: ForeverTalentTree[] }) {
  return (
    <div className="flex flex-col items-center gap-6 lg:flex-row lg:flex-wrap lg:items-start lg:justify-center lg:gap-0 lg:[&>*+*]:shadow-[inset_1px_0_0_rgb(var(--c-line)/calc(0.06*var(--c-line-k)))]">
      {trees.map((tree) => (
        <Tree key={tree.name} tree={tree} />
      ))}
    </div>
  );
}
