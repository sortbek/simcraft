import type { ForeverTalent, ForeverTalentTree } from './types';

/** Per tree with points, its ranked talents in the deepest ranked row, left to right. */
export function deepestTalents(trees: ForeverTalentTree[]): ForeverTalent[] {
  return trees.flatMap((tree) => {
    const ranked = tree.talents.filter((t) => t.rank > 0);
    const deepest = Math.max(-1, ...ranked.map((t) => t.row));
    return ranked.filter((t) => t.row === deepest).sort((a, b) => a.col - b.col);
  });
}

/** Points a row asks for in the rows above it. */
const POINTS_PER_ROW = 5;

const pointsAbove = (tree: ForeverTalentTree, row: number) =>
  tree.talents.filter((t) => t.row < row).reduce((sum, t) => sum + t.rank, 0);

const totalPoints = (trees: ForeverTalentTree[]) =>
  trees.reduce((sum, tree) => sum + tree.talents.reduce((s, t) => s + t.rank, 0), 0);

const prereqOf = (tree: ForeverTalentTree, talent: ForeverTalent) =>
  talent.prereq
    ? tree.talents.find((t) => t.row === talent.prereq![0] && t.col === talent.prereq![1])
    : undefined;

/** Every ranked talent has its row's points above it and its prerequisite maxed. */
function treeHolds(tree: ForeverTalentTree): boolean {
  return tree.talents.every((t) => {
    if (t.rank === 0) return true;
    const needs = prereqOf(tree, t);
    return (
      pointsAbove(tree, t.row) >= t.row * POINTS_PER_ROW &&
      (!needs || needs.rank >= needs.max_ranks)
    );
  });
}

function withRank(
  trees: ForeverTalentTree[],
  treeIndex: number,
  talentIndex: number,
  rank: number
): ForeverTalentTree[] {
  return trees.map((tree, t) =>
    t === treeIndex
      ? {
          ...tree,
          talents: tree.talents.map((talent, i) =>
            i === talentIndex ? { ...talent, rank } : talent
          ),
        }
      : tree
  );
}

/** The trees with one more (`step` 1) or one fewer (-1) rank in a talent, or null when the
 *  calculator's rules forbid it. */
export function stepTalent(
  trees: ForeverTalentTree[],
  treeIndex: number,
  talentIndex: number,
  step: 1 | -1,
  maxPoints: number
): ForeverTalentTree[] | null {
  const talent = trees[treeIndex]?.talents[talentIndex];
  if (!talent) return null;
  const rank = talent.rank + step;
  if (rank < 0 || rank > talent.max_ranks) return null;
  if (step === 1 && totalPoints(trees) >= maxPoints) return null;
  const next = withRank(trees, treeIndex, talentIndex, rank);
  return treeHolds(next[treeIndex]) ? next : null;
}

/** The engine's talent string: a digit per talent, trees split by dashes, trailing zeros cut. */
export function talentsString(trees: ForeverTalentTree[]): string {
  return trees
    .map((tree) =>
      tree.talents
        .map((t) => t.rank)
        .join('')
        .replace(/0+$/, '')
    )
    .join('-')
    .replace(/-+$/, '');
}
