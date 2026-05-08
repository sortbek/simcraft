'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeHeader, decodeNodes } from '../../lib/talentDecode';
import type { NodeSelection } from '../../lib/talentDecode';
import { encodeTalentString } from '../../lib/talentEncode';
import {
  canSelectNode,
  canDeselectNode,
  toggleNode,
  decrementNode,
  cycleChoice,
  getPointsSpent,
  getActiveSubTreeId,
  CLASS_POINTS,
  SPEC_POINTS,
} from '../../lib/talentRules';
import { useTalentTree } from '../../lib/useTalentTree';
import type { TalentNode, TalentTreeData } from '../../lib/useTalentTree';
import { useLanguage } from '../../lib/i18n';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';

interface TalentTreeProps {
  talentString?: string;
  editable?: boolean;
  specId?: number;
  onTalentStringChange?: (s: string) => void;
  /** Render as a tiny inline preview — no card, no labels, no tooltips */
  mini?: boolean;
  /** Skip card wrapper (when rendered inside another card) */
  bare?: boolean;
  /** Force vertical stacking of the 3 trees */
  vertical?: boolean;
}

// Node dimensions in SVG units (posX/posY use ~600 unit spacing)
const NODE_SIZE = 260;
const ICON_SIZE = 210;
const PADDING = 200;

const GOLD = '#f2bf4e';
const DIM = 'rgba(255,255,255,0.15)';
const DIM_ICON = 0.3;
const LOCKED_ICON = 0.15;

