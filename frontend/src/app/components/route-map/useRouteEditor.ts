'use client';

import { useMemo, useRef, useState } from 'react';
import type { MdtConversion, MdtMapEnemy } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { DEFAULT_PULL_COLOR, NEW_PULL_COLORS } from './routeTheme';

export type EditMode = 'view' | 'draw' | 'merge' | 'delete';

/** A pull derived from the current assignment, ready to render. */
export interface DerivedPull {
  n: number;
  /** 6-char hex (no `#`). */
  color: string;
  /** Clone instances in this pull. */
  mobs: number;
  boss: boolean;
  /** This pull's own forces (sum of clone counts). */
  forcesAbs: number;
  /** Cumulative forces up to and including this pull. */
  cum: number;
  /** Cumulative forces as a % of the dungeon requirement (1 decimal). */
  forces: number;
  /** Centroid in MDT coords (x in [0,840], y in [-560,0]) on its sublevel. */
  cx: number;
  cy: number;
  sublevel: number;
  /** Indices into `enemies` of the clones in this pull. */
  cloneIdxs: number[];
}

export interface RouteEditor {
  enemies: MdtMapEnemy[];
  /** Per-clone pull membership (null = unpulled), index-aligned with `enemies`. */
  assignment: (number | null)[];
  pulls: DerivedPull[];
  totalCount: number;
  /** Final cumulative coverage % (the big number in the timeline header). */
  coveragePct: number;
  /** Total pulled clone instances (the KeyChip "enemies" figure). */
  enemyCount: number;

  selected: number | null;
  setSelected: (n: number | null) => void;
  mode: EditMode;
  toggleMode: (m: EditMode) => void;
  endMode: () => void;
  pick: number[];
  draft: number[];

  /** Handle a click on a pull/marker, dispatching by the active mode. */
  onPullClick: (n: number) => void;
  /** Handle a click on a single clone (used by draw to gather unpulled mobs). */
  onCloneClick: (idx: number) => void;
  /** Add a lasso selection of unpulled clones to the draft pull. */
  addToDraft: (idxs: number[]) => void;
  commitDraw: () => void;
}

/** Editable route model on top of a decoded MDT conversion. The conversion's
 *  flat clone list is immutable; edits live in `assignment` (clone → pull) and
 *  `colors`, and every derived view recomputes from those. */
