/** Pure helpers behind the talent summary: decode a build against its tree,
 *  summarize it, and compare two builds. */

import { decodeHeader, decodeNodes, type NodeSelection } from './talentDecode';
import { getActiveSubTreeId, getPointsSpent } from './talentRules';
import type { TalentEntry, TalentNode, TalentTreeData } from './useTalentTree';

export type Selections = Map<number, NodeSelection>;

/** A build's selections, or null when the string doesn't decode or belongs to
 *  another spec than `tree`. Free entry nodes some exports omit are granted,
 *  including both hero trees' (matching Raidbots). */
export function decodeSelections(talentString: string, tree: TalentTreeData): Selections | null {
  let header: ReturnType<typeof decodeHeader>;
  try {
    header = decodeHeader(talentString);
  } catch {
    return null;
  }
  if (header.specId !== tree.specId || !tree.fullNodeOrder) return null;
  // fullNodeOrder/fullNodeMaxRanks cover every spec of the class; without them
  // bit positions misalign because a node's bit width is unknown.
  const local = [
    ...tree.classNodes,
    ...tree.specNodes,
    ...tree.heroNodes,
    ...(tree.subTreeNodes ?? []),
  ];
  const localMax = new Map(local.map((n) => [n.id, n.maxRanks ?? 1]));
  const maxRanks = new Map(
    tree.fullNodeOrder.map((id) => [id, tree.fullNodeMaxRanks?.[id] ?? localMax.get(id) ?? 1])
  );
  const decoded = decodeNodes(header.bits, header.offset, tree.fullNodeOrder, maxRanks);
  for (const node of [...tree.classNodes, ...tree.specNodes, ...tree.heroNodes]) {
    if (node.freeNode && !decoded.has(node.id)) {
      decoded.set(node.id, { ranks: node.maxRanks, choiceIndex: -1 });
    }
  }
  return decoded;
}

/** The entry a node shows: the picked one on a choice node, else its first. */
export function entryOf(node: TalentNode, selection?: NodeSelection): TalentEntry | undefined {
  const i = selection && selection.choiceIndex >= 0 ? selection.choiceIndex : 0;
  return node.entries[i] ?? node.entries[0];
}

export interface BuildSummary {
  heroSubTreeId: number | null;
  heroName: string | null;
  /** The hero tree's first talent, standing in for its emblem. */
  heroIcon: string | null;
  points: { class: number; spec: number; hero: number };
  /** Choice nodes and spec capstones the build took, for the summary strip. */
  highlights: { node: TalentNode; entry: TalentEntry }[];
}

export function heroNodesOf(tree: TalentTreeData, subTreeId: number | null): TalentNode[] {
  return subTreeId == null ? [] : tree.heroNodes.filter((n) => n.subTreeId === subTreeId);
}

export function summarizeBuild(sel: Selections, tree: TalentTreeData): BuildSummary {
  const heroSubTreeId = getActiveSubTreeId(sel, tree);
  const heroNodes = heroNodesOf(tree, heroSubTreeId);
  const heroEntry = tree.subTreeNodes
    ?.flatMap((st) => st.entries)
    .find((e) => e.traitSubTreeId === heroSubTreeId);
  const heroRoot = heroNodes.find((n) => n.entryNode) ?? heroNodes[0];
  const taken = (n: TalentNode) => sel.has(n.id) && !n.freeNode;
  const choices = [...tree.classNodes, ...tree.specNodes].filter(
    (n) => n.type === 'choice' && n.entries.length > 1 && taken(n)
  );
  const capstones = tree.specNodes.filter((n) => n.next.length === 0 && taken(n));
  const highlights = [...choices, ...capstones.filter((n) => !choices.includes(n))]
    .map((node) => ({ node, entry: entryOf(node, sel.get(node.id)) }))
    .filter((h): h is { node: TalentNode; entry: TalentEntry } => !!h.entry);
  return {
    heroSubTreeId,
    heroName: heroEntry?.name ?? null,
    heroIcon: heroRoot?.entries[0]?.icon ?? null,
    points: {
      class: getPointsSpent(sel, tree.classNodes),
      spec: getPointsSpent(sel, tree.specNodes),
      hero: getPointsSpent(sel, heroNodes),
    },
    highlights,
  };
}

export interface BuildChange {
  node: TalentNode;
  from?: NodeSelection;
  to?: NodeSelection;
}

export interface BuildDiff {
  gained: BuildChange[];
  lost: BuildChange[];
  /** Same node, other rank or choice. */
  changed: BuildChange[];
  /** The other build runs another hero tree; counted as one change. */
  heroSwap: boolean;
  count: number;
}

/** How `other` differs from `base`. A hero-tree switch is one change rather
 *  than every hero talent, and only the hero tree in use is compared. */
export function diffBuilds(base: Selections, other: Selections, tree: TalentTreeData): BuildDiff {
  const baseHero = getActiveSubTreeId(base, tree);
  const otherHero = getActiveSubTreeId(other, tree);
  const heroSwap = baseHero !== otherHero;
  const nodes = [
    ...tree.classNodes,
    ...tree.specNodes,
    ...(heroSwap ? [] : heroNodesOf(tree, otherHero)),
  ];
  const gained: BuildChange[] = [];
  const lost: BuildChange[] = [];
  const changed: BuildChange[] = [];
  for (const node of nodes) {
    const from = base.get(node.id);
    const to = other.get(node.id);
    if (from && to) {
      if (from.ranks !== to.ranks || from.choiceIndex !== to.choiceIndex) {
        changed.push({ node, from, to });
      }
    } else if (to) gained.push({ node, to });
    else if (from) lost.push({ node, from });
  }
  return {
    gained,
    lost,
    changed,
    heroSwap,
    count: gained.length + lost.length + changed.length + (heroSwap ? 1 : 0),
  };
}

/** Per-node status of `other` against `base`, for marking the tree. */
export type NodeChange = 'gained' | 'lost' | 'changed';
export function nodeChanges(diff: BuildDiff): Map<number, NodeChange> {
  const out = new Map<number, NodeChange>();
  for (const c of diff.gained) out.set(c.node.id, 'gained');
  for (const c of diff.lost) out.set(c.node.id, 'lost');
  for (const c of diff.changed) out.set(c.node.id, 'changed');
  return out;
}
