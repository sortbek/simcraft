/**
 * Talent tree rules engine — pure functions for validating and computing talent state.
 */

import type { NodeSelection } from './talentDecode';
import type { TalentNode, TalentTreeData } from './useTalentTree';

export const CLASS_POINTS = 34;
export const SPEC_POINTS = 34;

/** Count points spent (non-free, non-entry nodes only). */
export function getPointsSpent(
  selections: Map<number, NodeSelection>,
  nodes: TalentNode[],
): number {
  let total = 0;
  for (const node of nodes) {
    if (node.freeNode) continue;
    const sel = selections.get(node.id);
    if (sel) total += sel.ranks;
  }
  return total;
}

/** Check if a node can be selected/allocated a point. */
export function canSelectNode(
  nodeId: number,
  selections: Map<number, NodeSelection>,
  tree: TalentTreeData,
  nodeMap: Map<number, TalentNode>,
): boolean {
  const node = nodeMap.get(nodeId);
  if (!node) return false;

  // Already at max ranks
  const sel = selections.get(nodeId);
  if (sel && sel.ranks >= node.maxRanks) return false;

  // Free/entry nodes are always selectable
  if (node.freeNode || node.entryNode) return true;

  // Check point budget
  const section = getSectionNodes(node, tree);
  const budget = getSectionBudget(node, tree);
  if (budget > 0 && getPointsSpent(selections, section) >= budget) return false;

  // Check prev prerequisites — at least one prev node must be selected
  // (WoW uses "any of prev" for unlocking, not "all of prev")
  if (node.prev.length > 0) {
    const anyPrevSelected = node.prev.some((prevId) => selections.has(prevId));
    if (!anyPrevSelected) return false;
  }

  // Check reqPoints threshold
  if (node.reqPoints) {
    const spent = getPointsSpent(selections, section);
    if (spent < node.reqPoints) return false;
  }

  // Check requiresNode
  if (node.requiresNode && !selections.has(node.requiresNode)) return false;

  // Hero node: check subtree is active
  if (node.subTreeId) {
    const activeSubTree = getActiveSubTreeId(selections, tree);
    if (activeSubTree !== node.subTreeId) return false;
  }

  return true;
}

/** Check if a node can be deselected without breaking dependencies. */
export function canDeselectNode(
  nodeId: number,
  selections: Map<number, NodeSelection>,
  tree: TalentTreeData,
  nodeMap: Map<number, TalentNode>,
): boolean {
  const node = nodeMap.get(nodeId);
  if (!node) return false;
  if (!selections.has(node.id)) return false;

  // Free nodes can't be deselected
  if (node.freeNode) return false;

  // Check if any downstream node depends on this one
  for (const nextId of node.next) {
    if (!selections.has(nextId)) continue;
    const nextNode = nodeMap.get(nextId);
    if (!nextNode) continue;
    // Would this be the last selected prev for the next node?
    const otherPrevSelected = nextNode.prev.filter((p) => p !== nodeId && selections.has(p));
    if (otherPrevSelected.length === 0) return false;
  }

  // Check if any node has requiresNode pointing to this one
  const allNodes = [...tree.classNodes, ...tree.specNodes, ...tree.heroNodes];
  for (const n of allNodes) {
    if (n.requiresNode === nodeId && selections.has(n.id)) return false;
  }

  // Check if removing would break reqPoints for any selected node
  const sel = selections.get(nodeId);
  if (sel) {
    const section = getSectionNodes(node, tree);
    const currentSpent = getPointsSpent(selections, section);
    const afterSpent = currentSpent - sel.ranks;
    for (const sn of section) {
      if (sn.id === nodeId) continue;
      if (!selections.has(sn.id)) continue;
      if (sn.reqPoints && afterSpent < sn.reqPoints) return false;
    }
  }

  return true;
}

/** Toggle a node: add rank, increment rank, or deselect. Returns new selections map. */
export function toggleNode(
  nodeId: number,
  selections: Map<number, NodeSelection>,
  tree: TalentTreeData,
  nodeMap: Map<number, TalentNode>,
): Map<number, NodeSelection> {
  const node = nodeMap.get(nodeId);
  if (!node) return selections;

  const next = new Map(selections);
  const sel = next.get(nodeId);

  if (!sel) {
    // Not selected — try to add
    if (!canSelectNode(nodeId, selections, tree, nodeMap)) return selections;

    const isChoice = node.type === 'choice' && node.entries.length > 1;
    next.set(nodeId, {
      ranks: node.freeNode ? node.maxRanks : 1,
      choiceIndex: isChoice ? 0 : -1,
    });
  } else if (sel.ranks < node.maxRanks && !node.freeNode) {
    // Has room for more ranks
    if (!canSelectNode(nodeId, next, tree, nodeMap)) return selections;
    next.set(nodeId, { ...sel, ranks: sel.ranks + 1 });
  } else {
    // At max — deselect
    if (!canDeselectNode(nodeId, selections, tree, nodeMap)) return selections;
    next.delete(nodeId);
  }

  return next;
}

/** Decrement a rank or deselect. Returns new selections map. */
export function decrementNode(
  nodeId: number,
  selections: Map<number, NodeSelection>,
  tree: TalentTreeData,
  nodeMap: Map<number, TalentNode>,
): Map<number, NodeSelection> {
  const node = nodeMap.get(nodeId);
  if (!node) return selections;

  const sel = selections.get(nodeId);
  if (!sel) return selections;
  if (node.freeNode) return selections;

  const next = new Map(selections);

  if (sel.ranks > 1) {
    next.set(nodeId, { ...sel, ranks: sel.ranks - 1 });
  } else {
    if (!canDeselectNode(nodeId, selections, tree, nodeMap)) return selections;
    next.delete(nodeId);
  }

  return next;
}

/** Cycle choice entry for a choice node. */
export function cycleChoice(
  nodeId: number,
  selections: Map<number, NodeSelection>,
  nodeMap: Map<number, TalentNode>,
): Map<number, NodeSelection> {
  const node = nodeMap.get(nodeId);
  if (!node || node.type !== 'choice') return selections;

  const sel = selections.get(nodeId);
  if (!sel) return selections;

  const next = new Map(selections);
  const newIndex = (sel.choiceIndex + 1) % node.entries.length;
  next.set(nodeId, { ...sel, choiceIndex: newIndex });
  return next;
}

// --- Helpers ---

function getSectionNodes(node: TalentNode, tree: TalentTreeData): TalentNode[] {
  if (node.subTreeId) return tree.heroNodes;
  if (tree.specNodes.some((n) => n.id === node.id)) return tree.specNodes;
  return tree.classNodes;
}

function getSectionBudget(node: TalentNode, tree: TalentTreeData): number {
  if (node.subTreeId) return 0; // hero nodes have no strict budget
  if (tree.specNodes.some((n) => n.id === node.id)) return SPEC_POINTS;
  return CLASS_POINTS;
}

function getActiveSubTreeId(
  selections: Map<number, NodeSelection>,
  tree: TalentTreeData,
): number | null {
  if (!tree.subTreeNodes) return null;
  for (const stNode of tree.subTreeNodes) {
    const sel = selections.get(stNode.id);
    if (sel && sel.choiceIndex >= 0 && sel.choiceIndex < stNode.entries.length) {
      return stNode.entries[sel.choiceIndex].traitSubTreeId;
    }
    for (const entry of stNode.entries) {
      if (entry.nodes?.some((nid) => selections.has(nid))) {
        return entry.traitSubTreeId;
      }
    }
  }
  return null;
}

export { getActiveSubTreeId };
