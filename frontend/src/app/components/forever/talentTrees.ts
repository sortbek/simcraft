import type { ForeverTalent, ForeverTalentTree } from './types';

/** Per tree with points, its ranked talents in the deepest ranked row, left to right. */
export function deepestTalents(trees: ForeverTalentTree[]): ForeverTalent[] {
  return trees.flatMap((tree) => {
    const ranked = tree.talents.filter((t) => t.rank > 0);
    const deepest = Math.max(-1, ...ranked.map((t) => t.row));
    return ranked.filter((t) => t.row === deepest).sort((a, b) => a.col - b.col);
  });
}