export function useRouteEditor(conv: MdtConversion, flash: (msg: string) => void): RouteEditor {
  const { t } = useLanguage();
  const enemies = conv.map.enemies;
  const totalCount = conv.map.total_count || enemies.reduce((s, e) => s + e.count, 0) || 1;

  const [assignment, setAssignment] = useState<(number | null)[]>(() => enemies.map((e) => e.pull));
  const [colors, setColors] = useState<Record<number, string>>(() => {
    const c: Record<number, string> = {};
    for (const p of conv.map.pulls) c[p.index] = p.color;
    return c;
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<EditMode>('view');
  const [pick, setPick] = useState<number[]>([]);
  const [draft, setDraft] = useState<number[]>([]);
  const colorCursor = useRef(0);

  const toggleMode = (m: EditMode) => {
    setMode((cur) => (cur === m ? 'view' : m));
    setSelected(null);
    setPick([]);
    setDraft([]);
  };
  const endMode = () => {
    setMode('view');
    setPick([]);
    setDraft([]);
  };

  // Renumber pull ids to a gapless 1..K (ascending) and remap colors to match.
  const renumber = (asg: (number | null)[], cols: Record<number, string>) => {
    const present = [...new Set(asg.filter((p): p is number => p !== null))].sort((a, b) => a - b);
    const remap = new Map(present.map((old, i) => [old, i + 1]));
    const nextAsg = asg.map((p) => (p === null ? null : remap.get(p)!));
    const nextCols: Record<number, string> = {};
    for (const [old, nu] of remap) nextCols[nu] = cols[old] ?? DEFAULT_PULL_COLOR;
    return { nextAsg, nextCols };
  };

  const deletePull = (n: number) => {
    const asg = assignment.map((p) => (p === n ? null : p));
    const { nextAsg, nextCols } = renumber(asg, colors);
    setAssignment(nextAsg);
    setColors(nextCols);
    setSelected(null);
    flash(t('route.editor.pullDeleted'));
  };

  const mergePulls = (a: number, b: number) => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const asg = assignment.map((p) => (p === hi ? lo : p));
    const { nextAsg, nextCols } = renumber(asg, colors);
    setAssignment(nextAsg);
    setColors(nextCols);
    setSelected(null);
    setPick([]);
    setMode('view');
    flash(t('route.editor.pullsMerged'));
  };

  const onPullClick = (n: number) => {
    if (mode === 'delete') {
      deletePull(n);
      return;
    }
    if (mode === 'merge') {
      setPick((cur) => {
        if (cur.includes(n)) return cur.filter((x) => x !== n);
        const next = [...cur, n];
        if (next.length === 2) {
          mergePulls(next[0], next[1]);
          return [];
        }
        return next;
      });
      return;
    }
    setSelected((s) => (s === n ? null : n));
  };

  const onCloneClick = (idx: number) => {
    if (mode !== 'draw') return;
    if (assignment[idx] !== null) return; // only unpulled mobs join a new pull
    setDraft((cur) => (cur.includes(idx) ? cur.filter((x) => x !== idx) : [...cur, idx]));
  };

  // Add a lasso selection of unpulled clones to the draft pull (union).
  const addToDraft = (idxs: number[]) => {
    if (mode !== 'draw') return;
    const fresh = idxs.filter((i) => assignment[i] === null);
    if (!fresh.length) return;
    setDraft((cur) => [...new Set([...cur, ...fresh])]);
  };

  const commitDraw = () => {
    if (draft.length === 0) {
      endMode();
      return;
    }
    const present = assignment.filter((p): p is number => p !== null);
    const newN = (present.length ? Math.max(...present) : 0) + 1;
    const color = NEW_PULL_COLORS[colorCursor.current % NEW_PULL_COLORS.length];
    colorCursor.current += 1;
    const drafted = new Set(draft);
    const asg = assignment.map((p, i) => (drafted.has(i) ? newN : p));
    setAssignment(asg);
    setColors((c) => ({ ...c, [newN]: color }));
    setDraft([]);
    setMode('view');
    flash(t('route.editor.pullAdded', { n: newN, count: draft.length }));
  };

  const pulls = useMemo<DerivedPull[]>(() => {
    const byPull = new Map<number, number[]>();
    assignment.forEach((p, i) => {
      if (p === null) return;
      const arr = byPull.get(p) ?? [];
      arr.push(i);
      byPull.set(p, arr);
    });
    const ns = [...byPull.keys()].sort((a, b) => a - b);
    let run = 0;
    return ns.map((n) => {
      const cloneIdxs = byPull.get(n)!;
      const forcesAbs = cloneIdxs.reduce((s, i) => s + enemies[i].count, 0);
      run += forcesAbs;
      // Dominant sublevel + centroid over the clones on it.
      const subCounts = new Map<number, number>();
      for (const i of cloneIdxs) {
        const s = enemies[i].sublevel;
        subCounts.set(s, (subCounts.get(s) ?? 0) + 1);
      }
      const sublevel = [...subCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const onSub = cloneIdxs.filter((i) => enemies[i].sublevel === sublevel);
      const cx = onSub.reduce((s, i) => s + enemies[i].x, 0) / onSub.length;
      const cy = onSub.reduce((s, i) => s + enemies[i].y, 0) / onSub.length;
      return {
        n,
        color: colors[n] ?? DEFAULT_PULL_COLOR,
        mobs: cloneIdxs.length,
        boss: cloneIdxs.some((i) => enemies[i].is_boss),
        forcesAbs,
        cum: run,
        forces: Math.round((run / totalCount) * 1000) / 10,
        cx,
        cy,
        sublevel,
        cloneIdxs,
      };
    });
  }, [assignment, colors, enemies, totalCount]);

  const enemyCount = useMemo(() => assignment.filter((p) => p !== null).length, [assignment]);
  const coveragePct = pulls.length ? pulls[pulls.length - 1].forces : 0;

  return {
    enemies,
    assignment,
    pulls,
    totalCount,
    coveragePct,
    enemyCount,
    selected,
    setSelected,
    mode,
    toggleMode,
    endMode,
    pick,
    draft,
    onPullClick,
    onCloneClick,
    addToDraft,
    commitDraw,
  };
}
