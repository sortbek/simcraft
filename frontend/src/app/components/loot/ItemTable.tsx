import LootItemRow from './LootItemRow';
import { useMemo, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { groupLootRows, type LootTableModel } from './lootTableModel';
import CardHeader from '../ui/CardHeader';
import Checkbox from '../ui/Checkbox';
import ToggleButtonGroup from '../ui/ToggleButtonGroup';
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
    <div className="card overflow-hidden">
      <CardHeader
        title={
          <span className="flex items-baseline gap-3">
            {t('loot.availableDrops')}
            <span className="font-sans text-[12.5px] font-medium normal-case tracking-normal text-outline">
              {headerLabel} &mdash; {t('gear.itemsCount', { count: filteredTotal })}
              {selectedCount > 0 && (
                <span className="ml-1.5 text-gold">
                  ({selectedCount} {t('dropFinder.selected')})
                </span>
              )}
            </span>
          </span>
        }
        right={
          <div className="flex items-center gap-3">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline"
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
                className="input-field h-[38px] w-64 py-0 pl-10 pr-10"
              />
              {filterText && (
                <button
                  type="button"
                  onClick={() => setFilterText('')}
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[5px] text-outline transition-colors hover:bg-surface-container-highest hover:text-on-surface"
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
              <ToggleButtonGroup<'slot' | 'dungeon'>
                value={groupBy}
                onChange={setGroupBy}
                options={[
                  { key: 'slot', label: t('loot.bySlot') },
                  { key: 'dungeon', label: t('loot.byInstance') },
                ]}
              />
            )}
          </div>
        }
      />

      <div className="grid h-11 grid-cols-12 items-center border-b border-line/[0.06] px-6">
        <div className="col-span-5 flex items-center gap-4">
          <Checkbox
            size="sm"
            checked={allSelected}
            onChange={() =>
              allSelected ? onClearItems(visibleItemIds) : onSelectItems(visibleItemIds)
            }
            aria-label={t('loot.selectAllItems')}
          />
          <span className="lbl">{t('loot.itemName')}</span>
        </div>
        <div className={`lbl text-center ${hasEmbellishmentColumn ? 'col-span-3' : 'col-span-5'}`}>
          {t('loot.slot')}
        </div>
        <div className="lbl col-span-2 text-center">{t('loot.level')}</div>
        {hasEmbellishmentColumn && (
          <div className="lbl col-span-2 text-center">{t('dropFinder.embellishment')}</div>
        )}
      </div>

      <div className="divide-y divide-line/[0.06]">
        {rowGroups.map(({ key, group, rows }) => (
          <div key={key}>
            <div className="bg-surface-container-low px-6 py-2">
              <span className="lbl">
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
        <div className="p-8 text-center text-sm text-outline">
          {filterText ? t('loot.noItemsMatch') : t('dropFinder.noDrops')}
        </div>
      )}
    </div>
  );
}
