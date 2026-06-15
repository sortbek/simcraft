/** Encode talent selections into a WoW talent export string (base64 bit-packed).
 *  Reverse of talentDecode.ts. */

import { decodeHeader, decodeNodes } from './talentDecode';
import type { NodeSelection } from './talentDecode';
import type { TalentNode, TalentTreeData } from './useTalentTree';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BITS_PER_CHAR = 6;

class BitWriter {
  private bits: boolean[] = [];

  write(value: number, width: number) {
    for (let i = 0; i < width; i++) {
      this.bits.push(((value >> i) & 1) === 1);
    }
  }

  toBase64(): string {
    while (this.bits.length % BITS_PER_CHAR !== 0) {
      this.bits.push(false);
    }

    let result = '';
    for (let i = 0; i < this.bits.length; i += BITS_PER_CHAR) {
      let val = 0;
      for (let bit = 0; bit < BITS_PER_CHAR; bit++) {
        if (this.bits[i + bit]) {
          val |= 1 << bit;
        }
      }
      result += BASE64[val];
    }
    return result;
  }
}

/**
 * Encode talent selections into a talent export string.
 * @param selections - nodeId -> NodeSelection (from editor state)
 * @param tree - talent tree data (fullNodeOrder + node metadata)
 * @param specId - spec ID encoded in the header
 * @param version - serialization version from the original string header
 */
export function encodeTalentString(
  selections: Map<number, NodeSelection>,
  tree: TalentTreeData,
  specId: number,
  version = 2
): string {
  const allNodes = [...tree.classNodes, ...tree.specNodes, ...tree.heroNodes];
  const nodeMap = new Map<number, TalentNode>(allNodes.map((n) => [n.id, n]));
  const orderedIds = tree.fullNodeOrder ?? [...nodeMap.keys()].sort((a, b) => a - b);

  const writer = new BitWriter();

  // Header: version, specId, then 128-bit tree hash (all zeros — skipped on import when zero)
  writer.write(version, 8);
  writer.write(specId, 16);
  for (let i = 0; i < 16; i++) {
    writer.write(0, 8);
  }

  for (const nodeId of orderedIds) {
    const sel = selections.get(nodeId);
    const node = nodeMap.get(nodeId);

    if (!sel || !node) {
      writer.write(0, 1); // isSelected = false
      continue;
    }

    writer.write(1, 1); // isSelected

    // freeNode is auto-granted (no point cost) so isPurchased=0; an entryNode alone
    // just means "no prerequisites" but still costs a point.
    if (node.freeNode) {
      writer.write(0, 1); // isPurchased = false (granted/free)
      continue;
    }

    writer.write(1, 1); // isPurchased

    const isPartial = sel.ranks < node.maxRanks;
    writer.write(isPartial ? 1 : 0, 1);
    if (isPartial) {
      writer.write(sel.ranks, 6);
    }

    // both 'choice' and 'subtree' types have multiple entries
    const isChoice = (node.type === 'choice' || node.type === 'subtree') && node.entries.length > 1;
    writer.write(isChoice ? 1 : 0, 1);
    if (isChoice) {
      writer.write(Math.max(0, sel.choiceIndex), 2);
    }
  }

  return writer.toBase64();
}

/**
 * Decode, auto-grant implicitly-granted free nodes, and re-encode.
 * WoW export strings may omit freeNode talents (auto-granted when their subtree
 * is selected), but SimC requires them present.
 */
export function normalizeTalentString(talentString: string, tree: TalentTreeData): string {
  const header = decodeHeader(talentString);
  const orderedIds = tree.fullNodeOrder;
  if (!orderedIds) return talentString;

  const allNodes = [
    ...tree.classNodes,
    ...tree.specNodes,
    ...tree.heroNodes,
    ...(tree.subTreeNodes ?? []),
  ];
  const localMap = new Map(allNodes.map((n) => [n.id, n.maxRanks ?? 1]));
  const maxRanks = new Map(
    orderedIds.map((id) => [id, tree.fullNodeMaxRanks?.[id] ?? localMap.get(id) ?? 1])
  );

  const decoded = decodeNodes(header.bits, header.offset, orderedIds, maxRanks);

  // Auto-grant freeNode talents. SimC expects ALL free nodes present — including
  // hero entry nodes for BOTH subtrees, not just the active one.
  let changed = false;
  for (const node of [...tree.classNodes, ...tree.specNodes, ...tree.heroNodes]) {
    if (node.freeNode && !decoded.has(node.id)) {
      decoded.set(node.id, { ranks: node.maxRanks, choiceIndex: -1 });
      changed = true;
    }
  }

  // Fix subtree selector nodes: WoW's export may omit them (isSelected=0) or encode
  // them without the choice bit. Infer the correct choiceIndex from selected hero nodes.
  for (const stNode of tree.subTreeNodes ?? []) {
    const sel = decoded.get(stNode.id);
    if (sel && sel.choiceIndex >= 0) continue; // already correct
    for (let i = 0; i < stNode.entries.length; i++) {
      const entry = stNode.entries[i];
      if (entry.nodes?.some((nid: number) => decoded.has(nid))) {
        decoded.set(stNode.id, { ranks: 1, choiceIndex: i });
        changed = true;
        break;
      }
    }
  }

  if (!changed) return talentString;
  return encodeTalentString(decoded, tree, header.specId, header.version);
}
