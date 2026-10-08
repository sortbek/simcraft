import LootItemRow from './LootItemRow';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLanguage } from '../../lib/i18n';
import { groupLootRows, type LootTableModel } from './lootTableModel';
import Pill from '../ui/Pill';
import ToggleButtonGroup from '../ui/ToggleButtonGroup';
import DensityToggle from '../gear/DensityToggle';
import {
  GEAR_DENSITY_LAYOUT,
  GEAR_ROW_DENSITIES,
  gearCardClass,
  gearGridProps,
  type GearRowDensity,
} from '../gear/gearDensity';
import { readStoredJson } from '../../lib/storage';

const DENSITY_STORAGE_KEY = 'simhammer_dropfinder_density';
interface ItemTableProps {
  model: LootTableModel;
  onToggle: (uid: string) => void;
  onSelectItems: (uids: string[]) => void;
  onClearItems: (uids: string[]) => void;
  onEmbellishmentChange?: (itemId: number, id: number | null) => void;
  /** List filters (spec, bosses, slots), shown in the header. */
  filters?: ReactNode;
}
/** The drops as slot (or instance) cards under one header line: count, search,
 *  grouping and the list filters. */
export default function ItemTable({
  model,
  onToggle,
  onSelectItems,
  onClearItems,
  onEmbellishmentChange,
  filters,
}: ItemTableProps) {
  const { t } = useLanguage();
  const [filterText, setFilterText] = useState('');
  const [groupBy, setGroupBy] = useState<'slot' | 'dungeon'>('slot');
  const [density, setDensity] = useState<GearRowDensity>('compact');
  useEffect(() => {
    const stored = readStoredJson<GearRowDensity>(DENSITY_STORAGE_KEY, 'compact');
    if (GEAR_ROW_DENSITIES.includes(stored)) setDensity(stored);
  }, []);
  const changeDensity = (next: GearRowDensity) => {
    setDensity(next);
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, JSON.stringify(next));
    } catch {}
  };
  const { rows, embellishmentLimitReached } = model;
  const rowGroups = useMemo(
    () => groupLootRows(rows, filterText, groupBy),
    [rows, filterText, groupBy]
  );
  const hasMultipleDungeons = new Set(rows.map((row) => row.sourceId ?? row.sourceName)).size > 1;
  const visibleRows = rowGroups.flatMap((group) => group.rows);
  const filteredTotal = visibleRows.length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <div className="relative min-w-[150px] max-w-[320px] flex-[1_1_160px]">
          <svg
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-outline"
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
            className="input-field h-8 py-0 pl-8 pr-8 !text-[13px]"
          />
          {filterText && (
            <button
              type="button"
              onClick={() => setFilterText('')}
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] text-outline transition-colors hover:bg-surface-container-highest hover:text-on-surface"
              aria-label={t('loot.clearSearch')}
            >
              <svg
                viewBox="0 0 12 12"
                className="h-3 w-3"
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
            size="sm"
            options={[
              { key: 'slot', label: t('loot.bySlot') },
              { key: 'dungeon', label: t('loot.byInstance') },
            ]}
          />
        )}
        {filters}
        <DensityToggle className="ml-auto" density={density} onChange={changeDensity} />
      </div>

      {filteredTotal > 0 ? (
        <div {...gearGridProps(density)}>
          {rowGroups.map(({ key, group, rows }) => {
            const uids = rows.map((row) => row.uid);
            const groupSelected = rows.every((row) => row.selected);
            return (
              <div key={key} className={gearCardClass(density)}>
                <div
                  className={`h-card flex items-center gap-2 !text-[11px] ${GEAR_DENSITY_LAYOUT[density].title}`}
                >
                  {group}
                  <Pill className="tabular-nums">{rows.length}</Pill>
                  <button
                    type="button"
                    onClick={() => (groupSelected ? onClearItems(uids) : onSelectItems(uids))}
                    className="ml-auto font-headline text-[10px] font-extrabold uppercase tracking-[0.12em] text-gold transition-colors hover:text-gold-light"
                  >
                    {groupSelected
                      ? (t('dropFinder.deselectAll') ?? 'Deselect all')
                      : (t('dropFinder.selectAll') ?? 'Select all')}
                  </button>
                </div>
                {rows.map((row) => (
                  <LootItemRow
                    key={row.uid}
                    row={row}
                    showSlot={groupBy === 'dungeon'}
                    density={density}
                    embellishmentLimitReached={embellishmentLimitReached}
                    onToggle={onToggle}
                    onEmbellishmentChange={onEmbellishmentChange}
                  />
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card p-8 text-center text-sm text-outline">
          {filterText ? t('loot.noItemsMatch') : t('dropFinder.noDrops')}
        </div>
      )}
    </div>
  );
}
