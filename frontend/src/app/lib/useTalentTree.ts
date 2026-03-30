import { useEffect, useState } from 'react';
import { API_URL } from './api';

export interface TalentEntry {
  id: number;
  definitionId: number;
  maxRanks: number;
  type: 'active' | 'passive' | 'subtree';
  name: string;
  spellId?: number;
  icon?: string;
  index: number;
  traitSubTreeId?: number;
  nodes?: number[];
}

export interface TalentNode {
  id: number;
  name: string;
  type: 'single' | 'choice' | 'subtree';
  posX: number;
  posY: number;
  maxRanks: number;
  entryNode?: boolean;
  freeNode?: boolean;
  reqPoints?: number;
  subTreeId?: number;
  requiresNode?: number;
  next: number[];
  prev: number[];
  entries: TalentEntry[];
}

export interface SubTreeNode {
  id: number;
  name: string;
  type: 'subtree';
  posX: number;
  posY: number;
  maxRanks: number;
  entryNode?: boolean;
  freeNode?: boolean;
  next: number[];
  prev: number[];
  entries: SubTreeEntry[];
}

export interface SubTreeEntry {
  id: number;
  type: 'subtree';
  name: string;
  traitSubTreeId: number;
  traitTreeId: number;
  atlasMemberName?: string;
  nodes: number[];
}

export interface TalentTreeData {
  traitTreeId: number;
  className: string;
  classId: number;
  specName: string;
  specId: number;
  classNodes: TalentNode[];
  specNodes: TalentNode[];
  heroNodes: TalentNode[];
  subTreeNodes: SubTreeNode[];
  fullNodeOrder: number[];
  /** maxRanks for every node in fullNodeOrder (across all specs of the class). */
  fullNodeMaxRanks: Record<string, number>;
}

// Module-level cache (same pattern as useItemInfo)
const cache: Record<number, TalentTreeData> = {};

export function useTalentTree(specId: number | null): TalentTreeData | null {
  const [tree, setTree] = useState<TalentTreeData | null>(
    specId != null ? cache[specId] ?? null : null,
  );

  useEffect(() => {
    if (specId == null) return;
    if (cache[specId] && cache[specId].fullNodeMaxRanks) {
      setTree(cache[specId]);
      return;
    }

    let cancelled = false;
    fetch(`${API_URL}/api/talent-tree/${specId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: TalentTreeData) => {
        cache[specId] = data;
        if (!cancelled) setTree(data);
      })
      .catch(() => {
        // ignore fetch errors
      });

    return () => {
      cancelled = true;
    };
  }, [specId]);

  return tree;
}
