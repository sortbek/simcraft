'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeHeader } from '../../lib/talentDecode';
import type { NodeSelection } from '../../lib/talentDecode';
import {
  decodeSelections,
  diffBuilds,
  nodeChanges,
  type NodeChange,
} from '../../lib/talentSummary';
import { encodeTalentString } from '../../lib/talentEncode';
import { line } from '../../lib/themeColors';
import {
  canSelectNode,
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
import { iconHrefProps } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import Pill from '../ui/Pill';

interface TalentTreeProps {
  talentString?: string;
  editable?: boolean;
  specId?: number;
  onTalentStringChange?: (s: string) => void;
  /** Force vertical stacking of the 3 trees */
  vertical?: boolean;
  /** Mark talents gained, dropped or changed against this build (same spec). */
  baseTalentString?: string;
}

// Node dimensions in SVG units (posX/posY use ~600 unit spacing)
const NODE_SIZE = 360;
const ICON_SIZE = 300;
const PADDING = 230;
// Trees draw at a fixed scale, sized to their content: 600 units (one grid
// step) = 42px.
const SCALE = 42 / 600;

// SVG colors follow the active theme (globals.css `--c-*`)
const GOLD = 'rgb(var(--c-primary))';
const GOLD_EDGE = 'rgb(var(--c-primary-container) / 0.4)';
const NODE_FILL = 'rgb(var(--c-background))';
const RANK_DIM = 'rgb(var(--c-outline))';
const DIM = line(0.15);
const DIM_ICON = 0.5;
const LOCKED_ICON = 0.15;
const CHANGE_COLOR: Record<NodeChange, string> = {
  gained: 'rgb(var(--c-positive))',
  lost: 'rgb(var(--c-negative))',
  changed: 'rgb(var(--c-info))',
};

export default function TalentTree({
  talentString,
  editable,
  specId: specIdProp,
  onTalentStringChange,
  vertical,
  baseTalentString,
}: TalentTreeProps) {
  // In edit mode, freeze the initial string so prop changes don't re-decode
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

  const decodedFromString = useMemo(
    () => (stableTalentString && tree ? decodeSelections(stableTalentString, tree) : null),
    [stableTalentString, tree]
  );

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

  const changes = useMemo(() => {
    if (!baseTalentString || !tree || !selections) return undefined;
    const base = decodeSelections(baseTalentString, tree);
    return base ? nodeChanges(diffBuilds(base, selections, tree)) : undefined;
  }, [baseTalentString, tree, selections]);

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

  // Encode and notify parent after render, not during it
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

  useWowheadTooltips([selections]);

  if (!tree || !selections) {
    if (!talentString && !specIdProp) return null;
    return (
      <div className="flex items-center justify-center p-5">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-surface-container-highest border-t-gold" />
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

  const sectionProps = {
    selections,
    allNodes: allNodesArr,
    editable,
    tree,
    nodeMap,
    onNodeClick: handleNodeClick,
    onNodeRightClick: handleNodeRightClick,
    onChoiceCycle: handleChoiceCycle,
    changes,
  };

  const sections = (
    <>
      <TreeSection
        label={tree.className}
        nodes={tree.classNodes}
        pointsDisplay={`${classSpent}/${CLASS_POINTS}`}
        {...sectionProps}
      />
      <TreeSection
        label={tree.specName}
        nodes={tree.specNodes}
        pointsDisplay={`${specSpent}/${SPEC_POINTS}`}
        {...sectionProps}
      />
      {activeHeroNodes.length > 0 && (
        <TreeSection
          label={selectedSubTree?.name ?? 'Hero'}
          nodes={activeHeroNodes}
          pointsDisplay={`${heroSpent}`}
          {...sectionProps}
        />
      )}
    </>
  );

  return (
    <div
      className={`flex flex-col items-center gap-4 ${vertical ? '' : 'lg:flex-row lg:flex-wrap lg:items-start lg:justify-center lg:gap-0 lg:[&>*+*]:shadow-[inset_1px_0_0_rgb(var(--c-line)/calc(0.06*var(--c-line-k)))]'}`}
    >
      {sections}
    </div>
  );
}

interface TreeSectionProps {
  label: string;
  nodes: TalentNode[];
  selections: Map<number, NodeSelection>;
  allNodes: TalentNode[];
  editable?: boolean;
  tree?: TalentTreeData;
  nodeMap?: Map<number, TalentNode>;
  onNodeClick?: (nodeId: number) => void;
  onNodeRightClick?: (nodeId: number) => void;
  onChoiceCycle?: (nodeId: number) => void;
  pointsDisplay?: string;
  changes?: Map<number, NodeChange>;
}

function TreeSection({
  label,
  nodes,
  selections,
  allNodes,
  editable,
  tree,
  nodeMap,
  onNodeClick,
  onNodeRightClick,
  onChoiceCycle,
  pointsDisplay,
  changes,
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

  const treeBody = (
    <>
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
                strokeWidth={active ? 30 : 18}
                strokeLinecap="round"
              />
            );
          })
      )}
      {nodes.map((node) => {
        const sel = selections.get(node.id);
        const selectable =
          editable && tree && nodeMap ? canSelectNode(node.id, selections, tree, nodeMap) : false;

        return (
          <TalentNodeSvg
            key={node.id}
            node={node}
            selection={sel}
            editable={editable}
            selectable={selectable}
            onClick={onNodeClick}
            onRightClick={onNodeRightClick}
            onChoiceCycle={onChoiceCycle}
            change={changes?.get(node.id)}
          />
        );
      })}
    </>
  );

  return (
    <div className="flex min-w-0 shrink-0 flex-col items-center gap-3 px-6">
      <div className="flex items-center gap-2.5">
        <span className="h-card">{label}</span>
        {pointsDisplay && <Pill className="tabular-nums">{pointsDisplay}</Pill>}
      </div>
      <svg
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        width={vbW * SCALE}
        height={vbH * SCALE}
        className="max-w-full"
        onContextMenu={editable ? (e) => e.preventDefault() : undefined}
      >
        {treeBody}
      </svg>
    </div>
  );
}