export default function TalentTree({
  talentString,
  editable,
  specId: specIdProp,
  onTalentStringChange,
  mini,
  bare,
  vertical,
}: TalentTreeProps) {
  // In edit mode, freeze the initial talent string so prop changes don't re-decode
  const initialTalentRef = useRef(talentString);
  useEffect(() => {
    if (!editable) initialTalentRef.current = talentString;
  }, [editable, talentString]);

  const stableTalentString = editable ? initialTalentRef.current : talentString;

  const header = useMemo(() => {
    if (!stableTalentString) return null;
    try {
      return decodeHeader(stableTalentString);
    } catch {
      return null;
    }
  }, [stableTalentString]);

  const resolvedSpecId = specIdProp ?? header?.specId ?? null;
  const tree = useTalentTree(resolvedSpecId);

  // Decode selections from the (stable) talent string.
  // fullNodeOrder covers ALL nodes across all specs of the class.
  // fullNodeMaxRanks (from the backend) provides maxRanks for every node
  // including nodes from other specs. Without it, bit positions misalign
  // because the decoder can't determine the correct bit width for each node.
  const decodedFromString = useMemo(() => {
    if (!header || !tree) return null;
    const orderedIds = tree.fullNodeOrder;
    if (!orderedIds) return null;

    // Use backend-provided maxRanks (covers all specs), fall back to local nodes
    const localNodes = [
      ...tree.classNodes,
      ...tree.specNodes,
      ...tree.heroNodes,
      ...(tree.subTreeNodes ?? []),
    ];
    const localMap = new Map(localNodes.map((n) => [n.id, n.maxRanks ?? 1]));
    const maxRanks = new Map(
      orderedIds.map((id) => [id, tree.fullNodeMaxRanks?.[id] ?? localMap.get(id) ?? 1])
    );
    const decoded = decodeNodes(header.bits, header.offset, orderedIds, maxRanks);

    // Auto-grant freeNode talents that the game grants implicitly.
    // Some export strings omit free entry nodes — grant ALL of them
    // (including both hero subtree entries, matching Raidbots behavior).
    for (const node of [...tree.classNodes, ...tree.specNodes, ...tree.heroNodes]) {
      if (node.freeNode && !decoded.has(node.id)) {
        decoded.set(node.id, { ranks: node.maxRanks, choiceIndex: -1 });
      }
    }

    return decoded;
  }, [header, tree]);

  // Editable state — initialized from decoded string once
  const [editSelections, setEditSelections] = useState<Map<number, NodeSelection>>(new Map());
  const didInit = useRef(false);

  useEffect(() => {
    if (editable && decodedFromString && !didInit.current) {
      setEditSelections(decodedFromString);
      didInit.current = true;
    }
  }, [editable, decodedFromString]);

  const selections = editable ? editSelections : decodedFromString;

  // Node map for rules engine (includes subTreeNodes for encoding)
  const nodeMap = useMemo(() => {
    if (!tree) return new Map<number, TalentNode>();
    const allNodes: TalentNode[] = [
      ...tree.classNodes,
      ...tree.specNodes,
      ...tree.heroNodes,
      ...((tree.subTreeNodes ?? []) as unknown as TalentNode[]),
    ];
    return new Map(allNodes.map((n) => [n.id, n]));
  }, [tree]);

  // Track a pending emit — encode and notify parent after render, not during
  const pendingEmit = useRef<Map<number, NodeSelection> | null>(null);
  useEffect(() => {
    if (!pendingEmit.current || !tree || !resolvedSpecId || !onTalentStringChange) return;
    const encoded = encodeTalentString(pendingEmit.current, tree, resolvedSpecId, header?.version);
    pendingEmit.current = null;
    onTalentStringChange(encoded);
  });

  const handleNodeClick = useCallback(
    (nodeId: number) => {
      if (!editable || !tree) return;
      setEditSelections((prev) => {
        const next = toggleNode(nodeId, prev, tree, nodeMap);
        if (next !== prev) pendingEmit.current = next;
        return next;
      });
    },
    [editable, tree, nodeMap]
  );

  const handleNodeRightClick = useCallback(
    (nodeId: number) => {
      if (!editable || !tree) return;
      setEditSelections((prev) => {
        const next = decrementNode(nodeId, prev, tree, nodeMap);
        if (next !== prev) pendingEmit.current = next;
        return next;
      });
    },
    [editable, tree, nodeMap]
  );

  const handleChoiceCycle = useCallback(
    (nodeId: number) => {
      if (!editable) return;
      setEditSelections((prev) => {
        const next = cycleChoice(nodeId, prev, nodeMap);
        if (next !== prev) pendingEmit.current = next;
        return next;
      });
    },
    [editable, nodeMap]
  );

  const { t, locale } = useLanguage();

  useWowheadTooltips([selections]);

  if (!tree || !selections) {
    if (!talentString && !specIdProp) return null;
    if (mini) return null;
    return (
      <div className="card flex items-center justify-center p-5">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-800 border-t-gold" />
      </div>
    );
  }

  const selectedSubTreeId = getActiveSubTreeId(selections, tree);

  const activeHeroNodes = selectedSubTreeId
    ? tree.heroNodes.filter((n) => n.subTreeId === selectedSubTreeId)
    : [];

  const selectedSubTree = tree.subTreeNodes
    ?.flatMap((st) => st.entries)
    .find((e) => e.traitSubTreeId === selectedSubTreeId);

  const classSpent = getPointsSpent(selections, tree.classNodes);
  const specSpent = getPointsSpent(selections, tree.specNodes);
  const heroSpent = getPointsSpent(selections, activeHeroNodes);

  const allNodesArr = [...tree.classNodes, ...tree.specNodes, ...tree.heroNodes];

  if (mini) {
    return (
      <div className="flex h-full w-full items-stretch gap-0.5">
        <div className="min-w-0 flex-[2]">
          <MiniTreeSvg nodes={tree.classNodes} selections={selections} allNodes={allNodesArr} />
        </div>
        {activeHeroNodes.length > 0 && (
          <div className="h-[45%] min-w-0 flex-1 self-center">
            <MiniTreeSvg nodes={activeHeroNodes} selections={selections} allNodes={allNodesArr} />
          </div>
        )}
        <div className="min-w-0 flex-[2]">
          <MiniTreeSvg nodes={tree.specNodes} selections={selections} allNodes={allNodesArr} />
        </div>
      </div>
    );
  }

  return (
    <div className={bare ? 'space-y-3' : 'card space-y-3 p-4'}>
      {!bare && (
        <p className="text-xs font-medium uppercase tracking-widest text-on-surface-variant/60">
          {t('config.talents')}
        </p>
      )}
      <div className={`flex flex-col gap-3 ${vertical ? '' : 'lg:flex-row lg:gap-4'}`}>
        <TreeSection
          label={tree.className}
          nodes={tree.classNodes}
          selections={selections}
          allNodes={[...tree.classNodes, ...tree.specNodes, ...tree.heroNodes]}
          editable={editable}
          tree={tree}
          nodeMap={nodeMap}
          onNodeClick={handleNodeClick}
          onNodeRightClick={handleNodeRightClick}
          onChoiceCycle={handleChoiceCycle}
          pointsDisplay={`${classSpent}/${CLASS_POINTS}`}
        />
        <div className="hidden h-auto w-px bg-outline-variant/10 lg:block" />
        <TreeSection
          label={tree.specName}
          nodes={tree.specNodes}
          selections={selections}
          allNodes={[...tree.classNodes, ...tree.specNodes, ...tree.heroNodes]}
          editable={editable}
          tree={tree}
          nodeMap={nodeMap}
          onNodeClick={handleNodeClick}
          onNodeRightClick={handleNodeRightClick}
          onChoiceCycle={handleChoiceCycle}
          pointsDisplay={`${specSpent}/${SPEC_POINTS}`}
        />
        {activeHeroNodes.length > 0 && (
          <>
            <div className="hidden h-auto w-px bg-outline-variant/10 lg:block" />
            <TreeSection
              label={selectedSubTree?.name ?? 'Hero'}
              nodes={activeHeroNodes}
              selections={selections}
              allNodes={[...tree.classNodes, ...tree.specNodes, ...tree.heroNodes]}
              editable={editable}
              tree={tree}
              nodeMap={nodeMap}
              onNodeClick={handleNodeClick}
              onNodeRightClick={handleNodeRightClick}
              onChoiceCycle={handleChoiceCycle}
              pointsDisplay={`${heroSpent}`}
              compact
            />
          </>
        )}
      </div>
    </div>
  );
}

