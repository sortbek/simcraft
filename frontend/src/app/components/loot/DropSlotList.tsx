import { useMemo, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { localizedItemName, useItemNames, getWowheadUrl } from '../../lib/useItemInfo';
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
  const { t } = useLanguage();
  const [groupMode, setGroupMode] = useState<GroupMode>('slot');
  const totalItems = Object.values(drops).reduce((n, items) => n + items.length, 0);

  const allItems = useMemo(() => Object.values(drops).flat(), [drops]);

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
    [drops]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          {headerLabel} &mdash; {t('gear.itemsCount', { count: totalItems })}
          {selected.size > 0 && (
            <span className="ml-1.5 text-gold">({selected.size} selected)</span>
          )}
        </p>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {(
              [
                ['instance', t('loot.byInstance')],
                ['slot', t('loot.bySlot')],
              ] as [GroupMode, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setGroupMode(mode)}
                className={`rounded border px-2.5 py-1 text-[13px] font-medium transition-all ${
                  groupMode === mode
                    ? 'border-white bg-white text-black'
                    : 'border-transparent bg-surface-container-high text-on-surface-variant/60 hover:bg-surface-container-highest hover:text-on-surface-variant'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={onSelectAll}
            className="text-[13px] text-on-surface-variant/60 transition-colors hover:text-on-surface"
          >
            {t('common.selectAll')}
          </button>
          <button
            onClick={onClear}
            className="text-[13px] text-on-surface-variant/60 transition-colors hover:text-on-surface"
          >
            Clear
          </button>
        </div>
      </div>

      {(groupMode === 'instance' ? instanceSorted : slotSorted).map(([groupLabel, items]) => (
        <div key={groupLabel} className="card p-4">
          <h3 className="mb-3 font-headline text-[13px] font-semibold uppercase tracking-wider text-on-surface-variant/60">
            {groupLabel}
            <span className="ml-1.5 font-normal normal-case tracking-normal text-on-surface-variant/40">
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
      ))}
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
  const { t, locale } = useLanguage();
  useItemNames();
  const resolved = resolveUpgrade(item, difficulty, dungeonDiff, upgradeLevel, upgradeTracks);
  const effectiveBonusId = getTrackInfo(item, difficulty, dungeonDiff)?.bonus_id;
  const isOffSpec = item.off_spec === true;

  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-all ${
        isSelected
          ? 'border-gold/40 bg-gold/10'
          : 'border-transparent bg-surface-container-high hover:bg-surface-container-highest'
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
            className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-black"
            title={t('loot.offSpecWarning')}
          >
            !
          </div>
        )}
      </div>
      <div className={`min-w-0 ${isOffSpec ? 'opacity-60' : ''}`}>
        <a
          href={getWowheadUrl(item.item_id, locale)}
          data-wowhead={`item=${item.item_id}${effectiveBonusId ? `&bonus=${effectiveBonusId}` : ''}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`block text-[14px] font-medium leading-tight ${QUALITY_COLORS[resolved.quality] || 'text-gray-400'}`}
        >
          {localizedItemName(item.item_id, item.name, locale)}
        </a>
        {item.encounter && <span className="text-[12px] text-on-surface-variant/60">{item.encounter}</span>}
      </div>
      <span
        className={`shrink-0 text-[13px] tabular-nums text-on-surface-variant/40 ${isOffSpec ? 'opacity-60' : ''}`}
      >
        {resolved.ilvl}
      </span>
    </button>
  );
}
