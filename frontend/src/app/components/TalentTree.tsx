'use client';

import { useMemo } from 'react';
import { decodeHeader, decodeNodes } from '../lib/talentDecode';
import type { NodeSelection } from '../lib/talentDecode';
import { useTalentTree } from '../lib/useTalentTree';
import type { TalentNode, TalentTreeData } from '../lib/useTalentTree';
import { useWowheadTooltips } from '../lib/useWowheadTooltips';

interface TalentTreeProps {
  talentString: string;
}

// Node dimensions in SVG units (posX/posY use ~600 unit spacing)
const NODE_SIZE = 340;
const ICON_SIZE = 280;
const PADDING = 300;

const GOLD = '#C8992A';
const DIM = 'rgba(255,255,255,0.15)';
const DIM_ICON = 0.3;

export default function TalentTree({ talentString }: TalentTreeProps) {
  const header = useMemo(() => {
    try {
      return decodeHeader(talentString);
    } catch {
      return null;
    }
  }, [talentString]);

  const tree = useTalentTree(header?.specId ?? null);

  const decoded = useMemo(() => {
    if (!header || !tree) return null;
    const allNodes = [...tree.classNodes, ...tree.specNodes, ...tree.heroNodes];
    const nodeMap = new Map(allNodes.map((n) => [n.id, n]));

    // Use fullNodeOrder from the data (matches Blizzard's bitstream order)
    const orderedIds = tree.fullNodeOrder ?? [...nodeMap.keys()].sort((a, b) => a - b);
    const maxRanks = new Map(orderedIds.map((id) => [id, nodeMap.get(id)?.maxRanks ?? 1]));

    return decodeNodes(header.bits, header.offset, orderedIds, maxRanks);
  }, [header, tree]);

  useWowheadTooltips([decoded]);

  if (!tree || !decoded) {
    if (!talentString) return null;
    return (
      <div className="card flex items-center justify-center p-5">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-800 border-t-gold" />
      </div>
    );
  }

  // Determine which hero subtree is selected
  const selectedSubTreeId = getSelectedSubTreeId(tree, decoded);

  // Filter hero nodes to the selected subtree
  const activeHeroNodes = selectedSubTreeId
    ? tree.heroNodes.filter((n) => n.subTreeId === selectedSubTreeId)
    : [];

  const selectedSubTree = tree.subTreeNodes
    ?.flatMap((st) => st.entries)
    .find((e) => e.traitSubTreeId === selectedSubTreeId);

  return (
    <div className="card space-y-4 p-5">
      <p className="text-xs font-medium uppercase tracking-widest text-muted">Talents</p>
      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <TreeSection
          label={tree.className}
          nodes={tree.classNodes}
          decoded={decoded}
          allNodes={[...tree.classNodes, ...tree.specNodes, ...tree.heroNodes]}
        />
        <div className="hidden h-auto w-px bg-border lg:block" />
        <TreeSection
          label={tree.specName}
          nodes={tree.specNodes}
          decoded={decoded}
          allNodes={[...tree.classNodes, ...tree.specNodes, ...tree.heroNodes]}
        />
        {activeHeroNodes.length > 0 && (
          <>
            <div className="hidden h-auto w-px bg-border lg:block" />
            <TreeSection
              label={selectedSubTree?.name ?? 'Hero'}
              nodes={activeHeroNodes}
              decoded={decoded}
              allNodes={[...tree.classNodes, ...tree.specNodes, ...tree.heroNodes]}
            />
          </>
        )}
      </div>
    </div>
  );
}

function getSelectedSubTreeId(
  tree: TalentTreeData,
  decoded: Map<number, NodeSelection>,
): number | null {
  if (!tree.subTreeNodes) return null;
  for (const stNode of tree.subTreeNodes) {
    const sel = decoded.get(stNode.id);
    if (sel && sel.choiceIndex >= 0 && sel.choiceIndex < stNode.entries.length) {
      return stNode.entries[sel.choiceIndex].traitSubTreeId;
    }
    // Also check if any entry's nodes are selected
    for (const entry of stNode.entries) {
      if (entry.nodes?.some((nid) => decoded.has(nid))) {
        return entry.traitSubTreeId;
      }
    }
  }
  return null;
}

interface TreeSectionProps {
  label: string;
  nodes: TalentNode[];
  decoded: Map<number, NodeSelection>;
  allNodes: TalentNode[];
}