function TalentNodeSvg({
  node,
  selection,
  editable,
  selectable,
  onClick,
  onRightClick,
  onChoiceCycle,
  change,
}: {
  node: TalentNode;
  selection?: NodeSelection;
  editable?: boolean;
  selectable?: boolean;
  onClick?: (nodeId: number) => void;
  onRightClick?: (nodeId: number) => void;
  onChoiceCycle?: (nodeId: number) => void;
  change?: NodeChange;
}) {
  const { locale } = useLanguage();
  const isSelected = !!selection;
  const isChoice = node.type === 'choice' && node.entries.length > 1;
  const isInteractable = editable && (selectable || isSelected);

  // Choice nodes: use the selected entry; otherwise the first
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

  const borderColor = change
    ? CHANGE_COLOR[change]
    : isSelected
      ? GOLD
      : editable && selectable
        ? GOLD_EDGE
        : line(0.1);
  const borderWidth = isSelected || change ? 30 : 14;

  // A dropped talent stays legible so the change reads at a glance.
  const opacity = isSelected
    ? 1
    : change === 'lost'
      ? 0.7
      : editable
        ? selectable
          ? 0.5
          : LOCKED_ICON
        : DIM_ICON;

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
          fill={NODE_FILL}
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
          fill={NODE_FILL}
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
          {...iconHrefProps(icon)}
          x={node.posX - iconHalf}
          y={node.posY - iconHalf}
          width={ICON_SIZE}
          height={ICON_SIZE}
          clipPath={`url(#clip-${node.id})`}
          // Untaken talents read as grey, not just faint.
          style={isSelected || change === 'lost' ? undefined : { filter: 'grayscale(1)' }}
        />
      )}
      {/* Rank badge for multi-rank nodes */}
      {node.maxRanks > 1 && isSelected && selection && (
        <g>
          <rect
            x={node.posX + half - 175}
            y={node.posY + half - 120}
            width={250}
            height={160}
            rx={42}
            fill={NODE_FILL}
            stroke={borderColor}
            strokeWidth={14}
          />
          <text
            x={node.posX + half - 50}
            y={node.posY + half + 6}
            textAnchor="middle"
            fill={selection.ranks >= node.maxRanks ? GOLD : RANK_DIM}
            fontSize={128}
            fontFamily="Manrope, system-ui, sans-serif"
            fontWeight="800"
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