interface TreeSectionProps {
  label: string;
  nodes: TalentNode[];
  selections: Map<number, NodeSelection>;
  allNodes: TalentNode[];
  compact?: boolean;
  editable?: boolean;
  tree?: TalentTreeData;
  nodeMap?: Map<number, TalentNode>;
  onNodeClick?: (nodeId: number) => void;
  onNodeRightClick?: (nodeId: number) => void;
  onChoiceCycle?: (nodeId: number) => void;
  pointsDisplay?: string;
}

function TreeSection({
  label,
  nodes,
  selections,
  allNodes,
  compact,
  editable,
  tree,
  nodeMap,
  onNodeClick,
  onNodeRightClick,
  onChoiceCycle,
  pointsDisplay,
}: TreeSectionProps) {
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

  const sectionNodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  return (
    <div className={compact ? 'w-[180px] shrink-0' : 'min-w-0 flex-1'}>
      <div className="mb-1 flex items-center justify-center gap-2">
        <p className="text-center text-[12px] font-medium uppercase tracking-wider text-on-surface-variant/60">
          {label}
        </p>
        {pointsDisplay && (
          <span className="rounded bg-surface-container-high px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-on-surface-variant/60">
            {pointsDisplay}
          </span>
        )}
      </div>
      <svg
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        className={`w-full ${compact ? 'max-h-[320px]' : 'max-h-[420px]'}`}
        preserveAspectRatio="xMidYMid meet"
        onContextMenu={editable ? (e) => e.preventDefault() : undefined}
      >
        {/* Connections */}
        {nodes.map((node) =>
          node.next
            .filter((targetId) => sectionNodeIds.has(targetId))
            .map((targetId) => {
              const target = nodeById.get(targetId);
              if (!target) return null;
              const sourceSelected = selections.has(node.id);
              const targetSelected = selections.has(targetId);
              const active = sourceSelected && targetSelected;
              return (
                <line
                  key={`${node.id}-${targetId}`}
                  x1={node.posX}
                  y1={node.posY}
                  x2={target.posX}
                  y2={target.posY}
                  stroke={active ? GOLD : DIM}
                  strokeWidth={active ? 16 : 10}
                  strokeLinecap="round"
                />
              );
            })
        )}
        {/* Nodes */}
        {nodes.map((node) => {
          const sel = selections.get(node.id);
          const selectable =
            editable && tree && nodeMap ? canSelectNode(node.id, selections, tree, nodeMap) : false;
          const deselectable =
            editable && tree && nodeMap
              ? canDeselectNode(node.id, selections, tree, nodeMap)
              : false;

          return (
            <TalentNodeSvg
              key={node.id}
              node={node}
              selection={sel}
              editable={editable}
              selectable={selectable}
              deselectable={deselectable}
              onClick={onNodeClick}
              onRightClick={onNodeRightClick}
              onChoiceCycle={onChoiceCycle}
            />
          );
        })}
      </svg>
    </div>
  );
}