function TreeSection({ label, nodes, decoded, allNodes }: TreeSectionProps) {
  const nodeById = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);

  const bounds = useMemo(() => {
    if (nodes.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.posX);
      maxX = Math.max(maxX, n.posX);
      minY = Math.min(minY, n.posY);
      maxY = Math.max(maxY, n.posY);
    }
    return { minX, maxX, minY, maxY };
  }, [nodes]);

  const vbX = bounds.minX - PADDING;
  const vbY = bounds.minY - PADDING;
  const vbW = bounds.maxX - bounds.minX + PADDING * 2;
  const vbH = bounds.maxY - bounds.minY + PADDING * 2;

  // Build connections: only draw lines within this section's nodes
  const sectionNodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  return (
    <div className="min-w-0 flex-1">
      <p className="mb-2 text-center text-[10px] font-medium uppercase tracking-wider text-muted">
        {label}
      </p>
      <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Connections */}
        {nodes.map((node) =>
          node.next
            .filter((targetId) => sectionNodeIds.has(targetId))
            .map((targetId) => {
              const target = nodeById.get(targetId);
              if (!target) return null;
              const sourceSelected = decoded.has(node.id);
              const targetSelected = decoded.has(targetId);
              const active = sourceSelected && targetSelected;
              return (
                <line
                  key={`${node.id}-${targetId}`}
                  x1={node.posX}
                  y1={node.posY}
                  x2={target.posX}
                  y2={target.posY}
                  stroke={active ? GOLD : DIM}
                  strokeWidth={active ? 24 : 16}
                  strokeLinecap="round"
                />
              );
            }),
        )}
        {/* Nodes */}
        {nodes.map((node) => (
          <TalentNodeSvg key={node.id} node={node} selection={decoded.get(node.id)} />
        ))}
      </svg>
    </div>
  );
}

function TalentNodeSvg({
  node,
  selection,
}: {
  node: TalentNode;
  selection?: NodeSelection;
}) {
  const isSelected = !!selection;
  const isChoice = node.type === 'choice' && node.entries.length > 1;

  // For choice nodes, pick the selected entry; otherwise use first
  let entry = node.entries[0];
  if (isChoice && selection && selection.choiceIndex >= 0 && selection.choiceIndex < node.entries.length) {
    entry = node.entries[selection.choiceIndex];
  }

  const icon = entry?.icon;
  const spellId = entry?.spellId;
  const isActive = entry?.type === 'active';
  const half = NODE_SIZE / 2;
  const iconHalf = ICON_SIZE / 2;

  // Use octagon for choice nodes, rounded rect for single
  const borderColor = isSelected ? GOLD : 'rgba(255,255,255,0.1)';
  const borderWidth = isSelected ? 16 : 8;

  return (
    <g opacity={isSelected ? 1 : DIM_ICON} className="cursor-pointer">
        {isChoice ? (
          <OctagonShape
            cx={node.posX}
            cy={node.posY}
            size={half}
            fill="#0a0a0a"
            stroke={borderColor}
            strokeWidth={borderWidth}
          />
        ) : (
          <rect
            x={node.posX - half}
            y={node.posY - half}
            width={NODE_SIZE}
            height={NODE_SIZE}
            rx={isActive ? 8 : half}
            fill="#0a0a0a"
            stroke={borderColor}
            strokeWidth={borderWidth}
          />
        )}
        {/* Clip icon to shape */}
        <clipPath id={`clip-${node.id}`}>
          {isChoice ? (
            <OctagonShape cx={node.posX} cy={node.posY} size={iconHalf} />
          ) : (
            <rect
              x={node.posX - iconHalf}
              y={node.posY - iconHalf}
              width={ICON_SIZE}
              height={ICON_SIZE}
              rx={isActive ? 4 : iconHalf}
            />
          )}
        </clipPath>
        {icon && (
          <image
            href={`https://render.worldofwarcraft.com/icons/56/${icon}.jpg`}
            x={node.posX - iconHalf}
            y={node.posY - iconHalf}
            width={ICON_SIZE}
            height={ICON_SIZE}
            clipPath={`url(#clip-${node.id})`}
          />
        )}
        {/* Rank badge for multi-rank nodes */}
        {node.maxRanks > 1 && isSelected && selection && (
          <g>
            <rect
              x={node.posX + half - 120}
              y={node.posY + half - 100}
              width={140}
              height={90}
              rx={20}
              fill="#0a0a0a"
              stroke={borderColor}
              strokeWidth={8}
            />
            <text
              x={node.posX + half - 50}
              y={node.posY + half - 40}
              textAnchor="middle"
              fill={selection.ranks >= node.maxRanks ? GOLD : '#999'}
              fontSize={60}
              fontFamily="system-ui, sans-serif"
              fontWeight="bold"
            >
              {selection.ranks}/{node.maxRanks}
            </text>
          </g>
        )}
        {/* Invisible hit area with Wowhead tooltip */}
        {spellId && (
          <foreignObject
            x={node.posX - half}
            y={node.posY - half}
            width={NODE_SIZE}
            height={NODE_SIZE}
          >
            <a
              href={`https://www.wowhead.com/spell=${spellId}`}
              data-wowhead={`spell=${spellId}`}
              style={{ display: 'block', width: '100%', height: '100%' }}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.preventDefault()}
            />
          </foreignObject>
        )}
    </g>
  );
}

function OctagonShape({
  cx,
  cy,
  size,
  fill,
  stroke,
  strokeWidth,
}: {
  cx: number;
  cy: number;
  size: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}) {
  // Regular octagon
  const points = Array.from({ length: 8 }, (_, i) => {
    const angle = (Math.PI / 8) + (i * Math.PI) / 4;
    return `${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`;
  }).join(' ');

  return (
    <polygon
      points={points}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
    />
  );
}
