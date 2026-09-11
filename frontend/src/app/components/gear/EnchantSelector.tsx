'use client';

import { useEffect, useMemo, useState } from 'react';
import { API_URL } from '../../lib/api';
import GearItemRow from './GearItemRow';
import {
  GEAR_DENSITY_LAYOUT,
  gearCardClass,
  gearGridProps,
  type GearRowDensity,
} from './gearDensity';
import type { ResolvedItem } from '../../lib/types';
import { getWowheadUrl } from '../../lib/useItemInfo';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import { useLanguage } from '../../lib/i18n';
import { statLabel, ENCHANT_SLOTS, type ItemOption } from './itemOptions';

const SLOT_DISPLAY: Record<string, string> = {
  main_hand: 'slot.mainHand',
  head: 'slot.head',
  shoulder: 'slot.shoulder',
  back: 'slot.back',
  chest: 'slot.chest',
  wrist: 'slot.wrist',
  legs: 'slot.legs',
  feet: 'slot.feet',
  finger1: 'slot.ring1',
  finger2: 'slot.ring2',
};

interface EnchantSelectorProps {
  equippedSlots: Record<string, ResolvedItem>;
  enchantSelections: Record<string, Set<number>>;
  onEnchantToggle: (slot: string, enchantId: number) => void;
  onSelectAllEnchants: (slot: string, ids: number[]) => void;
  onDeselectAllEnchants: (slot: string) => void;
  density: GearRowDensity;
  /** Reports that there is nothing to show, so the page can drop the whole
   *  section instead of leaving a heading over an empty body. */
  onEmptyChange?: (empty: boolean) => void;
}

function enchantDetails(e: ItemOption): { text: string; color?: string }[] {
  const parts: { text: string; color?: string }[] = [];
  if (e.stats && e.stats.length > 0) {
    parts.push({ text: e.stats.map(statLabel).join(', ') });
  }
  if (e.craftingQuality) {
    parts.push({ text: `Rank ${e.craftingQuality}`, color: 'text-on-surface-variant/40' });
  }
  return parts;
}

export default function EnchantSelector({
  equippedSlots,
  enchantSelections,
  onEnchantToggle,
  onSelectAllEnchants,
  onDeselectAllEnchants,
  density,
  onEmptyChange,
}: EnchantSelectorProps) {
  const { t, locale } = useLanguage();
  const [enchantOptions, setItemOptions] = useState<Record<string, ItemOption[]>>({});
  const [loaded, setLoaded] = useState(false);
  useWowheadTooltips([enchantOptions]);

  const enchantableSlots = useMemo(
    () => ENCHANT_SLOTS.filter((s) => equippedSlots[s]),
    [equippedSlots]
  );

  useEffect(() => {
    if (enchantableSlots.length === 0) return;
    const fetches = enchantableSlots.map(async (slot) => {
      try {
        const res = await fetch(
          `${API_URL}/api/enchants?expansion=11&slot=${encodeURIComponent(slot)}`
        );
        if (!res.ok) return { slot, data: [] as ItemOption[] };
        const data: ItemOption[] = await res.json();
        return { slot, data };
      } catch {
        return { slot, data: [] as ItemOption[] };
      }
    });
    Promise.all(fetches).then((results) => {
      const map: Record<string, ItemOption[]> = {};
      for (const { slot, data } of results) {
        if (data.length > 0) map[slot] = data;
      }
      setItemOptions(map);
      setLoaded(true);
    });
  }, [enchantableSlots]);

  // Rank 2 only, then sort alphabetically
  const sortedEnchants = useMemo(() => {
    const result: Record<string, ItemOption[]> = {};
    for (const slot of enchantableSlots) {
      const options = enchantOptions[slot];
      if (!options) continue;
      result[slot] = options
        .filter((e) => !e.craftingQuality || e.craftingQuality === 2)
        .sort((a, b) => (a.itemName || a.displayName).localeCompare(b.itemName || b.displayName));
    }
    return result;
  }, [enchantableSlots, enchantOptions]);

  const enchantSlots = useMemo(
    () => ENCHANT_SLOTS.filter((s) => sortedEnchants[s]?.length > 0),
    [sortedEnchants]
  );

  useEffect(() => {
    if (loaded) onEmptyChange?.(enchantSlots.length === 0);
  }, [loaded, enchantSlots.length, onEmptyChange]);

  // Still fetching: a placeholder rather than `null`, so the section heading is
  // never left sitting over nothing.
  if (!loaded) {
    return <p className="py-1 text-sm text-muted">{t('common.loading')}</p>;
  }

  if (enchantSlots.length === 0) {
    return null;
  }

  return (
    <div {...gearGridProps(density)}>
      {enchantSlots.map((slot) => {
        const equippedId = equippedSlots[slot]?.enchant_id ?? 0;
        const equippedOption =
          equippedId > 0 ? sortedEnchants[slot].find((e) => e.id === equippedId) : undefined;
        const equippedName = equippedOption
          ? equippedOption.itemName || equippedOption.displayName
          : equippedSlots[slot]?.enchant_name || '';

        const candidates = sortedEnchants[slot].filter((e) => e.id !== equippedId);
        const candidateIds = candidates.map((e) => e.id);
        const allSelected =
          candidateIds.length > 0 && candidateIds.every((id) => enchantSelections[slot]?.has(id));

        return (
          <div key={slot} className={gearCardClass(density)}>
            <div
              className={`flex items-center justify-between ${GEAR_DENSITY_LAYOUT[density].title}`}
            >
              <p className="font-headline font-semibold uppercase tracking-widest text-muted">
                {t(SLOT_DISPLAY[slot])}
              </p>
              {candidateIds.length > 0 && (
                <button
                  onClick={() =>
                    allSelected
                      ? onDeselectAllEnchants(slot)
                      : onSelectAllEnchants(slot, candidateIds)
                  }
                  className="text-[11px] text-gold/60 transition-colors hover:text-gold"
                >
                  {allSelected ? t('enchantGem.deselectAll') : t('enchantGem.selectAll')}
                </button>
              )}
            </div>

            {/* Equipped enchant: always simmed as the baseline */}
            {equippedId > 0 && equippedName && (
              <GearItemRow
                icon={equippedOption?.itemIcon || ''}
                name={equippedName}
                nameColor="text-on-surface"
                href={
                  equippedOption?.itemId ? getWowheadUrl(equippedOption.itemId, locale) : undefined
                }
                details={equippedOption ? enchantDetails(equippedOption) : undefined}
                equipped
                density={density}
              />
            )}

            {equippedId > 0 && equippedName && candidates.length > 0 && (
              <div
                className={`border-t border-outline-variant/20 ${GEAR_DENSITY_LAYOUT[density].rule}`}
              />
            )}

            {candidates.map((e) => {
              const isSelected = enchantSelections[slot]?.has(e.id) ?? false;
              return (
                <GearItemRow
                  key={e.id}
                  icon={e.itemIcon || ''}
                  name={e.itemName || e.displayName}
                  nameColor="text-on-surface"
                  href={e.itemId ? getWowheadUrl(e.itemId, locale) : undefined}
                  details={enchantDetails(e)}
                  selectable
                  checked={isSelected}
                  onToggle={() => onEnchantToggle(slot, e.id)}
                  density={density}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
