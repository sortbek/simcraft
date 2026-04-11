import { useMemo, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { localizedItemName, useItemNames, getWowheadUrl } from '../../lib/useItemInfo';
import type { DropItem, UpgradeTracks } from './types';
import { getTrackInfo, resolveUpgrade, QUALITY_COLORS } from './types';

const SLOT_ORDER = [
  'Main Hand', 'Off Hand', 'Head', 'Neck', 'Shoulder', 'Back',
  'Chest', 'Wrist', 'Hands', 'Waist', 'Legs', 'Feet', 'Finger', 'Trinket',
];

interface ItemTableProps {
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
  equippedEmbellishments?: number;
}

export default function ItemTable({
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
  equippedEmbellishments = 0,
}: ItemTableProps) {
  const { t, locale } = useLanguage();
  useItemNames();
  const [filterText, setFilterText] = useState('');

  const totalItems = Object.values(drops).reduce((n, items) => n + items.length, 0);

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

  const slotSorted = useMemo(() => {
    const filter = filterText.toLowerCase();
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
  }, [drops, filterText, locale]);

  const filteredTotal = slotSorted.reduce((n, [, items]) => n + items.length, 0);
  const allSelected = filteredTotal > 0 && slotSorted.every(([, items]) => items.every((item) => selected.has(item.item_id)));

  return (
    <div className="rounded-xl border border-outline-variant/5 bg-surface-container overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-outline-variant/10 p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="font-headline font-black text-xl uppercase tracking-tight text-on-surface">
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
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant/40" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="6.5" cy="6.5" r="4.5" />
              <path d="M10 10l4 4" />
            </svg>
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter items..."
              className="w-48 rounded-full border border-outline-variant/20 bg-black py-2 pl-10 pr-4 text-xs text-on-surface placeholder-on-surface-variant/40 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <button
            onClick={allSelected ? onClear : onSelectAll}
            className="shrink-0 rounded-full bg-primary px-4 py-2 text-[10px] font-headline font-black uppercase text-on-primary shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95"
          >
            {allSelected ? 'Clear All' : 'Select All'}
          </button>
        </div>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-12 border-b border-outline-variant/5 bg-surface-container-low px-6 py-3">
        <div className="col-span-6 flex items-center gap-4">
          <button
            onClick={() => (allSelected ? onClear() : onSelectAll())}
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors ${
              allSelected
                ? 'border-primary bg-primary'
                : 'border-outline-variant/40 bg-transparent hover:border-on-surface-variant/60'
            }`}
          >
            {allSelected && (
              <svg className="h-3 w-3 text-on-primary" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 6l2.5 2.5 4.5-5" />
              </svg>
            )}
          </button>
          <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
            Item Name
          </span>
        </div>
        <div className="col-span-2 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
          Slot
        </div>
        <div className="col-span-2 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
          Level
        </div>
        <div className="col-span-2 text-right text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
          Action
        </div>
      </div>

      {/* Item Rows */}
      <div className="divide-y divide-outline-variant/5">
        {slotSorted.map(([slot, items]) => (
          <div key={slot}>
            {/* Slot group header */}
            <div className="bg-surface-container-low/50 px-6 py-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">
                {slot} ({items.length})
              </span>
            </div>

            {items.map((item) => {
              const resolved = resolveUpgrade(item, difficulty, dungeonDiff, upgradeLevel, upgradeTracks);
              const effectiveBonusId = getTrackInfo(item, difficulty, dungeonDiff)?.bonus_id;
              const isSelected = selected.has(item.item_id);
              const isEmbellished = item.embellished === true;
              const isOffSpec = item.off_spec === true;
              const embellishDisabled = isEmbellished && embellishmentsFull && !isSelected;
              const qualityColor = QUALITY_COLORS[resolved.quality] || 'text-gray-400';

              return (
                <div
                  key={item.item_id}
                  className={`group grid grid-cols-12 items-center px-6 py-4 transition-colors ${
                    embellishDisabled ? 'opacity-40' : 'hover:bg-surface-container-high/40'
                  }`}
                >
                  {/* Checkbox + Icon + Name */}
                  <div className="col-span-6 flex items-center gap-4">
                    <button
                      onClick={() => !embellishDisabled && onToggle(item.item_id)}
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                        embellishDisabled
                          ? 'border-outline-variant/20 bg-transparent cursor-not-allowed'
                          : isSelected
                            ? 'border-primary bg-primary cursor-pointer'
                            : 'border-outline-variant/40 bg-transparent hover:border-on-surface-variant/60 cursor-pointer'
                      }`}
                    >
                      {isSelected && (
                        <svg className="h-3 w-3 text-on-primary" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2.5 6l2.5 2.5 4.5-5" />
                        </svg>
                      )}
                    </button>
                    <div className="relative shrink-0">
                      <div className={`h-12 w-12 overflow-hidden rounded-md bg-surface-container-highest border-b-2`} style={{ borderBottomColor: qualityBorderColor(resolved.quality) }}>
                        <img
                          src={`https://render.worldofwarcraft.com/icons/56/${item.icon}.jpg`}
                          alt=""
                          className={`h-full w-full object-cover ${isOffSpec || embellishDisabled ? 'opacity-60' : ''}`}
                        />
                      </div>
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
                        data-wowhead={`item=${item.item_id}${effectiveBonusId ? `&bonus=${effectiveBonusId}` : ''}`}
                        target="_blank"
                        rel="noreferrer"
                        className={`text-sm font-bold group-hover:underline ${qualityColor}`}
                      >
                        {localizedItemName(item.item_id, item.name, locale)}
                      </a>
                      {item.encounter && (
                        <p className="text-[10px] text-on-surface-variant/60">
                          {item.instance_name && `${item.instance_name} • `}{item.encounter}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Slot */}
                  <div className="col-span-2 text-center">
                    <span className="rounded bg-surface-container-highest px-2 py-1 text-[10px] font-bold uppercase text-on-surface-variant">
                      {slot}
                    </span>
                  </div>

                  {/* Level */}
                  <div className="col-span-2 text-center">
                    <span className="font-headline text-sm font-black text-on-surface tabular-nums">
                      {resolved.ilvl}
                    </span>
                  </div>

                  {/* Action */}
                  <div className="col-span-2 text-right">
                    <a
                      href={getWowheadUrl(item.item_id, locale)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant/40 transition-colors hover:bg-surface-container-high hover:text-primary"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 3H3v10h10v-3M9 2h5v5M8 8l6-6" />
                      </svg>
                    </a>
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

function qualityBorderColor(quality: number): string {
  switch (quality) {
    case 5: return '#ff8000'; // legendary
    case 4: return '#a335ee'; // epic
    case 3: return '#0070dd'; // rare
    case 2: return '#1eff00'; // uncommon
    default: return '#9d9d9d'; // common
  }
}
