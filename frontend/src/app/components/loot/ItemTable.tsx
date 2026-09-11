import LootItemRow from './LootItemRow';
import { useMemo, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { groupLootRows, type LootTableModel } from './lootTableModel';
import Checkbox from '../ui/Checkbox';
interface ItemTableProps {
  model: LootTableModel;
  onToggle: (uid: string) => void;
  onSelectItems: (uids: string[]) => void;
  onClearItems: (uids: string[]) => void;
  onEmbellishmentChange?: (itemId: number, id: number | null) => void;
}
export default function ItemTable({
  model,
  onToggle,
  onSelectItems,
  onClearItems,
  onEmbellishmentChange,
}: ItemTableProps) {
  const { t } = useLanguage();
  const [filterText, setFilterText] = useState('');
  const [groupBy, setGroupBy] = useState<'slot' | 'dungeon'>('slot');
  const { rows, headerLabel, hasEmbellishmentColumn, embellishmentLimitReached } = model;
  const rowGroups = useMemo(
    () => groupLootRows(rows, filterText, groupBy),
    [rows, filterText, groupBy]
  );
  const hasMultipleDungeons = new Set(rows.map((row) => row.sourceId ?? row.sourceName)).size > 1;
  const visibleRows = rowGroups.flatMap((group) => group.rows);
  const visibleItemIds = visibleRows.map((row) => row.uid);
  const filteredTotal = visibleRows.length;
  const selectedCount = rows.filter((row) => row.selected).length;
  const allSelected = filteredTotal > 0 && visibleRows.every((row) => row.selected);
  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/5 bg-surface-container shadow-2xl">
      <div className="flex flex-col gap-3 border-b border-outline-variant/10 px-4 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="font-headline text-base font-black uppercase tracking-tight text-on-surface">
            {t('loot.availableDrops')}
          </h3>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/60">
            {headerLabel} &mdash; {t('gear.itemsCount', { count: filteredTotal })}
            {selectedCount > 0 && (
              <span className="ml-1.5 normal-case tracking-normal text-gold">
                ({selectedCount} {t('dropFinder.selected')})
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
              placeholder={t('loot.filterItems')}
              className="h-10 w-64 rounded-lg border border-transparent bg-surface-container-high py-2 pl-10 pr-10 text-sm text-on-surface placeholder-on-surface-variant/45 outline-none transition-all duration-150 hover:bg-surface-container-highest focus:border-gold/40 focus:bg-surface-container-highest focus:ring-2 focus:ring-gold/15"
            />
            {filterText && (
              <button
                type="button"
                onClick={() => setFilterText('')}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-on-surface-variant/55 transition-colors hover:bg-surface-container-highest hover:text-on-surface"
                aria-label={t('loot.clearSearch')}
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
                {t('loot.bySlot')}
              </button>
              <button
                onClick={() => setGroupBy('dungeon')}
                className={`flex h-10 items-center rounded-md px-3 text-sm font-medium transition-all duration-150 ${
                  groupBy === 'dungeon'
                    ? 'bg-secondary-container text-primary shadow-sm'
                    : 'text-on-surface-variant/60 hover:text-on-surface-variant'
                }`}
              >
                {t('loot.byInstance')}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-12 border-b border-outline-variant/5 bg-surface-container-low px-4 py-2">
        <div className="col-span-5 flex items-center gap-4">
          <Checkbox
            variant="primary"
            size="sm"
            checked={allSelected}
            onChange={() =>
              allSelected ? onClearItems(visibleItemIds) : onSelectItems(visibleItemIds)
            }
            aria-label={t('loot.selectAllItems')}
          />
          <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
            {t('loot.itemName')}
          </span>
        </div>
        <div
          className={`text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 ${hasEmbellishmentColumn ? 'col-span-3' : 'col-span-5'}`}
        >
          {t('loot.slot')}
        </div>
        <div className="col-span-2 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
          {t('loot.level')}
        </div>
        {hasEmbellishmentColumn && (
          <div className="col-span-2 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
            {t('dropFinder.embellishment')}
          </div>
        )}
      </div>

      <div className="divide-y divide-outline-variant/5">
        {rowGroups.map(({ key, group, rows }) => (
          <div key={key}>
            <div className="bg-surface-container-low/50 px-4 py-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/40">
                {group} ({rows.length})
              </span>
            </div>

            {rows.map((row) => (
              <LootItemRow
                key={row.uid}
                row={row}
                hasEmbellishmentColumn={hasEmbellishmentColumn}
                embellishmentLimitReached={embellishmentLimitReached}
                onToggle={onToggle}
                onEmbellishmentChange={onEmbellishmentChange}
              />
            ))}
          </div>
        ))}
      </div>

      {filteredTotal === 0 && (
        <div className="p-8 text-center text-sm text-on-surface-variant/40">
          {filterText ? t('loot.noItemsMatch') : t('dropFinder.noDrops')}
        </div>
      )}
    </div>
  );
}
