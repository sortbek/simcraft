/**
 * Decode WoW talent export strings (base64 bit-packed). Format reference:
 * Blizzard_ClassTalentImportExport.lua. Base64 A-Za-z0-9+/, 6 bits/char, LSB-first.
 * Header: version(8) + specId(16) + treeHash(128). Then per node (sorted by ascending id):
 * isSelected(1); if selected isPurchased(1); if purchased isPartiallyRanked(1)->ranks(6),
 * isChoiceNode(1)->choiceEntryIndex(2).
 */

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BITS_PER_CHAR = 6;

export interface NodeSelection {
  ranks: number;
  /** 0-indexed choice entry index, or -1 if not a choice node */
  choiceIndex: number;
}

export interface DecodedHeader {
  version: number;
  specId: number;
}

/** Convert a base64 talent string into an array of bits (LSB-first per character). */
function toBits(exportString: string): boolean[] {
  const bits: boolean[] = [];
  for (const ch of exportString) {
    const val = BASE64.indexOf(ch);
    if (val < 0) continue; // skip padding or invalid chars
    for (let bit = 0; bit < BITS_PER_CHAR; bit++) {
      bits.push(((val >> bit) & 1) === 1);
    }
  }
  return bits;
}

/** Read `width` bits from position `pos` (LSB-first), return value and new position. */
function readBits(bits: boolean[], pos: number, width: number): [number, number] {
  let value = 0;
  for (let i = 0; i < width; i++) {
    if (pos + i < bits.length && bits[pos + i]) {
      value |= 1 << i;
    }
  }
  return [value, pos + width];
}

/** Decode the header of a talent export string. Returns specId and the bit offset to start reading nodes. */
export function decodeHeader(
  talentString: string
): DecodedHeader & { bits: boolean[]; offset: number } {
  const bits = toBits(talentString);
  let pos = 0;

  let version: number;
  [version, pos] = readBits(bits, pos, 8);

  let specId: number;
  [specId, pos] = readBits(bits, pos, 16);

  pos += 128; // skip 128-bit tree hash

  return { version, specId, bits, offset: pos };
}

/**
 * Decode per-node selections from the bit stream.
 * @param bits - full bit array from decodeHeader
 * @param offset - bit position after the header
 * @param sortedNodeIds - all node IDs sorted ascending (class + spec + hero)
 * @param nodeMaxRanks - nodeId -> maxRanks
 * @returns nodeId -> NodeSelection (selected nodes only)
 */
export function decodeNodes(
  bits: boolean[],
  offset: number,
  sortedNodeIds: number[],
  nodeMaxRanks: Map<number, number>
): Map<number, NodeSelection> {
  const selections = new Map<number, NodeSelection>();
  let pos = offset;

  for (const nodeId of sortedNodeIds) {
    if (pos >= bits.length) break;

    let isSelected: number;
    [isSelected, pos] = readBits(bits, pos, 1);
    if (!isSelected) continue;

    let isPurchased: number;
    [isPurchased, pos] = readBits(bits, pos, 1);
    if (!isPurchased) {
      // selected but not purchased = granted/free node
      selections.set(nodeId, { ranks: nodeMaxRanks.get(nodeId) ?? 1, choiceIndex: -1 });
      continue;
    }

    let ranks = nodeMaxRanks.get(nodeId) ?? 1;

    let isPartiallyRanked: number;
    [isPartiallyRanked, pos] = readBits(bits, pos, 1);
    if (isPartiallyRanked) {
      [ranks, pos] = readBits(bits, pos, 6);
    }

    let choiceIndex = -1;
    let isChoiceNode: number;
    [isChoiceNode, pos] = readBits(bits, pos, 1);
    if (isChoiceNode) {
      [choiceIndex, pos] = readBits(bits, pos, 2);
    }

    selections.set(nodeId, { ranks, choiceIndex });
  }

  return selections;
}
