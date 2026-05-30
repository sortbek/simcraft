import { useMemo, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { localizedItemName, useItemNames, getWowheadUrl } from '../../lib/useItemInfo';
import type { DropItem, UpgradeTracks } from './types';
import { getTrackInfo, resolveUpgrade, QUALITY_COLORS } from './types';
import { resolveInherits, type EquippedGear, type SlotInherit } from '../../lib/inheritedGear';
import { qualityBorderColor } from '../../lib/qualityColors';
import Checkbox from '../ui/Checkbox';

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

interface ItemTableProps {
  drops: Record<string, DropItem[]>;
  selected: Set<number>;
  onToggle: (itemId: number) => void;
  onSelectItems: (itemIds: number[]) => void;
  onClearItems: (itemIds: number[]) => void;
  difficulty: string;
  dungeonDiff: string;
  upgradeLevel: number;
  upgradeTracks: UpgradeTracks;
  headerLabel: string;
  equippedEmbellishments?: number;
  equippedGear: EquippedGear;
  spec: string;
}

export default function ItemTable({
  drops,
  selected,
  onToggle,
  onSelectItems,
  onClearItems,
  difficulty,
  dungeonDiff,
  upgradeLevel,
  upgradeTracks,
  headerLabel,
  equippedEmbellishments = 0,
  equippedGear,
  spec,
}: ItemTableProps) {
  const { t, locale } = useLanguage();
  useItemNames();
  const [filterText, setFilterText] = useState('');
  const [groupBy, setGroupBy] = useState<'slot' | 'dungeon'>('slot');

  const totalItems = Object.values(drops).reduce((n, items) => n + items.length, 0);

  // Check if dungeon grouping is meaningful (multiple instance names present)
  const hasMultipleDungeons = useMemo(() => {
    const names = new Set<string>();
    for (const items of Object.values(drops)) {
      for (const item of items) {
        if (item.instance_name) names.add(item.instance_name);
        if (names.size > 1) return true;
      }
    }
    return false;
  }, [drops]);

  const selectedEmbellished = useMemo(() => {
    let count = 0;
    for (const items of Object.values(drops)) {
      for (const item of items) {
        if (item.embellished && selected.has(item.item_id)) count++;
      }
    }
    return count;
  }, [drops, selected]);

  const embellishmentsFull = equippedEmbellishments + selectedEmbellished >= 2;

  // Map item_id → slot name (from the drops keys)
  const itemSlotMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const [slot, items] of Object.entries(drops)) {
      for (const item of items) map.set(item.item_id, slot);
    }
    return map;
  }, [drops]);

  const groupedItems = useMemo(() => {
    const filter = filterText.toLowerCase();

    if (groupBy === 'slot') {
      return [...Object.entries(drops)]
        .sort(([a], [b]) => {
          const ai = SLOT_ORDER.indexOf(a);
          const bi = SLOT_ORDER.indexOf(b);
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        })
        .map(([slot, items]) => {
          const filtered = filter
            ? items.filter((item) =>
                localizedItemName(item.item_id, item.name, locale).toLowerCase().includes(filter)
              )
            : items;
          return [slot, filtered] as [string, DropItem[]];
        })
        .filter(([, items]) => items.length > 0);
    }

    // Group by dungeon
    const byDungeon = new Map<string, DropItem[]>();
    for (const items of Object.values(drops)) {
      for (const item of items) {
        if (
          filter &&
          !localizedItemName(item.item_id, item.name, locale).toLowerCase().includes(filter)
        )
          continue;
        const key = item.instance_name || 'Unknown';
        const list = byDungeon.get(key);
        if (list) list.push(item);
        else byDungeon.set(key, [item]);
      }
    }
    return [...byDungeon.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([, items]) => items.length > 0);
  }, [drops, filterText, locale, groupBy]);

  const visibleItemIds = useMemo(
    () => groupedItems.flatMap(([, items]) => items.map((item) => item.item_id)),
    [groupedItems]
  );
  const filteredTotal = groupedItems.reduce((n, [, items]) => n + items.length, 0);
  const allSelected =
    filteredTotal > 0 &&
    groupedItems.every(([, items]) => items.every((item) => selected.has(item.item_id)));
  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/5 bg-surface-container shadow-2xl">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-outline-variant/10 px-4 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="font-headline text-base font-black uppercase tracking-tight text-on-surface">
            Available Drops
          </h3>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/60">
            {headerLabel} &mdash; {t('gear.itemsCount', { count: filteredTotal })}
            {selected.size > 0 && (
              <span className="ml-1.5 normal-case tracking-normal text-gold">
                ({selected.size} selected)
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant/55"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <circle cx="6.5" cy="6.5" r="4.5" />
              <path d="M10 10l4 4" />
            </svg>
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter items..."
              className="h-10 w-64 rounded-lg border border-transparent bg-surface-container-high py-2 pl-10 pr-10 text-sm text-on-surface placeholder-on-surface-variant/45 outline-none transition-all duration-150 hover:bg-surface-container-highest focus:border-gold/40 focus:bg-surface-container-highest focus:ring-2 focus:ring-gold/15"
            />
            {filterText && (
              <button
                type="button"
                onClick={() => setFilterText('')}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-on-surface-variant/55 transition-colors hover:bg-surface-container-highest hover:text-on-surface"
                aria-label="Clear search"
              >
                <svg
                  viewBox="0 0 12 12"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <path d="M3 3l6 6M9 3L3 9" />
                </svg>
              </button>
            )}
          </div>
          {hasMultipleDungeons && (
            <div className="flex h-10 items-center rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-0">
              <button
                onClick={() => setGroupBy('slot')}
                className={`flex h-10 items-center rounded-md px-3 text-sm font-medium transition-all duration-150 ${
                  groupBy === 'slot'
                    ? 'bg-secondary-container text-primary shadow-sm'
                    : 'text-on-surface-variant/60 hover:text-on-surface-variant'
                }`}
              >
                By Slot
              </button>
              <button
                onClick={() => setGroupBy('dungeon')}
                className={`flex h-10 items-center rounded-md px-3 text-sm font-medium transition-all duration-150 ${
                  groupBy === 'dungeon'
                    ? 'bg-secondary-container text-primary shadow-sm'
                    : 'text-on-surface-variant/60 hover:text-on-surface-variant'
                }`}
              >
                By Dungeon
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-12 border-b border-outline-variant/5 bg-surface-container-low px-4 py-2">
        <div className="col-span-5 flex items-center gap-4">
          <Checkbox
            variant="primary"
            size="sm"
            checked={allSelected}
            onChange={() =>
              allSelected ? onClearItems(visibleItemIds) : onSelectItems(visibleItemIds)
            }
            aria-label="Select all items"
          />
          <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
            Item Name
          </span>
        </div>
        <div className="col-span-5 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
          Slot
        </div>
        <div className="col-span-2 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
          Level
        </div>
      </div>

      {/* Item Rows */}
      <div className="divide-y divide-outline-variant/5">
        {groupedItems.map(([slot, items]) => (
          <div key={slot}>
            {/* Slot group header */}
            <div className="bg-surface-container-low/50 px-4 py-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">
                {slot} ({items.length})
              </span>
            </div>

            {items.map((item) => {
              const resolved = resolveUpgrade(
                item,
                difficulty,
                dungeonDiff,
                upgradeLevel,
                upgradeTracks
              );
              const effectiveBonusId = getTrackInfo(item, difficulty, dungeonDiff)?.bonus_id;
              const isSelected = selected.has(item.item_id);
              const isEmbellished = item.embellished === true;
              const isOffSpec = item.off_spec === true;
              const embellishDisabled = isEmbellished && embellishmentsFull && !isSelected;
              const qualityColor = QUALITY_COLORS[resolved.quality] || 'text-gray-400';
              const inherits = resolveInherits(item.inventory_type, spec, equippedGear);
              const wowheadAttr = buildWowheadAttr(item.item_id, effectiveBonusId, inherits[0]);

              return (
                <div
                  key={item.item_id}
                  onClick={() => !embellishDisabled && onToggle(item.item_id)}
                  className={`group grid grid-cols-12 items-center px-4 py-2 transition-colors ${
                    embellishDisabled
                      ? 'cursor-not-allowed opacity-40'
                      : 'cursor-pointer hover:bg-surface-container-high/40'
                  }`}
                >
                  {/* Checkbox + Icon + Name */}
                  <div className="col-span-5 flex items-center gap-3">
                    <Checkbox
                      variant="primary"
                      size="sm"
                      checked={isSelected}
                      disabled={embellishDisabled}
                      onChange={() => onToggle(item.item_id)}
                      aria-label={item.name}
                    />
                    <div className="relative shrink-0">
                      <a
                        href={getWowheadUrl(item.item_id, locale)}
                        data-wowhead={wowheadAttr}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="block"
                      >
                        <div
                          className={`h-9 w-9 overflow-hidden rounded-md border-b-2 bg-surface-container-highest`}
                          style={{ borderBottomColor: qualityBorderColor(resolved.quality) }}
                        >
                          <img
                            src={`https://render.worldofwarcraft.com/icons/56/${item.icon}.jpg`}
                            alt=""
                            className={`h-full w-full object-cover ${isOffSpec || embellishDisabled ? 'opacity-60' : ''}`}
                          />
                        </div>
                      </a>
                      {isEmbellished && (
                        <div
                          className={`absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold ${
                            embellishDisabled ? 'bg-red-500 text-white' : 'bg-purple-500 text-white'
                          }`}
                        >
                          E
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <a
                        href={getWowheadUrl(item.item_id, locale)}
                        data-wowhead={wowheadAttr}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className={`text-[13px] font-bold group-hover:underline ${qualityColor}`}
                      >
                        {localizedItemName(item.item_id, item.name, locale)}
                      </a>
                      {item.encounter && (
                        <p className="text-[10px] text-on-surface-variant/60">
                          {item.instance_name && `${item.instance_name} • `}
                          {item.encounter}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Slot */}
                  <div className="col-span-5 text-center">
                    <span className="rounded bg-surface-container-highest px-2 py-1 text-[10px] font-bold uppercase text-on-surface-variant">
                      {itemSlotMap.get(item.item_id) ?? slot}
                    </span>
                  </div>

                  {/* Level */}
                  <div className="col-span-2 text-center">
                    <span className="font-headline text-xs font-black tabular-nums text-on-surface">
                      {resolved.ilvl}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {filteredTotal === 0 && (
        <div className="p-8 text-center text-sm text-on-surface-variant/40">
          {filterText ? 'No items match your filter.' : 'No drops found.'}
        </div>
      )}
    </div>
  );
}

function buildWowheadAttr(
  itemId: number,
  bonusId: number | undefined,
  inherit: SlotInherit | undefined
): string {
  let s = `item=${itemId}`;
  if (bonusId) s += `&bonus=${bonusId}`;
  if (inherit?.enchant_id) s += `&ench=${inherit.enchant_id}`;
  if (inherit?.gem_id) s += `&gems=${inherit.gem_id}`;
  return s;
}
