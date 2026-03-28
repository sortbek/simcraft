import { useMemo, useState } from 'react';
import type { DropItem, UpgradeTracks } from './types';
import { getTrackInfo, resolveUpgrade, QUALITY_COLORS } from './types';

const SLOT_ORDER = [
  'Main Hand',
  'Off Hand',
  'Head',
  'Neck',
  'Shoulder',
  'Back',
  'Chest',
  'Wrist',
  'Hands',
  'Waist',
  'Legs',
  'Feet',
  'Finger',
  'Trinket',
];

type GroupMode = 'slot' | 'instance';

interface DropSlotListProps {
  drops: Record<string, DropItem[]>;
  selected: Set<number>;
  onToggle: (itemId: number) => void;
  onSelectAll: () => void;
  onClear: () => void;
  difficulty: string;
  dungeonDiff: string;
  upgradeLevel: number;
  upgradeTracks: UpgradeTracks;
  headerLabel: string;
}

export default function DropSlotList({
  drops,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  difficulty,
  dungeonDiff,
  upgradeLevel,
  upgradeTracks,
  headerLabel,
}: DropSlotListProps) {
  const [groupMode, setGroupMode] = useState<GroupMode>('slot');
  const totalItems = Object.values(drops).reduce((n, items) => n + items.length, 0);

  const allItems = useMemo(
    () => Object.values(drops).flat(),
    [drops],
  );

  const instanceSorted = useMemo(() => {
    const groups = new Map<string, DropItem[]>();
    for (const item of allItems) {
      const inst = item.instance_name || 'Unknown';
      const list = groups.get(inst) || [];
      list.push(item);
      groups.set(inst, list);
    }
    return [...groups.entries()];
  }, [allItems]);

  const slotSorted = useMemo(
    () =>
      [...Object.entries(drops)].sort(([a], [b]) => {
        const ai = SLOT_ORDER.indexOf(a);
        const bi = SLOT_ORDER.indexOf(b);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      }),
    [drops],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          {headerLabel} &mdash; {totalItems} items
          {selected.size > 0 && (
            <span className="ml-1.5 text-gold">({selected.size} selected)</span>
          )}
        </p>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {([['instance', 'By Instance'], ['slot', 'By Slot']] as const).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setGroupMode(mode)}
                className={`rounded border px-2.5 py-1 text-[11px] font-medium transition-all ${
                  groupMode === mode
                    ? 'border-white bg-white text-black'
                    : 'border-border bg-surface-2 text-gray-400 hover:border-gray-500 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={onSelectAll}
            className="text-[11px] text-gray-500 transition-colors hover:text-white"
          >
            Select all
          </button>
          <button
            onClick={onClear}
            className="text-[11px] text-gray-500 transition-colors hover:text-white"
          >
            Clear
          </button>
        </div>
      </div>

      {(groupMode === 'instance' ? instanceSorted : slotSorted).map(
        ([groupLabel, items]) => (
          <div key={groupLabel} className="card p-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted">
              {groupLabel}
              <span className="ml-1.5 font-normal normal-case tracking-normal text-gray-600">
                ({items.length})
              </span>
            </h3>
            <div className="flex flex-wrap gap-2">
              {items.map((item) => (
                <DropItemCard
                  key={item.item_id}
                  item={item}
                  isSelected={selected.has(item.item_id)}
                  onToggle={() => onToggle(item.item_id)}
                  difficulty={difficulty}
                  dungeonDiff={dungeonDiff}
                  upgradeLevel={upgradeLevel}
                  upgradeTracks={upgradeTracks}
                />
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function DropItemCard({
  item,
  isSelected,
  onToggle,
  difficulty,
  dungeonDiff,
  upgradeLevel,
  upgradeTracks,
}: {
  item: DropItem;
  isSelected: boolean;
  onToggle: () => void;
  difficulty: string;
  dungeonDiff: string;
  upgradeLevel: number;
  upgradeTracks: UpgradeTracks;
}) {
  const resolved = resolveUpgrade(item, difficulty, dungeonDiff, upgradeLevel, upgradeTracks);
  const effectiveBonusId = getTrackInfo(item, difficulty, dungeonDiff)?.bonus_id;
  const isOffSpec = item.off_spec === true;

  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-all ${
        isSelected
          ? 'border-gold/40 bg-gold/10'
          : 'border-border bg-surface-2 hover:border-gray-500'
      }`}
    >
      <div className="relative shrink-0">
        <img
          src={`https://render.worldofwarcraft.com/icons/56/${item.icon}.jpg`}
          alt=""
          className={`h-6 w-6 rounded ${isOffSpec ? 'opacity-60' : ''}`}
        />
        {isOffSpec && (
          <div
            className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-black"
            title="Off-spec: may not drop for your main spec"
          >
            !
          </div>
        )}
      </div>
      <div className={`min-w-0 ${isOffSpec ? 'opacity-60' : ''}`}>
        <a
          href={`https://www.wowhead.com/item=${item.item_id}`}
          data-wowhead={`item=${item.item_id}${effectiveBonusId ? `&bonus=${effectiveBonusId}` : ''}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`block text-[12px] font-medium leading-tight ${QUALITY_COLORS[resolved.quality] || 'text-gray-400'}`}
        >
          {item.name}
        </a>
        {item.encounter && (
          <span className="text-[10px] text-zinc-500">{item.encounter}</span>
        )}
      </div>
      <span className={`shrink-0 text-[11px] tabular-nums text-gray-600 ${isOffSpec ? 'opacity-60' : ''}`}>
        {resolved.ilvl}
      </span>
    </button>
  );
}