function TalentNodeSvg({
  node,
  selection,
  editable,
  selectable,
  deselectable,
  onClick,
  onRightClick,
  onChoiceCycle,
}: {
  node: TalentNode;
  selection?: NodeSelection;
  editable?: boolean;
  selectable?: boolean;
  deselectable?: boolean;
  onClick?: (nodeId: number) => void;
  onRightClick?: (nodeId: number) => void;
  onChoiceCycle?: (nodeId: number) => void;
}) {
  const { locale } = useLanguage();
  const isSelected = !!selection;
  const isChoice = node.type === 'choice' && node.entries.length > 1;
  const isInteractable = editable && (selectable || isSelected);

  // For choice nodes, pick the selected entry; otherwise use first
  let entry = node.entries[0];
  if (
    isChoice &&
    selection &&
    selection.choiceIndex >= 0 &&
    selection.choiceIndex < node.entries.length
  ) {
    entry = node.entries[selection.choiceIndex];
  }

  const icon = entry?.icon;
  const spellId = entry?.spellId;
  const isActive = entry?.type === 'active';
  const half = NODE_SIZE / 2;
  const iconHalf = ICON_SIZE / 2;

  const borderColor = isSelected
    ? GOLD
    : editable && selectable
      ? 'rgba(200,153,42,0.4)'
      : 'rgba(255,255,255,0.1)';
  const borderWidth = isSelected ? 12 : 6;

  const opacity = isSelected ? 1 : editable ? (selectable ? 0.5 : LOCKED_ICON) : DIM_ICON;

  const handleClick = () => {
    if (!editable) return;
    if (isChoice && isSelected) {
      onChoiceCycle?.(node.id);
    } else {
      onClick?.(node.id);
    }
  };

  const handleRightClick = (e: React.MouseEvent) => {
    if (!editable) return;
    e.preventDefault();
    onRightClick?.(node.id);
  };

  return (
    <g
      opacity={opacity}
      className={isInteractable ? 'cursor-pointer' : ''}
      onClick={editable ? handleClick : undefined}
      onContextMenu={editable ? handleRightClick : undefined}
    >
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
            x={node.posX + half - 90}
            y={node.posY + half - 75}
            width={110}
            height={70}
            rx={16}
            fill="#0a0a0a"
            stroke={borderColor}
            strokeWidth={6}
          />
          <text
            x={node.posX + half - 35}
            y={node.posY + half - 28}
            textAnchor="middle"
            fill={selection.ranks >= node.maxRanks ? GOLD : '#999'}
            fontSize={46}
            fontFamily="system-ui, sans-serif"
            fontWeight="bold"
          >
            {selection.ranks}/{node.maxRanks}
          </text>
        </g>
      )}
      {/* Tooltip hit area (non-editable mode only) */}
      {!editable && spellId && (
        <foreignObject
          x={node.posX - half}
          y={node.posY - half}
          width={NODE_SIZE}
          height={NODE_SIZE}
        >
          <a
            href={`https://${locale === 'en_US' || !locale ? 'www' : locale.split('_')[0]}.wowhead.com/spell=${spellId}`}
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

function MiniTreeSvg({
  nodes,
  selections,
  allNodes,
}: {
  nodes: TalentNode[];
  selections: Map<number, NodeSelection>;
  allNodes: TalentNode[];
}) {
  const nodeById = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);
  const sectionIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  if (nodes.length === 0) return null;

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
  const pad = 300;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;

  return (
    <svg
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {nodes.map((node) =>
        node.next
          .filter((tid) => sectionIds.has(tid))
          .map((tid) => {
            const target = nodeById.get(tid);
            if (!target) return null;
            const active = selections.has(node.id) && selections.has(tid);
            return (
              <line
                key={`${node.id}-${tid}`}
                x1={node.posX}
                y1={node.posY}
                x2={target.posX}
                y2={target.posY}
                stroke={active ? GOLD : 'rgba(255,255,255,0.08)'}
                strokeWidth={active ? 40 : 24}
                strokeLinecap="round"
              />
            );
          })
      )}
      {nodes.map((node) => {
        const selected = selections.has(node.id);
        const sel = selections.get(node.id);
        const isChoice = node.type === 'choice' && node.entries.length > 1;
        let entry = node.entries[0];
        if (isChoice && sel && sel.choiceIndex >= 0 && sel.choiceIndex < node.entries.length) {
          entry = node.entries[sel.choiceIndex];
        }
        const icon = entry?.icon;
        const r = 140;
        return (
          <g key={node.id} opacity={selected ? 1 : 0.25}>
            <clipPath id={`mini-clip-${node.id}`}>
              <circle cx={node.posX} cy={node.posY} r={r} />
            </clipPath>
            {icon ? (
              <image
                href={`https://render.worldofwarcraft.com/icons/56/${icon}.jpg`}
                x={node.posX - r}
                y={node.posY - r}
                width={r * 2}
                height={r * 2}
                clipPath={`url(#mini-clip-${node.id})`}
              />
            ) : (
              <circle cx={node.posX} cy={node.posY} r={r} fill="rgba(255,255,255,0.08)" />
            )}
            {selected && (
              <circle
                cx={node.posX}
                cy={node.posY}
                r={r}
                fill="none"
                stroke={GOLD}
                strokeWidth={20}
              />
            )}
          </g>
        );
      })}
    </svg>
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
  const points = Array.from({ length: 8 }, (_, i) => {
    const angle = Math.PI / 8 + (i * Math.PI) / 4;
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
